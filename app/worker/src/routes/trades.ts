/**
 * /api/trades — 取引履歴 CRUD
 * ポート元: app/backend/routers/trades.py (444行)
 */

import type { Env } from '../env';
import { requireAuth, AuthError } from '../middleware/auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody, isValidTicker, isPositiveNumber } from '../lib/validation';

const VALID_ACTIONS = new Set(['BUY', 'SELL']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleTrades(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/trades', '') || '/';
  const method = request.method;

  try {
    const userId = await requireAuth(request, env, supabase);

    if (path === '/' && method === 'GET') return listTrades(url, supabase, userId, cors);
    if (path === '/' && method === 'POST') return createTrade(request, supabase, userId, cors);
    if (path === '/stats' && method === 'GET') return tradeStats(supabase, userId, cors);
    if (path === '/sell-from-holding' && method === 'POST') return sellFromHolding(url, supabase, userId, cors);

    const idMatch = path.match(/^\/([^/]+)$/);
    if (idMatch) {
      if (method === 'GET') return getTrade(supabase, userId, idMatch[1], cors);
      if (method === 'DELETE') return deleteTrade(supabase, userId, idMatch[1], cors);
    }

    return errorResponse('Not Found', 404, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

// GET /api/trades
async function listTrades(url: URL, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  let query = supabase.table('trades').select('*').eq('user_id', userId);

  const ticker = url.searchParams.get('ticker');
  if (ticker) {
    const t = ticker.toUpperCase();
    if (!isValidTicker(t)) return errorResponse('Invalid ticker format', 400, cors);
    query = query.eq('ticker', t);
  }

  const action = url.searchParams.get('action');
  if (action) {
    const a = action.toUpperCase();
    if (!VALID_ACTIONS.has(a)) return errorResponse('action must be BUY or SELL', 400, cors);
    query = query.eq('action', a);
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
  const { data } = await query.order('trade_date', { ascending: false }).limit(limit);
  const trades = data || [];
  return jsonResponse({ trades, total: trades.length }, 200, cors);
}

// GET /api/trades/stats
async function tradeStats(supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const { data } = await supabase.table('trades').select('*').eq('user_id', userId);
  const trades = data || [];

  const buys = trades.filter(t => t.action === 'BUY');
  const sells = trades.filter(t => t.action === 'SELL');
  const wins = sells.filter(t => t.profit_loss && t.profit_loss > 0);
  const losses = sells.filter(t => t.profit_loss && t.profit_loss <= 0);

  const totalProfitLoss = sells.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
  const winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;
  const avgProfit = wins.length > 0 ? wins.reduce((s, t) => s + t.profit_loss, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.profit_loss, 0) / losses.length : 0;
  const grossProfit = wins.reduce((s, t) => s + t.profit_loss, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit_loss, 0)) || 1;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  return jsonResponse({
    total_trades: trades.length,
    buy_count: buys.length,
    sell_count: sells.length,
    total_profit_loss: totalProfitLoss,
    win_count: wins.length,
    loss_count: losses.length,
    win_rate: winRate,
    avg_profit: avgProfit,
    avg_loss: avgLoss,
    profit_factor: profitFactor,
  }, 200, cors);
}

// GET /api/trades/:id
async function getTrade(supabase: ReturnType<typeof getSupabase>, userId: string, tradeId: string, cors: Record<string, string> | null) {
  const { data } = await supabase.table('trades').select('*').eq('id', tradeId).eq('user_id', userId).limit(1);
  if (!data?.length) return errorResponse(`Trade ${tradeId} not found`, 404, cors);
  return jsonResponse(data[0], 200, cors);
}

// POST /api/trades
async function createTrade(request: Request, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const body = await parseJsonBody(request);
  const ticker = typeof body.ticker === 'string' ? body.ticker.toUpperCase() : '';
  const action = typeof body.action === 'string' ? body.action.toUpperCase() : '';
  if (!isValidTicker(ticker)) return errorResponse('Invalid ticker format', 400, cors);
  if (!VALID_ACTIONS.has(action)) return errorResponse('action must be BUY or SELL', 400, cors);
  if (!isPositiveNumber(body.shares)) return errorResponse('shares must be positive', 400, cors);
  if (!isPositiveNumber(body.price)) return errorResponse('price must be positive', 400, cors);
  const tradeDate = typeof body.trade_date === 'string' ? body.trade_date : '';
  if (!DATE_RE.test(tradeDate)) return errorResponse('trade_date must be YYYY-MM-DD format', 400, cors);

  // holding_id 所有権検証
  if (body.holding_id) {
    const { data: hCheck } = await supabase.table('holdings').select('id').eq('id', body.holding_id).eq('user_id', userId).limit(1);
    if (!hCheck?.length) return errorResponse('Holding not found', 404, cors);
  }

  const insertData: Record<string, unknown> = {
    user_id: userId,
    ticker, action,
    shares: body.shares,
    price: body.price,
    fees: typeof body.fees === 'number' ? body.fees : 0,
    trade_date: tradeDate,
    account_type: body.account_type ?? null,
    regime: body.regime ?? null,
    rs_trend: body.rs_trend ?? null,
    reason: body.reason ?? null,
    holding_id: body.holding_id ?? null,
  };

  if (action === 'SELL') {
    insertData.profit_loss = body.profit_loss ?? null;
    insertData.profit_loss_pct = body.profit_loss_pct ?? null;
    insertData.holding_days = body.holding_days ?? null;
    insertData.lessons_learned = body.lessons_learned ?? null;
  }

  const { data, error } = await supabase.table('trades').insert(insertData).select();
  if (error || !data?.length) return errorResponse('Failed to create trade', 500, cors);
  return jsonResponse(data[0], 201, cors);
}

// POST /api/trades/sell-from-holding
async function sellFromHolding(url: URL, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const holdingId = url.searchParams.get('holding_id');
  const shares = Number(url.searchParams.get('shares'));
  const price = Number(url.searchParams.get('price'));
  const tradeDate = url.searchParams.get('trade_date') || '';
  const fees = Number(url.searchParams.get('fees')) || 0;
  const reason = url.searchParams.get('reason') || null;
  const lessonsLearned = url.searchParams.get('lessons_learned') || null;

  if (!holdingId) return errorResponse('holding_id is required', 400, cors);
  if (!shares || shares <= 0) return errorResponse('shares must be positive', 400, cors);
  if (!price || price <= 0) return errorResponse('price must be positive', 400, cors);
  if (!DATE_RE.test(tradeDate)) return errorResponse('trade_date must be YYYY-MM-DD', 400, cors);

  // 所有権検証つき保有取得
  const { data: holding } = await supabase.table('holdings').select('*').eq('id', holdingId).eq('user_id', userId).limit(1);
  if (!holding?.length) return errorResponse('Holding not found', 404, cors);

  const h = holding[0];
  const avgPrice = Number(h.avg_price);
  const entryDate = h.entry_date;

  // P&L 計算
  const profitLoss = Math.round(((price - avgPrice) * shares - fees) * 100) / 100;
  const profitLossPct = avgPrice ? Math.round(((price / avgPrice) - 1) * 10000) / 100 : 0;

  // 保有日数
  let holdingDays: number | null = null;
  if (entryDate && tradeDate) {
    const entry = new Date(entryDate);
    const trade = new Date(tradeDate);
    if (!isNaN(entry.getTime()) && !isNaN(trade.getTime())) {
      holdingDays = Math.round((trade.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  // SELL 取引を記録
  const { data: tradeResult } = await supabase.table('trades').insert({
    user_id: userId,
    ticker: h.ticker,
    action: 'SELL',
    shares, price, fees,
    trade_date: tradeDate,
    holding_id: holdingId,
    account_type: h.account_type ?? null,
    reason, lessons_learned: lessonsLearned,
    profit_loss: profitLoss,
    profit_loss_pct: profitLossPct,
    holding_days: holdingDays,
  }).select();

  // 保有株数を更新
  const newShares = Number(h.shares) - shares;
  let holdingStatus: string;

  if (newShares <= 0) {
    await supabase.table('holdings').delete().eq('id', holdingId).eq('user_id', userId);
    holdingStatus = 'deleted';
  } else {
    await supabase.table('holdings').update({ shares: newShares }).eq('id', holdingId).eq('user_id', userId);
    holdingStatus = 'updated';
  }

  return jsonResponse({
    status: 'success',
    trade: tradeResult?.[0] ?? null,
    holding_status: holdingStatus,
    profit_loss: profitLoss,
    profit_loss_pct: profitLossPct,
    holding_days: holdingDays,
  }, 200, cors);
}

// DELETE /api/trades/:id
async function deleteTrade(supabase: ReturnType<typeof getSupabase>, userId: string, tradeId: string, cors: Record<string, string> | null) {
  const { data } = await supabase.table('trades').delete().eq('id', tradeId).eq('user_id', userId).select();
  if (!data?.length) return errorResponse(`Trade ${tradeId} not found`, 404, cors);
  return jsonResponse({ status: 'deleted', trade_id: tradeId }, 200, cors);
}
