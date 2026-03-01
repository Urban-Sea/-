/**
 * /api/watchlist — ウォッチリスト CRUD
 * ポート元: app/backend/routers/watchlist.py (227行)
 */

import type { Env } from '../env';
import { requireAuth, AuthError } from '../middleware/auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody, isValidTicker } from '../lib/validation';

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export async function handleWatchlist(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/watchlist', '') || '/';
  const method = request.method;

  try {
    const userId = await requireAuth(request, env, supabase);

    if (path === '/' && method === 'GET') return listWatchlists(supabase, userId, cors);
    if (path === '/' && method === 'POST') return createWatchlist(request, supabase, userId, cors);
    if (path === '/add-ticker' && method === 'POST') return addTicker(url, supabase, userId, cors);
    if (path === '/remove-ticker' && method === 'POST') return removeTicker(url, supabase, userId, cors);

    const idMatch = path.match(/^\/([^/]+)$/);
    if (idMatch) {
      if (method === 'PUT') return updateWatchlist(request, supabase, userId, idMatch[1], cors);
      if (method === 'DELETE') return deleteWatchlist(supabase, userId, idMatch[1], cors);
    }

    return errorResponse('Not Found', 404, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

// GET /api/watchlist
async function listWatchlists(supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const { data } = await supabase
    .table('user_watchlists').select('*').eq('user_id', userId)
    .order('is_default', { ascending: false }).order('name');
  const watchlists = data || [];
  return jsonResponse({ watchlists, total: watchlists.length }, 200, cors);
}

// POST /api/watchlist
async function createWatchlist(request: Request, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const body = await parseJsonBody(request);
  const name = typeof body.name === 'string' ? body.name : 'メイン';
  let tickers: string[] = [];
  if (Array.isArray(body.tickers)) {
    tickers = (body.tickers as string[])
      .map(t => String(t).toUpperCase())
      .filter(t => TICKER_RE.test(t))
      .slice(0, 50);
  }

  const { data, error } = await supabase.table('user_watchlists').insert({
    user_id: userId,
    name,
    tickers,
    is_default: body.is_default === true,
  }).select();

  if (error || !data?.length) return errorResponse('Failed to create', 500, cors);
  return jsonResponse(data[0], 201, cors);
}

// PUT /api/watchlist/:id
async function updateWatchlist(request: Request, supabase: ReturnType<typeof getSupabase>, userId: string, watchlistId: string, cors: Record<string, string> | null) {
  const body = await parseJsonBody(request);
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.tickers !== undefined && Array.isArray(body.tickers)) {
    updates.tickers = (body.tickers as string[])
      .map(t => String(t).toUpperCase())
      .filter(t => TICKER_RE.test(t));
  }
  if (body.is_default !== undefined) updates.is_default = body.is_default;
  if (Object.keys(updates).length === 0) return errorResponse('No update data', 400, cors);

  const { data } = await supabase.table('user_watchlists')
    .update(updates).eq('id', watchlistId).eq('user_id', userId).select();
  if (!data?.length) return errorResponse('Watchlist not found', 404, cors);
  return jsonResponse(data[0], 200, cors);
}

// DELETE /api/watchlist/:id
async function deleteWatchlist(supabase: ReturnType<typeof getSupabase>, userId: string, watchlistId: string, cors: Record<string, string> | null) {
  const { data } = await supabase.table('user_watchlists')
    .delete().eq('id', watchlistId).eq('user_id', userId).select();
  if (!data?.length) return errorResponse('Watchlist not found', 404, cors);
  return jsonResponse({ status: 'deleted', id: watchlistId }, 200, cors);
}

// POST /api/watchlist/add-ticker
async function addTicker(url: URL, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  if (!isValidTicker(ticker)) return errorResponse('Invalid ticker', 400, cors);

  const { data: existing } = await supabase
    .table('user_watchlists').select('*').eq('user_id', userId).eq('is_default', true).limit(1);

  if (existing?.length) {
    const wl = existing[0];
    const tickers: string[] = wl.tickers || [];
    if (!tickers.includes(ticker)) {
      tickers.push(ticker);
      await supabase.table('user_watchlists').update({ tickers }).eq('id', wl.id).eq('user_id', userId);
    }
    return jsonResponse({ tickers }, 200, cors);
  }

  // デフォルトウォッチリスト自動作成
  await supabase.table('user_watchlists').insert({
    user_id: userId, name: 'メイン', tickers: [ticker], is_default: true,
  });
  return jsonResponse({ tickers: [ticker] }, 200, cors);
}

// POST /api/watchlist/remove-ticker
async function removeTicker(url: URL, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();

  const { data: existing } = await supabase
    .table('user_watchlists').select('*').eq('user_id', userId).eq('is_default', true).limit(1);

  if (existing?.length) {
    const wl = existing[0];
    const tickers = (wl.tickers || []).filter((t: string) => t !== ticker);
    await supabase.table('user_watchlists').update({ tickers }).eq('id', wl.id).eq('user_id', userId);
    return jsonResponse({ tickers }, 200, cors);
  }

  return jsonResponse({ tickers: [] }, 200, cors);
}
