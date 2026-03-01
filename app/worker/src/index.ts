import { getCacheTtl } from './cache-config';

interface Env {
  ORIGIN: string;
  ALLOWED_ORIGIN: string;
  PROXY_SECRET: string;
}

// ── H7: IP ベースの簡易レートリミッター (120 req/min/IP) ──
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const ipHits = new Map<string, { count: number; resetAt: number }>();
let requestCounter = 0;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // 100リクエストごとに期限切れエントリをクリーンアップ
  if (++requestCounter % 100 === 0) {
    for (const [key, val] of ipHits) {
      if (val.resetAt <= now) ipHits.delete(key);
    }
  }

  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

/** セキュリティヘッダー（全レスポンスに付与） */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};


function buildAllowedOrigins(env: Env): string[] {
  // カンマ区切りで複数 Origin 対応 (後方互換: 単一値でも動作)
  const raw = env.ALLOWED_ORIGIN || '';
  const allowed = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.some(o => o.startsWith('http://localhost'))) {
    if (!allowed.includes('http://localhost:3000')) allowed.push('http://localhost:3000');
    if (!allowed.includes('http://localhost:3001')) allowed.push('http://localhost:3001');
  }
  return allowed;
}

/** CORS ヘッダー（M1: 不正 Origin には空文字列を返さず、null を返す） */
function corsHeaders(origin: string, allowed: string[]): Record<string, string> | null {
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email, X-MFA-Token',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

/** CORS ヘッダーを安全に結合（null なら空オブジェクト） */
function safeCors(cors: Record<string, string> | null): Record<string, string> {
  return cors ?? {};
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = buildAllowedOrigins(env);
    const cors = corsHeaders(origin, allowed);

    // CORS preflight (rate limit 対象外)
    // M1: 不正 Origin には CORS ヘッダーなしで 403 を返す
    if (request.method === 'OPTIONS') {
      if (!cors) {
        return new Response(null, { status: 403, headers: SECURITY_HEADERS });
      }
      return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
    }

    // H7: IP レートリミット
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ detail: 'Too many requests' }),
        {
          status: 429,
          headers: {
            ...safeCors(cors),
            ...SECURITY_HEADERS,
            'Content-Type': 'application/json',
            'Retry-After': '60',
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    // PROXY_SECRET 未設定チェック
    if (!env.PROXY_SECRET) {
      return new Response(
        JSON.stringify({ detail: 'Service misconfigured' }),
        { status: 500, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      );
    }

    // Only proxy /api/* paths
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }

    // パストラバーサル防止: ".." を含むパスを拒否
    if (url.pathname.includes('..')) {
      return new Response(
        JSON.stringify({ detail: 'Invalid path' }),
        { status: 400, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    // C3: キャッシュは公開データのみ（per-user エンドポイントは cache-config で TTL=0）
    // キャッシュキーにユーザー情報を含めない（cache poisoning 防止）
    const ttl = getCacheTtl(url.pathname);
    const isCacheable = request.method === 'GET' && ttl > 0;
    const cacheKeyUrl = url.toString();

    // Try cache first
    if (isCacheable) {
      const cache = caches.default;
      const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
      const cached = await cache.match(cacheKey);

      if (cached) {
        const response = new Response(cached.body, cached);
        for (const [k, v] of Object.entries({ ...safeCors(cors), ...SECURITY_HEADERS })) {
          response.headers.set(k, v);
        }
        response.headers.set('X-Cache', 'HIT');
        return response;
      }
    }

    // Proxy to origin (Railway) — ホワイトリスト方式でヘッダー転送
    const proxyUrl = `${env.ORIGIN}${url.pathname}${url.search}`;
    const proxyHeaders = new Headers();
    proxyHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    proxyHeaders.set('Accept', request.headers.get('Accept') || 'application/json');

    // H2: Authorization は常に転送（Backend 側で JWT 署名を検証するので安全）
    // Origin 偽装で偽の JWT を送っても Backend が弾く
    const authHeader = request.headers.get('Authorization');
    if (authHeader) {
      proxyHeaders.set('Authorization', authHeader);
    }
    // Admin 用ヘッダーは信頼 Origin からのみ転送
    // X-User-Email: Cloudflare Access が設定（Legacy 認証パス）
    // X-MFA-Token: Admin MFA セッショントークン
    const isTrustedOrigin = allowed.includes(origin);
    if (isTrustedOrigin) {
      const userEmail = request.headers.get('X-User-Email');
      if (userEmail) proxyHeaders.set('X-User-Email', userEmail);
      const mfaToken = request.headers.get('X-MFA-Token');
      if (mfaToken) proxyHeaders.set('X-MFA-Token', mfaToken);
    }

    // Attach shared secret to prove request came from this Worker
    proxyHeaders.set('X-Proxy-Secret', env.PROXY_SECRET);

    let proxyResponse: Response;
    try {
      proxyResponse = await fetch(proxyUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });
    } catch (_err) {
      // Railway cold start / network error → generic 502 (内部情報を漏洩しない)
      return new Response(
        JSON.stringify({ detail: 'Origin temporarily unavailable' }),
        {
          status: 502,
          headers: { ...safeCors(cors), ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        },
      );
    }

    // Build response with CORS + security headers
    const responseHeaders = new Headers(proxyResponse.headers);
    for (const [k, v] of Object.entries({ ...safeCors(cors), ...SECURITY_HEADERS })) {
      responseHeaders.set(k, v);
    }
    responseHeaders.set('X-Cache', 'MISS');

    const response = new Response(proxyResponse.body, {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      headers: responseHeaders,
    });

    // Store in cache (non-blocking) — 公開データのみ（per-user は TTL=0 でここに来ない）
    if (isCacheable && proxyResponse.status === 200) {
      const cache = caches.default;
      const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
      const cacheResponse = new Response(response.clone().body, {
        status: 200,
        headers: responseHeaders,
      });
      cacheResponse.headers.set('Cache-Control', `public, max-age=${ttl}`);
      ctx.waitUntil(cache.put(cacheKey, cacheResponse));
    }

    return response;
  },
};
