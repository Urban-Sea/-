/**
 * /api/holdings — ポートフォリオ管理
 * ポート元: app/backend/routers/holdings.py (632行)
 */

import type { Env } from '../env';
import { requireAuth, AuthError } from '../middleware/auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody, isValidTicker, isPositiveNumber } from '../lib/validation';

export async function handleHoldings(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/holdings', '') || '/';
  const method = request.method;

  try {
    const userId = await requireAuth(request, env, supabase);

    // Static routes first (before /:param)
    if (path === '/' && method === 'GET') return listHoldings(supabase, userId, cors);
    if (path === '/' && method === 'POST') return createHolding(request, supabase, userId, cors);
    if (path === '/init' && method === 'GET') return initHoldings(supabase, userId, cors);
    if (path === '/portfolio-history' && method === 'GET') return portfolioHistory(url, supabase, userId, cors);
    if (path === '/cash' && method === 'GET') return listCash(supabase, userId, cors);
    if (path === '/cash' && method === 'POST') return createCash(request, supabase, userId, cors);

    // /cash/:id
    const cashMatch = path.match(/^\/cash\/([^/]+)$/);
    if (cashMatch) {
      const cashId = cashMatch[1];
      if (method === 'PUT') return updateCash(request, supabase, userId, cashId, cors);
      if (method === 'DELETE') return deleteCash(supabase, userId, cashId, cors);
    }

    // /:id/add-shares
    const addSharesMatch = path.match(/^\/([^/]+)\/add-shares$/);
    if (addSharesMatch && method === 'POST') {
      return addShares(url, supabase, userId, addSharesMatch[1], cors);
    }

    // /:id (PUT/DELETE) or /:ticker (GET)
    const idMatch = path.match(/^\/([^/]+)$/);
    if (idMatch) {
      const param = idMatch[1];
      if (method === 'GET') return getHolding(supabase, userId, param, cors);
      if (method === 'PUT') return updateHolding(request, supabase, userId, param, cors);
      if (method === 'DELETE') return deleteHolding(supabase, userId, param, cors);
    }

    return errorResponse('Not Found', 404, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

// GET /api/holdings
async function listHoldings(supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const { data } = await supabase
    .table('holdings').select('*').eq('user_id', userId).order('ticker');
  const holdings = data || [];
  const totalValue = holdings.reduce((sum, h) => sum + (h.shares * h.avg_price), 0);
  return jsonResponse({ holdings, total: holdings.length, total_value: totalValue }, 200, cors);
}

// GET /api/holdings/init
async function initHoldings(supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const [holdingsRes, cashRes, fxRes] = await Promise.all([
    supabase.table('holdings').select('*').eq('user_id', userId).order('ticker'),
    supabase.table('cash_balances').select('*').eq('user_id', userId).order('label'),
    supabase.table('market_indicators').select('usdjpy').not('usdjpy', 'is', null).order('date', { ascending: false }).limit(1),
  ]);

  const holdings = holdingsRes.data || [];
  const cash = cashRes.data || [];
  const fxRate = fxRes.data?.[0]?.usdjpy ? Number(fxRes.data[0].usdjpy) : 150.0;
  const totalValue = holdings.reduce((sum, h) => sum + (Number(h.shares) * Number(h.avg_price)), 0);

  return jsonResponse({
    holdings, total: holdings.length, total_value: totalValue,
    cash: { balances: cash, total: cash.length },
    fx_rate: fxRate,
  }, 200, cors);
}

// GET /api/holdings/portfolio-history
async function portfolioHistory(url: URL, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const months = Math.min(Math.max(Number(url.searchParams.get('months')) || 24, 1), 120);
  const cutoff = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data } = await supabase
    .table('portfolio_snapshots')
    .select('snapshot_date, total_market_value_usd, total_cost_usd, unrealized_pnl_usd, cash_usd, total_assets_usd, holdings_count, fx_rate_usdjpy')
    .eq('user_id', userId)
    .gte('snapshot_date', cutoff)
    .order('snapshot_date', { ascending: true });

  const snapshots = data || [];
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  const history = snapshots.map(s => ({
    date: s.snapshot_date,
    total_market_value_usd: Number(s.total_market_value_usd),
    total_cost_usd: Number(s.total_cost_usd),
    unrealized_pnl_usd: Number(s.unrealized_pnl_usd),
    cash_usd: Number(s.cash_usd),
    total_assets_usd: Number(s.total_assets_usd),
    holdings_count: s.holdings_count,
    fx_rate_usdjpy: Number(s.fx_rate_usdjpy || 150.0),
  }));

  return jsonResponse({
    history,
    summary: {
      total_market_value_usd: latest ? Number(latest.total_market_value_usd) : 0,
      total_cost_usd: latest ? Number(latest.total_cost_usd) : 0,
      unrealized_pnl_usd: latest ? Number(latest.unrealized_pnl_usd) : 0,
      total_cash_usd: latest ? Number(latest.cash_usd) : 0,
      total_assets_usd: latest ? Number(latest.total_assets_usd) : 0,
      fx_rate_usdjpy: latest ? Number(latest.fx_rate_usdjpy || 150.0) : 150.0,
    },
  }, 200, cors);
}

// GET /api/holdings/cash
async function listCash(supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const { data } = await supabase.table('cash_balances').select('*').eq('user_id', userId).order('label');
  const balances = data || [];
  return jsonResponse({ balances, total: balances.length }, 200, cors);
}

// POST /api/holdings/cash
async function createCash(request: Request, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const body = await parseJsonBody(request);
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) return errorResponse('label is required', 400, cors);

  const { data, error } = await supabase.table('cash_balances').insert({
    user_id: userId,
    label,
    currency: typeof body.currency === 'string' ? body.currency : 'JPY',
    amount: typeof body.amount === 'number' ? body.amount : 0,
    account_type: typeof body.account_type === 'string' ? body.account_type : null,
  }).select();

  if (error || !data?.length) return errorResponse('Failed to create cash balance', 500, cors);
  return jsonResponse(data[0], 201, cors);
}

// PUT /api/holdings/cash/:id
async function updateCash(request: Request, supabase: ReturnType<typeof getSupabase>, userId: string, cashId: string, cors: Record<string, string> | null) {
  const body = await parseJsonBody(request);
  const updates: Record<string, unknown> = {};
  if (body.label !== undefined) updates.label = body.label;
  if (body.currency !== undefined) updates.currency = body.currency;
  if (body.amount !== undefined) updates.amount = body.amount;
  if (body.account_type !== undefined) updates.account_type = body.account_type;
  if (Object.keys(updates).length === 0) return errorResponse('No update data', 400, cors);

  const { data } = await supabase.table('cash_balances').update(updates).eq('id', cashId).eq('user_id', userId).select();
  if (!data?.length) return errorResponse('Cash balance not found', 404, cors);
  return jsonResponse(data[0], 200, cors);
}

// DELETE /api/holdings/cash/:id
async function deleteCash(supabase: ReturnType<typeof getSupabase>, userId: string, cashId: string, cors: Record<string, string> | null) {
  const { data } = await supabase.table('cash_balances').delete().eq('id', cashId).eq('user_id', userId).select();
  if (!data?.length) return errorResponse('Cash balance not found', 404, cors);
  return jsonResponse({ status: 'deleted', id: cashId }, 200, cors);
}

// GET /api/holdings/:ticker
async function getHolding(supabase: ReturnType<typeof getSupabase>, userId: string, ticker: string, cors: Record<string, string> | null) {
  const t = ticker.toUpperCase();
  if (!isValidTicker(t)) return errorResponse('Invalid ticker format', 400, cors);
  const { data } = await supabase.table('holdings').select('*').eq('ticker', t).eq('user_id', userId).limit(1);
  if (!data?.length) return errorResponse(`Holding ${t} not found`, 404, cors);
  return jsonResponse(data[0], 200, cors);
}

// POST /api/holdings
async function createHolding(request: Request, supabase: ReturnType<typeof getSupabase>, userId: string, cors: Record<string, string> | null) {
  const body = await parseJsonBody(request);
  const ticker = typeof body.ticker === 'string' ? body.ticker.toUpperCase() : '';
  if (!isValidTicker(ticker)) return errorResponse('Invalid ticker format', 400, cors);
  if (!isPositiveNumber(body.shares)) return errorResponse('shares must be positive', 400, cors);
  if (!isPositiveNumber(body.avg_price)) return errorResponse('avg_price must be positive', 400, cors);

  const { data, error } = await supabase.table('holdings').insert({
    user_id: userId,
    ticker,
    shares: body.shares,
    avg_price: body.avg_price,
    entry_date: body.entry_date ?? null,
    account_type: body.account_type ?? 'tokutei',
    sector: body.sector ?? null,
    regime_at_entry: body.regime_at_entry ?? null,
    rs_at_entry: body.rs_at_entry ?? null,
    fx_rate: body.fx_rate ?? 150.0,
    target_price: body.target_price ?? null,
    stop_loss: body.stop_loss ?? null,
    thesis: body.thesis ?? null,
    notes: body.notes ?? null,
  }).select();

  if (error || !data?.length) return errorResponse('Failed to create holding', 500, cors);
  return jsonResponse(data[0], 201, cors);
}

// PUT /api/holdings/:id
async function updateHolding(request: Request, supabase: ReturnType<typeof getSupabase>, userId: string, holdingId: string, cors: Record<string, string> | null) {
  const body = await parseJsonBody(request);
  const updates: Record<string, unknown> = {};
  const fields = ['shares', 'avg_price', 'account_type', 'sector', 'target_price', 'stop_loss', 'thesis', 'notes'];
  for (const f of fields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  if ('shares' in updates && !isPositiveNumber(updates.shares)) return errorResponse('shares must be positive', 400, cors);
  if ('avg_price' in updates && !isPositiveNumber(updates.avg_price)) return errorResponse('avg_price must be positive', 400, cors);
  if (Object.keys(updates).length === 0) return errorResponse('No update data provided', 400, cors);

  const { data } = await supabase.table('holdings').update(updates).eq('id', holdingId).eq('user_id', userId).select();
  if (!data?.length) return errorResponse('Holding not found', 404, cors);
  return jsonResponse(data[0], 200, cors);
}

// DELETE /api/holdings/:id
async function deleteHolding(supabase: ReturnType<typeof getSupabase>, userId: string, holdingId: string, cors: Record<string, string> | null) {
  const { data } = await supabase.table('holdings').delete().eq('id', holdingId).eq('user_id', userId).select();
  if (!data?.length) return errorResponse('Holding not found', 404, cors);
  return jsonResponse({ status: 'deleted', holding_id: holdingId }, 200, cors);
}

// POST /api/holdings/:id/add-shares
async function addShares(url: URL, supabase: ReturnType<typeof getSupabase>, userId: string, holdingId: string, cors: Record<string, string> | null) {
  const shares = Number(url.searchParams.get('shares'));
  const price = Number(url.searchParams.get('price'));
  if (!shares || shares <= 0) return errorResponse('shares must be positive', 400, cors);
  if (!price || price <= 0) return errorResponse('price must be positive', 400, cors);

  const { data: current } = await supabase
    .table('holdings').select('*').eq('id', holdingId).eq('user_id', userId).limit(1);
  if (!current?.length) return errorResponse('Holding not found', 404, cors);

  const oldShares = Number(current[0].shares);
  const oldPrice = Number(current[0].avg_price);
  const newShares = oldShares + shares;
  const newAvgPrice = ((oldShares * oldPrice) + (shares * price)) / newShares;

  await supabase.table('holdings')
    .update({ shares: newShares, avg_price: newAvgPrice })
    .eq('id', holdingId).eq('user_id', userId);

  return jsonResponse({
    status: 'updated',
    holding_id: holdingId,
    old_shares: oldShares,
    new_shares: newShares,
    old_avg_price: oldPrice,
    new_avg_price: Math.round(newAvgPrice * 10000) / 10000,
  }, 200, cors);
}
