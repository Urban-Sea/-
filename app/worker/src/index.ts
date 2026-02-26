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
};

function corsHeaders(origin: string, env: Env): Record<string, string> {
  // 本番では localhost を許可しない
  const allowed = env.ALLOWED_ORIGIN
    ? [env.ALLOWED_ORIGIN]
    : [];

  // dev 環境用: ALLOWED_ORIGIN が localhost なら追加
  if (env.ALLOWED_ORIGIN?.startsWith('http://localhost')) {
    allowed.push('http://localhost:3000', 'http://localhost:3001');
  } else {
    // 本番ドメインのみ — localhost は含まない
  }

  const responseOrigin = allowed.includes(origin) ? origin : (env.ALLOWED_ORIGIN || '');

  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
    }

    // Only proxy /api/* paths
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }

    const ttl = getCacheTtl(url.pathname);
    const isCacheable = request.method === 'GET' && ttl > 0;

    // Try cache first (public data only — user CRUD has ttl=0)
    if (isCacheable) {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
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

    // Proxy to origin (Railway)
    const proxyUrl = `${env.ORIGIN}${url.pathname}${url.search}`;
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('Host');
    // Attach shared secret to prove request came from this Worker
    if (env.PROXY_SECRET) {
      proxyHeaders.set('X-Proxy-Secret', env.PROXY_SECRET);
    }

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

    // Store in cache (non-blocking) — public/shared data only
    // User CRUD endpoints (holdings, trades, watchlist) have ttl=0 → never cached
    if (isCacheable && proxyResponse.status === 200) {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
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
