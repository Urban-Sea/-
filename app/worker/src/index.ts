import { getCacheTtl } from './cache-config';

interface Env {
  ORIGIN: string;
  ALLOWED_ORIGIN: string;
  PROXY_SECRET: string;
}

/** セキュリティヘッダー（全レスポンスに付与） */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

/** Per-user エンドポイント判定（Cache-Control: private 用） */
const PER_USER_PATTERNS = [/^\/api\/holdings/, /^\/api\/trades/, /^\/api\/watchlist/, /^\/api\/me/];

function isPerUserEndpoint(pathname: string): boolean {
  return PER_USER_PATTERNS.some(p => p.test(pathname));
}

function buildAllowedOrigins(env: Env): string[] {
  const allowed = env.ALLOWED_ORIGIN ? [env.ALLOWED_ORIGIN] : [];
  if (env.ALLOWED_ORIGIN?.startsWith('http://localhost')) {
    allowed.push('http://localhost:3000', 'http://localhost:3001');
  }
  return allowed;
}

function corsHeaders(origin: string, allowed: string[], env: Env): Record<string, string> {
  const responseOrigin = allowed.includes(origin) ? origin : (env.ALLOWED_ORIGIN || '');
  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = buildAllowedOrigins(env);
    const cors = corsHeaders(origin, allowed, env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
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

    // X-User-Email 信頼性検証:
    // 信頼された Origin からのリクエストのみ X-User-Email を転送する。
    // curl 等の直接アクセスでは Origin ヘッダーがないため、
    // X-User-Email はストリップされる（なりすまし防止）。
    const isTrustedOrigin = allowed.includes(origin);
    const rawEmail = request.headers.get('X-User-Email') || '';
    const userEmail = isTrustedOrigin ? rawEmail : '';

    const ttl = getCacheTtl(url.pathname);
    const isCacheable = request.method === 'GET' && ttl > 0;

    // Build per-user cache key
    const cacheKeyUrl = userEmail
      ? `${url.toString()}::user=${userEmail}`
      : url.toString();

    // Try cache first
    if (isCacheable) {
      const cache = caches.default;
      const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
      const cached = await cache.match(cacheKey);

      if (cached) {
        const response = new Response(cached.body, cached);
        for (const [k, v] of Object.entries({ ...cors, ...SECURITY_HEADERS })) {
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

    // 信頼された Origin からのみ X-User-Email を転送（なりすまし防止）
    if (isTrustedOrigin && rawEmail) {
      proxyHeaders.set('X-User-Email', rawEmail);
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
          headers: { ...cors, ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        },
      );
    }

    // Build response with CORS + security headers
    const responseHeaders = new Headers(proxyResponse.headers);
    for (const [k, v] of Object.entries({ ...cors, ...SECURITY_HEADERS })) {
      responseHeaders.set(k, v);
    }
    responseHeaders.set('X-Cache', 'MISS');

    const response = new Response(proxyResponse.body, {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      headers: responseHeaders,
    });

    // Store in cache (non-blocking)
    if (isCacheable && proxyResponse.status === 200) {
      const cache = caches.default;
      const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
      const cacheResponse = new Response(response.clone().body, {
        status: 200,
        headers: responseHeaders,
      });
      // Per-user EP は Cache-Control: private、それ以外は public
      const cacheDirective = isPerUserEndpoint(url.pathname) ? 'private' : 'public';
      cacheResponse.headers.set('Cache-Control', `${cacheDirective}, max-age=${ttl}`);
      if (isPerUserEndpoint(url.pathname)) {
        cacheResponse.headers.set('Vary', 'X-User-Email');
      }
      ctx.waitUntil(cache.put(cacheKey, cacheResponse));
    }

    // Invalidate per-user cache on mutations (POST/PUT/DELETE)
    if (request.method !== 'GET' && request.method !== 'HEAD' && proxyResponse.status < 400 && userEmail) {
      const cache = caches.default;
      const pathsToInvalidate = [
        '/api/holdings',
        '/api/holdings/init',
        '/api/holdings/cash',
      ];
      for (const path of pathsToInvalidate) {
        const purgeUrl = `${url.origin}${path}::user=${userEmail}`;
        ctx.waitUntil(cache.delete(new Request(purgeUrl, { method: 'GET' })));
      }
    }

    return response;
  },
};
