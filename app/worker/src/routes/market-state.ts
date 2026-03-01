/**
 * /api/market-state — 市場状態 CRUD
 * ポート元: app/backend/routers/market_state.py
 */

import type { Env } from '../env';
import { requireAuth, AuthError } from '../middleware/auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody } from '../lib/validation';

export async function handleMarketState(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/market-state', '') || '/';
  const method = request.method;

  try {
    if (path === '/' && method === 'GET') return listMarketState(url, supabase, cors);
    if (path === '/latest' && method === 'GET') return latestMarketState(supabase, cors);
    if (path === '/' && method === 'POST') {
      const userId = await requireAuth(request, env, supabase);
      return createMarketState(request, supabase, cors);
    }

    return errorResponse('Not Found', 404, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

// GET /api/market-state
async function listMarketState(
  url: URL,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 365);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  const { data, count } = await supabase
    .table('market_state_history')
    .select('*', { count: 'exact' })
    .order('date', { ascending: false })
    .range(offset, offset + limit - 1);

  return jsonResponse({ records: data || [], total: count || 0 }, 200, cors);
}

// GET /api/market-state/latest
async function latestMarketState(
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const { data } = await supabase
    .table('market_state_history')
    .select('*')
    .order('date', { ascending: false })
    .limit(1);

  if (!data?.length) return errorResponse('No market state data found', 404, cors);
  return jsonResponse(data[0], 200, cors);
}

// POST /api/market-state
async function createMarketState(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const body = await parseJsonBody(request);
  if (!body.date) return errorResponse('date is required', 400, cors);

  const { data, error } = await supabase
    .table('market_state_history')
    .insert({
      date: body.date,
      spy_regime: body.spy_regime ?? null,
      qqq_regime: body.qqq_regime ?? null,
      btc_regime: body.btc_regime ?? null,
      overall_regime: body.overall_regime ?? null,
      layer1_stress: body.layer1_stress ?? null,
      layer2_stress: body.layer2_stress ?? null,
      layer3_stress: body.layer3_stress ?? null,
      layer4_stress: body.layer4_stress ?? null,
      overall_stress: body.overall_stress ?? null,
      notes: body.notes ?? null,
    })
    .select();

  if (error || !data?.length) return errorResponse('Failed to create market state', 500, cors);
  return jsonResponse({ status: 'success', id: data[0].id }, 201, cors);
}
