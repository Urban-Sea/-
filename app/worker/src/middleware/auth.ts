/**
 * Dual-mode 認証: Supabase Auth JWT + Legacy X-User-Email
 *
 * Phase 1 (JWT — 優先):
 *   Authorization: Bearer <jwt> → jose で検証 → sub + email からユーザー解決
 *
 * Phase 2 (Legacy — フォールバック):
 *   X-User-Email + X-Proxy-Secret → Cloudflare Access 互換
 *
 * require_auth() は users テーブルの UUID を返す。
 */

import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import type { Env } from '../env';
import type { AppSupabase } from '../lib/supabase';
import { isValidEmail } from '../lib/validation';

// auth_provider_id → users.id キャッシュ (TTL 5分, isolate ローカル)
const AUTH_CACHE_TTL = 5 * 60 * 1000;
const AUTH_CACHE_MAX = 1000;
const providerIdCache = new Map<string, { userId: string; expiresAt: number }>();
const emailCache = new Map<string, { userId: string; expiresAt: number }>();

function getCached(cache: Map<string, { userId: string; expiresAt: number }>, key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.userId;
}

function setCache(cache: Map<string, { userId: string; expiresAt: number }>, key: string, userId: string): void {
  // LRU-like: 上限超えたら最古をクリア
  if (cache.size >= AUTH_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { userId, expiresAt: Date.now() + AUTH_CACHE_TTL });
}

// JWKS クライアントキャッシュ (Supabase URL 毎)
let jwksCache: { url: string; fn: ReturnType<typeof createRemoteJWKSet> } | null = null;

function getJwks(supabaseUrl: string) {
  if (jwksCache && jwksCache.url === supabaseUrl) return jwksCache.fn;
  const fn = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  jwksCache = { url: supabaseUrl, fn };
  return fn;
}

// 初回ログイン時に自動移行するテーブル一覧
const USER_TABLES = [
  'holdings', 'trades', 'cash_balances',
  'portfolio_snapshots', 'user_watchlists', 'user_settings',
];

/** JWT からユーザー解決 (auth.py _resolve_user_by_jwt のポート) */
async function resolveUserByJwt(
  supabase: AppSupabase,
  sub: string,
  email: string,
): Promise<string> {
  // キャッシュチェック
  const cached = getCached(providerIdCache, sub);
  if (cached) return cached;

  const nowIso = new Date().toISOString();

  // 1. auth_provider_id で検索
  const { data: byProvider } = await supabase
    .table('users')
    .select('id, is_active')
    .eq('auth_provider_id', sub)
    .limit(1);

  if (byProvider && byProvider.length > 0) {
    const user = byProvider[0];
    if (user.is_active === false) {
      throw new AuthError(403, 'Account deactivated');
    }
    setCache(providerIdCache, sub, user.id);
    // last_login_at 更新 (fire-and-forget)
    supabase.table('users').update({ last_login_at: nowIso }).eq('id', user.id).then(() => {}, () => {});
    return user.id;
  }

  // 2. email で検索（CF Access → Supabase Auth 移行パス）
  if (email) {
    const emailLower = email.trim().toLowerCase();
    const { data: byEmail } = await supabase
      .table('users')
      .select('id, is_active, auth_provider')
      .eq('email', emailLower)
      .limit(1);

    if (byEmail && byEmail.length > 0) {
      const user = byEmail[0];
      if (user.is_active === false) {
        throw new AuthError(403, 'Account deactivated');
      }
      // H2: 既に Supabase Auth に移行済みなら別 sub での紐付けを拒否
      if (user.auth_provider && user.auth_provider !== '' && user.auth_provider !== 'cloudflare_access') {
        throw new AuthError(409, 'Account already linked to another identity');
      }
      // auth_provider を supabase に更新
      await supabase.table('users').update({
        auth_provider: 'supabase',
        auth_provider_id: sub,
        last_login_at: nowIso,
      }).eq('id', user.id);

      setCache(providerIdCache, sub, user.id);
      return user.id;
    }
  }

  // 3. 新規ユーザー作成
  const userEmail = email ? email.trim().toLowerCase() : `supabase:${sub}`;
  try {
    const { data: created } = await supabase.table('users').insert({
      email: userEmail,
      auth_provider: 'supabase',
      auth_provider_id: sub,
      last_login_at: nowIso,
    }).select('id');

    if (!created || created.length === 0) {
      throw new Error('Insert returned no data');
    }
    const userId = created[0].id;
    setCache(providerIdCache, sub, userId);
    return userId;
  } catch {
    // 競合: 別リクエストが先に作成済み
    const { data: retry } = await supabase
      .table('users')
      .select('id')
      .eq('auth_provider_id', sub)
      .limit(1);

    if (!retry || retry.length === 0) {
      throw new AuthError(500, 'Failed to create user');
    }
    const userId = retry[0].id;
    setCache(providerIdCache, sub, userId);
    return userId;
  }
}

