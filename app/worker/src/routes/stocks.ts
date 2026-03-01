/**
 * /api/stocks — 銘柄マスター CRUD (認証不要)
 * ポート元: app/backend/routers/stocks.py
 */

import type { Env } from '../env';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { isValidTicker } from '../lib/validation';

export async function handleStocks(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405, cors);

  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/stocks', '') || '/';

  try {
    if (path === '/') return listStocks(url, supabase, cors);
    if (path === '/categories/list') return listCategories(supabase, cors);

    const tickerMatch = path.match(/^\/([^/]+)$/);
    if (tickerMatch) return getStock(supabase, tickerMatch[1], cors);

    return errorResponse('Not Found', 404, cors);
  } catch {
    return errorResponse('Internal server error', 500, cors);
  }
}

// GET /api/stocks
async function listStocks(
  url: URL,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  let query = supabase.table('stock_master').select('*');

  const category = url.searchParams.get('category');
  if (category) query = query.eq('price_category', category);

  const watchlist = url.searchParams.get('watchlist');
  if (watchlist) query = query.eq('watchlist_category', watchlist);

  const activeOnly = url.searchParams.get('active_only') !== 'false';
  if (activeOnly) query = query.eq('is_active', true);

  const { data } = await query.order('ticker');
  const stocks = data || [];
  return jsonResponse({ stocks, total: stocks.length }, 200, cors);
}

// GET /api/stocks/:ticker
async function getStock(
  supabase: ReturnType<typeof getSupabase>,
  ticker: string,
  cors: Record<string, string> | null,
) {
  const t = ticker.toUpperCase();
  if (!isValidTicker(t)) return errorResponse('Invalid ticker format', 400, cors);

  const { data } = await supabase
    .table('stock_master').select('*').eq('ticker', t).limit(1);
  if (!data?.length) return errorResponse(`Stock ${t} not found`, 404, cors);
  return jsonResponse(data[0], 200, cors);
}

// GET /api/stocks/categories/list
async function listCategories(
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const { data } = await supabase
    .table('stock_master').select('price_category, watchlist_category');
  const rows = data || [];

  const priceCategories = [...new Set(rows.map(r => r.price_category).filter(Boolean))].sort();
  const watchlistCategories = [...new Set(rows.map(r => r.watchlist_category).filter(Boolean))].sort();

  return jsonResponse({ price_categories: priceCategories, watchlist_categories: watchlistCategories }, 200, cors);
}
