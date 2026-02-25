import { getCacheTtl } from './cache-config';

interface Env {
  ORIGIN: string;
  ALLOWED_ORIGIN: string;
}

function corsHeaders(origin: string, allowedOrigin: string): Record<string, string> {
  // Allow the configured origin + localhost for dev
  const allowed = [allowedOrigin, 'http://localhost:3000', 'http://localhost:3001'];
  const responseOrigin = allowed.includes(origin) ? origin : allowedOrigin;

  return {
    'Access-Control-Allow-Origin': responseOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, CF-Access-Authenticated-User-Email',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Only proxy /api/* paths
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not Found', { status: 404 });
    }

    const ttl = getCacheTtl(url.pathname);
    const isCacheable = request.method === 'GET' && ttl > 0;

    // Try cache first
    if (isCacheable) {
      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const cached = await cache.match(cacheKey);

      if (cached) {
        const response = new Response(cached.body, cached);
        // Overwrite CORS headers (cached response may have stale ones)
        for (const [k, v] of Object.entries(cors)) {
          response.headers.set(k, v);
        }
        response.headers.set('X-Cache', 'HIT');
        return response;
      }
    }

    // Proxy to origin (Railway)
    const proxyUrl = `${env.ORIGIN}${url.pathname}${url.search}`;
    const proxyHeaders = new Headers(request.headers);
    // Remove host header so Railway gets the correct one
    proxyHeaders.delete('Host');

    let proxyResponse: Response;
    try {
      proxyResponse = await fetch(proxyUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });
    } catch (err) {
      // Railway cold start / network error → return 502 instead of crashing (520)
      return new Response(
        JSON.stringify({ detail: `Origin unavailable: ${err instanceof Error ? err.message : String(err)}` }),
        {
          status: 502,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      );
    }

    // Build response with CORS
    const responseHeaders = new Headers(proxyResponse.headers);
    for (const [k, v] of Object.entries(cors)) {
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
