/**
 * /api/fx/usdjpy — USD/JPY 為替レート (認証不要)
 * ポート元: app/backend/routers/fx.py
 * Yahoo Finance chart API 経由、5分キャッシュ
 */

import type { Env } from '../env';
import { jsonResponse, errorResponse } from '../lib/response';

// インメモリキャッシュ (5分 TTL、isolate ローカル)
let fxCache: { rate: number; ts: number } | null = null;
const CACHE_TTL = 300_000; // 5分 (ms)

const YF_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/JPY=X?range=1d&interval=1d';

export async function handleFx(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/fx/usdjpy' || request.method !== 'GET') {
    return errorResponse('Not Found', 404, cors);
  }

  try {
    const now = Date.now();
    if (fxCache && (now - fxCache.ts) < CACHE_TTL) {
      return jsonResponse({ rate: fxCache.rate, cached: true }, 200, cors);
    }

    const resp = await fetch(YF_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!resp.ok) {
      if (fxCache) {
        return jsonResponse({ rate: fxCache.rate, cached: true, stale: true }, 200, cors);
      }
      return errorResponse('Failed to fetch USD/JPY rate', 503, cors);
    }

    const data = await resp.json() as {
      chart: { result: Array<{ meta: { regularMarketPrice: number } }> };
    };

    const price = data.chart.result[0].meta.regularMarketPrice;
    const rate = Math.round(price * 100) / 100;

    fxCache = { rate, ts: now };
    return jsonResponse({ rate, cached: false }, 200, cors);
  } catch {
    if (fxCache) {
      return jsonResponse({ rate: fxCache.rate, cached: true, stale: true }, 200, cors);
    }
    return errorResponse('Failed to fetch USD/JPY rate', 503, cors);
  }
}
