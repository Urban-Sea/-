/**
 * /api/admin/mfa — 管理者 TOTP MFA エンドポイント
 * ポート元: app/backend/routers/admin_mfa.py
 *
 * GET  /status         MFA 設定状態
 * POST /setup          TOTP シークレット生成
 * POST /setup/verify   セットアップ確認 → セッション発行
 * POST /verify         ログイン時 TOTP 検証 → セッション発行
 * GET  /session        セッション有効性チェック
 * DELETE /session      セッション無効化
 */

import type { Env } from '../env';
import { AuthError } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin-auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody } from '../lib/validation';
import { randomBase32, verifyTotp, buildOtpUri } from '../lib/totp';
import { encryptSecret, decryptSecret } from '../lib/crypto';

const SESSION_DURATION_HOURS = 1;
const ISSUER_NAME = 'OpenRegimeAdmin';
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15分

// インメモリ: ブルートフォース対策
const attemptTracker = new Map<string, number[]>();
// インメモリ: リプレイ防止
const usedCodes = new Map<string, Map<string, number>>();

export async function handleAdminMfa(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/admin/mfa', '') || '/';
  const method = request.method;

  try {
    // 全エンドポイント require_admin (MFA セッション不要、admin メールチェックのみ)
    const adminId = await requireAdmin(request, env, supabase);

    if (path === '/status' && method === 'GET') return mfaStatus(supabase, adminId, cors);
    if (path === '/setup' && method === 'POST') return mfaSetup(supabase, env, adminId, cors);
    if (path === '/setup/verify' && method === 'POST') {
      return mfaSetupVerify(request, supabase, env, adminId, cors);
    }
    if (path === '/verify' && method === 'POST') {
      return mfaVerify(request, supabase, env, adminId, cors);
    }
    if (path === '/session' && method === 'GET') {
      return mfaSessionCheck(request, supabase, adminId, cors);
    }
    if (path === '/session' && method === 'DELETE') {
      return mfaLogout(request, supabase, adminId, cors);
    }

    return errorResponse('Not Found', 404, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

// ── ブルートフォース / リプレイ防止 ──

function checkRateLimit(userId: string): void {
  const now = Date.now() / 1000;
  const cutoff = now - LOCKOUT_SECONDS;
  const attempts = (attemptTracker.get(userId) || []).filter(t => t > cutoff);
  attemptTracker.set(userId, attempts);
  if (attempts.length >= MAX_ATTEMPTS) {
    throw new AuthError(429, `Too many attempts. Try again in ${LOCKOUT_SECONDS / 60} minutes.`);
  }
}

function recordAttempt(userId: string): void {
  const attempts = attemptTracker.get(userId) || [];
  attempts.push(Date.now() / 1000);
  attemptTracker.set(userId, attempts);
}

function clearAttempts(userId: string): void {
  attemptTracker.delete(userId);
}

function checkReplay(userId: string, code: string): void {
  const now = Date.now() / 1000;
  const userCodes = usedCodes.get(userId) || new Map();
  // 期限切れ削除
  for (const [c, exp] of userCodes) {
    if (exp < now) userCodes.delete(c);
  }
  usedCodes.set(userId, userCodes);
  if (userCodes.has(code)) {
    throw new AuthError(401, 'Code already used');
  }
}

function markCodeUsed(userId: string, code: string): void {
  const userCodes = usedCodes.get(userId) || new Map();
  userCodes.set(code, Date.now() / 1000 + 90);
  usedCodes.set(userId, userCodes);
}

// ── ヘルパー ──

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getUserEmail(
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
): Promise<string> {
  const { data } = await supabase.table('users').select('email').eq('id', userId).limit(1);
  return data?.[0]?.email || 'admin';
}

async function createSessionToken(
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
): Promise<{ token: string; expires_at: string }> {
  // crypto.randomUUID() + 追加バイトで64文字16進数トークン
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000).toISOString();

  await supabase.table('admin_mfa_sessions').insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  return { token, expires_at: expiresAt };
}

// ── エンドポイント ──

// GET /api/admin/mfa/status
async function mfaStatus(
  supabase: ReturnType<typeof getSupabase>,
  adminId: string,
  cors: Record<string, string> | null,
) {
  const { data } = await supabase
    .table('admin_mfa')
    .select('enabled')
    .eq('user_id', adminId)
    .limit(1);

  if (!data?.length) {
    return jsonResponse({ mfa_enabled: false, mfa_setup: false }, 200, cors);
  }
  return jsonResponse({ mfa_enabled: data[0].enabled, mfa_setup: true }, 200, cors);
}

// POST /api/admin/mfa/setup
async function mfaSetup(
  supabase: ReturnType<typeof getSupabase>,
  env: Env,
  adminId: string,
  cors: Record<string, string> | null,
) {
  // 既存チェック
  const { data: existing } = await supabase
    .table('admin_mfa')
    .select('enabled')
    .eq('user_id', adminId)
    .limit(1);

  if (existing?.length && existing[0].enabled) {
    return errorResponse('MFA already enabled', 409, cors);
  }
  if (existing?.length && !existing[0].enabled) {
    return errorResponse('MFA setup already in progress. Complete verification or contact support.', 409, cors);
  }

  if (!env.MFA_ENCRYPTION_KEY || env.MFA_ENCRYPTION_KEY.length !== 64) {
    return errorResponse('MFA encryption not configured', 503, cors);
  }

  // TOTP シークレット生成
  const secret = randomBase32(32);
  const email = await getUserEmail(supabase, adminId);
  const provisioningUri = buildOtpUri(secret, email, ISSUER_NAME);

  // 暗号化して保存
  const encryptedSecret = await encryptSecret(secret, env.MFA_ENCRYPTION_KEY);
  await supabase.table('admin_mfa').insert({
    user_id: adminId,
    secret_enc: encryptedSecret,
    enabled: false,
  });

  // QR コードは Frontend で生成 (Worker では qrcode ライブラリ不要)
  return jsonResponse({
    secret,
    provisioning_uri: provisioningUri,
  }, 200, cors);
}

// POST /api/admin/mfa/setup/verify
async function mfaSetupVerify(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  env: Env,
  adminId: string,
  cors: Record<string, string> | null,
) {
  const body = await parseJsonBody(request);
  const code = typeof body.code === 'string' ? body.code.trim() : String(body.code || '').trim();

  if (!code || code.length !== 6) {
    return errorResponse('6-digit code required', 400, cors);
  }

  checkRateLimit(adminId);

  const { data } = await supabase
    .table('admin_mfa')
    .select('secret_enc, enabled')
    .eq('user_id', adminId)
    .limit(1);

  if (!data?.length) return errorResponse('MFA setup not found. Call /setup first.', 404, cors);
  if (data[0].enabled) return errorResponse('MFA already enabled', 409, cors);

  // 復号 + 検証
  const secretEnc = data[0].secret_enc;
  let secret: string;
  if (secretEnc.includes(':')) {
    secret = await decryptSecret(secretEnc, env.MFA_ENCRYPTION_KEY);
  } else {
    secret = secretEnc; // レガシー平文
  }

  const valid = await verifyTotp(secret, code);
  if (!valid) {
    recordAttempt(adminId);
    return errorResponse('Invalid code', 401, cors);
  }

  checkReplay(adminId, code);
  markCodeUsed(adminId, code);
  clearAttempts(adminId);

  // MFA 有効化
  await supabase.table('admin_mfa').update({
    enabled: true,
    updated_at: new Date().toISOString(),
  }).eq('user_id', adminId);

  const session = await createSessionToken(supabase, adminId);

  return jsonResponse({ status: 'mfa_enabled', ...session }, 200, cors);
}

// POST /api/admin/mfa/verify
async function mfaVerify(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  env: Env,
  adminId: string,
  cors: Record<string, string> | null,
) {
  const body = await parseJsonBody(request);
  const code = typeof body.code === 'string' ? body.code.trim() : String(body.code || '').trim();

  if (!code || code.length !== 6) {
    return errorResponse('6-digit code required', 400, cors);
  }

  checkRateLimit(adminId);

  const { data } = await supabase
    .table('admin_mfa')
    .select('secret_enc, enabled')
    .eq('user_id', adminId)
    .limit(1);

  if (!data?.length || !data[0].enabled) {
    return errorResponse('MFA not enabled', 404, cors);
  }

  const secretEnc = data[0].secret_enc;
  let secret: string;
  if (secretEnc.includes(':')) {
    secret = await decryptSecret(secretEnc, env.MFA_ENCRYPTION_KEY);
  } else {
    secret = secretEnc;
  }

  const valid = await verifyTotp(secret, code);
  if (!valid) {
    recordAttempt(adminId);
    return errorResponse('Invalid code', 401, cors);
  }

  checkReplay(adminId, code);
  markCodeUsed(adminId, code);
  clearAttempts(adminId);

  const session = await createSessionToken(supabase, adminId);

  return jsonResponse({ status: 'verified', ...session }, 200, cors);
}

// GET /api/admin/mfa/session
async function mfaSessionCheck(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  adminId: string,
  cors: Record<string, string> | null,
) {
  const xMfaToken = request.headers.get('X-MFA-Token');
  if (!xMfaToken) {
    return jsonResponse({ valid: false, reason: 'no_token' }, 200, cors);
  }

  const tokenHash = await sha256Hex(xMfaToken);
  const now = new Date().toISOString();

  const { data } = await supabase
    .table('admin_mfa_sessions')
    .select('id, expires_at')
    .eq('user_id', adminId)
    .eq('token_hash', tokenHash)
    .gte('expires_at', now)
    .limit(1);

  if (!data?.length) {
    return jsonResponse({ valid: false, reason: 'expired_or_invalid' }, 200, cors);
  }

  return jsonResponse({ valid: true, expires_at: data[0].expires_at }, 200, cors);
}

// DELETE /api/admin/mfa/session
async function mfaLogout(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  adminId: string,
  cors: Record<string, string> | null,
) {
  const xMfaToken = request.headers.get('X-MFA-Token');
  if (!xMfaToken) {
    return jsonResponse({ status: 'no_token' }, 200, cors);
  }

  const tokenHash = await sha256Hex(xMfaToken);
  await supabase
    .table('admin_mfa_sessions')
    .delete()
    .eq('user_id', adminId)
    .eq('token_hash', tokenHash);

  return jsonResponse({ status: 'logged_out' }, 200, cors);
}