/** Legacy: メールからユーザー解決 (auth.py _resolve_user_id のポート) */
async function resolveUserByEmail(
  supabase: AppSupabase,
  email: string,
): Promise<string> {
  const cached = getCached(emailCache, email);
  if (cached) return cached;

  const nowIso = new Date().toISOString();

  const { data: existing } = await supabase
    .table('users')
    .select('id, is_active')
    .eq('email', email)
    .limit(1);

  if (existing && existing.length > 0) {
    const user = existing[0];
    if (user.is_active === false) {
      throw new AuthError(403, 'Account deactivated');
    }
    // last_login_at 更新
    supabase.table('users').update({ last_login_at: nowIso }).eq('id', user.id).then(() => {}, () => {});
    setCache(emailCache, email, user.id);
    return user.id;
  }

  // 新規作成
  try {
    const { data: created } = await supabase.table('users').insert({
      email,
      auth_provider: 'cloudflare_access',
      last_login_at: nowIso,
    }).select('id');

    if (!created || created.length === 0) {
      throw new Error('Insert returned no data');
    }
    const userId = created[0].id;

    // 古いメールベースの user_id を UUID に移行
    for (const table of USER_TABLES) {
      try {
        await supabase.table(table).update({ user_id: userId }).eq('user_id', email);
      } catch {
        // migration skip
      }
    }

    setCache(emailCache, email, userId);
    return userId;
  } catch {
    const { data: retry } = await supabase
      .table('users')
      .select('id')
      .eq('email', email)
      .limit(1);

    if (!retry || retry.length === 0) {
      throw new AuthError(500, 'Failed to create user');
    }
    setCache(emailCache, email, retry[0].id);
    return retry[0].id;
  }
}

/** 認証エラー */
export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Dual-mode 認証 — users テーブルの UUID を返す。
 *
 * 1. Authorization: Bearer <jwt> (Supabase Auth — 優先)
 * 2. X-User-Email + X-Proxy-Secret (Legacy CF Access — フォールバック)
 */
export async function requireAuth(
  request: Request,
  env: Env,
  supabase: AppSupabase,
): Promise<string> {
  const isProduction = env.ENVIRONMENT === 'production';
  const authorization = request.headers.get('Authorization');
  const xUserEmail = request.headers.get('X-User-Email');
  const xProxySecret = request.headers.get('X-Proxy-Secret');

  // ── Path 1: Supabase Auth JWT ──
  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7);
    let tokenAlg = 'unknown';

    try {
      // ヘッダーをデコード（kid の有無でパスを分岐）
      let header: { kid?: string; alg?: string };
      try {
        header = decodeProtectedHeader(token);
      } catch {
        header = {};
      }
      tokenAlg = header.alg || 'HS256';
      const tokenKid = header.kid;

      const supabaseUrl = env.SUPABASE_URL.replace(/\/$/, '');
      const issuer = supabaseUrl ? `${supabaseUrl}/auth/v1` : undefined;

      if (tokenKid && supabaseUrl) {
        // ── kid あり → JWKS 公開鍵で検証（ES256 等）──
        const jwks = getJwks(supabaseUrl);
        const { payload } = await jwtVerify(token, jwks, {
          audience: 'authenticated',
          issuer,
        });
        return await handleJwtPayload(payload, supabase);
      } else if (isProduction && supabaseUrl) {
        // ── 本番で JWKS が使えるのに kid なし → alg confusion 防止で拒否 ──
        // Supabase ES256 トークンは必ず kid を持つ。
        // kid なしトークンは HMAC 偽造の可能性があるため本番では拒否。
        throw new AuthError(401, 'Invalid token');
      } else {
        // ── kid なし → HMAC シークレットで検証（開発環境のみ）──
        if (!env.SUPABASE_JWT_SECRET) {
          throw new AuthError(503, 'Service misconfigured');
        }
        if (!tokenAlg.startsWith('HS')) {
          throw new AuthError(401, 'Unsupported token algorithm');
        }
        const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
        const { payload } = await jwtVerify(token, secret, {
          audience: 'authenticated',
          issuer,
          algorithms: [tokenAlg],
        });
        return await handleJwtPayload(payload, supabase);
      }
    } catch (err) {
      if (err instanceof AuthError) throw err;
      const errName = err instanceof Error ? err.constructor.name : 'unknown';
      // jose エラーを FastAPI 互換のエラーにマップ
      if (errName === 'JWTExpired') throw new AuthError(401, 'Token expired');
      if (errName === 'JWSSignatureVerificationFailed') throw new AuthError(401, 'Invalid token');
      if (errName === 'JWTClaimValidationFailed') throw new AuthError(401, 'Invalid token');
      throw new AuthError(401, 'Invalid token');
    }
  }

  // ── Path 2: Legacy X-User-Email + X-Proxy-Secret ──
  if (isProduction) {
    if (!env.PROXY_SECRET) {
      throw new AuthError(503, 'Service misconfigured');
    }
    if (!xProxySecret || !timingSafeEqual(xProxySecret, env.PROXY_SECRET)) {
      if (!xUserEmail) {
        throw new AuthError(401, 'Authentication required');
      }
      throw new AuthError(403, 'Forbidden');
    }
  }

  if (xUserEmail) {
    const email = xUserEmail.trim().toLowerCase();
    if (!isValidEmail(email)) {
      throw new AuthError(400, 'Invalid email format');
    }
    return resolveUserByEmail(supabase, email);
  }

  if (!isProduction) {
    return resolveUserByEmail(supabase, 'dev@localhost');
  }

  throw new AuthError(401, 'Authentication required');
}

/** JWT ペイロードからユーザー解決 */
async function handleJwtPayload(
  payload: Record<string, unknown>,
  supabase: AppSupabase,
): Promise<string> {
  const sub = payload.sub as string | undefined;
  const email = (payload.email as string) || '';

  if (!sub) {
    throw new AuthError(401, 'Invalid token: missing sub');
  }

  return resolveUserByJwt(supabase, sub, email);
}

/** タイミングセーフな文字列比較 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}
