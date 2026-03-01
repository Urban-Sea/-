/**
 * Cloudflare Worker — ルーティングディスパッチャー
 *
 * CRUD_IN_WORKER=true:  CRUD は Worker 内で処理、計算のみ Backend にプロキシ
 * CRUD_IN_WORKER=false: 全リクエストを Backend にプロキシ (従来動作)
 */

import type { Env } from './env';
import { buildAllowedOrigins, corsHeaders, safeCors } from './middleware/cors';
import { checkRateLimit } from './middleware/rate-limit';
import { SECURITY_HEADERS } from './middleware/security-headers';
import { handleProxy } from './routes/proxy';

// CRUD ルートハンドラー
import { handleMe } from './routes/me';
import { handleHoldings } from './routes/holdings';
import { handleTrades } from './routes/trades';
import { handleWatchlist } from './routes/watchlist';
import { handleStocks } from './routes/stocks';
import { handleMarketState } from './routes/market-state';
import { handleFx } from './routes/fx';
import { handleEmploymentCrud } from './routes/employment-crud';
import { handleLiquidityCrud } from './routes/liquidity-crud';
import { handleAdmin } from './routes/admin';
import { handleAdminMfa } from './routes/admin-mfa';

/**
 * 計算系パス — これらは常に Backend にプロキシ
 * (CRUD_IN_WORKER=true でも Backend 転送)
 */
function isComputePath(pathname: string): boolean {
  // signal/*, regime, exit/*, stock/* — 全て計算
  if (pathname.startsWith('/api/signal/')) return true;
  if (pathname === '/api/regime') return true;
  if (pathname.startsWith('/api/exit/')) return true;
  if (pathname.startsWith('/api/stock/')) return true;

  // liquidity 計算系 (CRUD は handleLiquidityCrud で処理)
  const liquidityCompute = [
    '/api/liquidity/overview',
    '/api/liquidity/plumbing-summary',
    '/api/liquidity/events',
    '/api/liquidity/policy-regime',
    '/api/liquidity/history-charts',
    '/api/liquidity/backtest-states',
  ];
  if (liquidityCompute.includes(pathname)) return true;

  // employment 計算系 (CRUD は handleEmploymentCrud で処理)
  if (pathname === '/api/employment/risk-score') return true;
  if (pathname === '/api/employment/risk-history') return true;

  return false;
}

/**
 * CRUD ルーティング — パスプレフィクスでハンドラーを決定
 * null を返した場合は該当なし → Backend にプロキシ
 */
function routeCrud(
  pathname: string,
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> | null {
  if (pathname === '/api/me' || pathname.startsWith('/api/me/')) {
    return handleMe(request, env, cors);
  }
  if (pathname.startsWith('/api/holdings')) {
    return handleHoldings(request, env, cors);
  }
  if (pathname.startsWith('/api/trades')) {
    return handleTrades(request, env, cors);
  }
  if (pathname.startsWith('/api/watchlist')) {
    return handleWatchlist(request, env, cors);
  }
  if (pathname.startsWith('/api/stocks')) {
    return handleStocks(request, env, cors);
  }
  if (pathname.startsWith('/api/market-state')) {
    return handleMarketState(request, env, cors);
  }
  if (pathname === '/api/fx/usdjpy') {
    return handleFx(request, env, cors);
  }

  // employment CRUD (計算系は isComputePath で先に除外済み)
  if (pathname.startsWith('/api/employment')) {
    return handleEmploymentCrud(request, env, cors);
  }

  // liquidity CRUD (計算系は isComputePath で先に除外済み)
  if (pathname.startsWith('/api/liquidity')) {
    return handleLiquidityCrud(request, env, cors);
  }

  // admin MFA (admin/mfa/* は admin/* より先にマッチ)
  if (pathname.startsWith('/api/admin/mfa')) {
    return handleAdminMfa(request, env, cors);
  }
  if (pathname.startsWith('/api/admin')) {
    return handleAdmin(request, env, cors);
  }

  return null; // 該当なし → proxy fallback
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = buildAllowedOrigins(env);
    const cors = corsHeaders(origin, allowed);

    // CORS preflight — M1: 不正 Origin には 403
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

    // Only proxy /api/* paths
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }

    // パストラバーサル防止
    if (url.pathname.includes('..')) {
      return new Response(
        JSON.stringify({ detail: 'Invalid path' }),
        { status: 400, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    // ── ルーティング分岐 ──

    const crudEnabled = env.CRUD_IN_WORKER === 'true';

    if (crudEnabled) {
      // 計算系パスは常に Backend プロキシ
      if (isComputePath(url.pathname)) {
        return handleProxy(request, env, cors, ctx);
      }

      // CRUD ルーティング
      // Worker 内部で処理するため X-Proxy-Secret を注入
      // (以前はプロキシ時に付与していたが、内部処理ではブラウザから届かない)
      const headers = new Headers(request.headers);
      headers.set('X-Proxy-Secret', env.PROXY_SECRET);
      const internalRequest = new Request(request, { headers });
      const crudResponse = routeCrud(url.pathname, internalRequest, env, cors);
      if (crudResponse) return crudResponse;
    }

    // CRUD_IN_WORKER=false または CRUD に該当しないパス → 全部 Backend プロキシ
    if (!env.PROXY_SECRET) {
      return new Response(
        JSON.stringify({ detail: 'Service misconfigured' }),
        {
          status: 500,
          headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        },
      );
    }

    return handleProxy(request, env, cors, ctx);
  },
};
