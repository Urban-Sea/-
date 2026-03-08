/**
 * 計算エンドポイントを Backend (Railway/Cloud Run) にプロキシ
 * signal/*, regime, exit/*, stock/*, liquidity 計算系, employment 計算系
 */

import type { Env } from '../env';
import { safeCors } from '../middleware/cors';
import { SECURITY_HEADERS } from '../middleware/security-headers';
import { getCacheTtl } from '../cache-config';

export async function handleProxy(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  // キャッシュ判定
  const ttl = getCacheTtl(url.pathname);
  const isCacheable = request.method === 'GET' && ttl > 0;
  const cacheKeyUrl = url.toString();

  // Cache purge: ?_purge=1 で該当キーを削除して再取得
  const purge = url.searchParams.get('_purge') === '1';
  if (purge && isCacheable) {
    const cache = caches.default;
    const purgeKey = new Request(cacheKeyUrl.replace('?_purge=1', '').replace('&_purge=1', ''), { method: 'GET' });
    await cache.delete(purgeKey);
  }

  // Try cache first
  if (isCacheable && !purge) {
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

  // Proxy to origin — ホワイトリスト方式でヘッダー転送
  const proxyUrl = `${env.ORIGIN}${url.pathname}${url.search}`;
  const proxyHeaders = new Headers();
  proxyHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
  proxyHeaders.set('Accept', request.headers.get('Accept') || 'application/json');

  // Authorization は常に転送 (Backend で JWT 検証)
  const authHeader = request.headers.get('Authorization');
  if (authHeader) proxyHeaders.set('Authorization', authHeader);

  // Admin MFA ヘッダー転送 (CORS で Origin チェック済み)
  const mfaToken = request.headers.get('X-MFA-Token');
  if (mfaToken) proxyHeaders.set('X-MFA-Token', mfaToken);

  // Shared secret
  proxyHeaders.set('X-Proxy-Secret', env.PROXY_SECRET);

  let proxyResponse: Response;
  try {
    proxyResponse = await fetch(proxyUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });
  } catch {
    return new Response(
      JSON.stringify({ detail: 'Origin temporarily unavailable' }),
      {
        status: 502,
        headers: {
          ...safeCors(cors),
          ...SECURITY_HEADERS,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  // Build response
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

  // Store in cache (non-blocking)
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
}
