/**
 * /api/employment — 雇用データ CRUD 部分
 * ポート元: app/backend/routers/employment.py の CRUD エンドポイント
 * 計算系 (risk-score, risk-history) は Backend にプロキシ
 */

import type { Env } from '../env';
import { requireAuth, AuthError } from '../middleware/auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody } from '../lib/validation';

export async function handleEmploymentCrud(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/employment', '') || '/';
  const method = request.method;

  try {
    if (path === '/overview' && method === 'GET') return overview(supabase, cors);
    if (path === '/indicators' && method === 'GET') return listIndicators(url, supabase, cors);
    if (path === '/indicators' && method === 'POST') {
      await requireAuth(request, env, supabase);
      return upsertIndicator(request, supabase, cors);
    }
    if (path === '/weekly-claims' && method === 'GET') return listWeeklyClaims(url, supabase, cors);

    const revMatch = path.match(/^\/revisions\/(\d+)$/);
    if (revMatch && method === 'GET') return listRevisions(supabase, Number(revMatch[1]), cors);

    return errorResponse('Not Found', 404, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

// GET /api/employment/overview
async function overview(
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const [nfpRes, claimsRes] = await Promise.all([
    supabase.table('economic_indicators').select('*').eq('indicator', 'NFP')
      .order('reference_period', { ascending: false }).limit(1),
    supabase.table('weekly_claims').select('*')
      .order('week_ending', { ascending: false }).limit(1),
  ]);

  const latestNfp = nfpRes.data?.[0] ?? null;
  const latestClaims = claimsRes.data?.[0] ?? null;

  // アラートレベル計算
  let score = 0;
  const factors: string[] = [];

  if (latestNfp) {
    const u3 = latestNfp.u3_rate;
    const nfpChange = latestNfp.nfp_change;
    if (u3 > 5.0) { score += 2; factors.push('U3 rate > 5.0%'); }
    else if (u3 > 4.5) { score += 1; factors.push('U3 rate > 4.5%'); }
    if (nfpChange !== null) {
      if (nfpChange < 0) { score += 2; factors.push('NFP negative'); }
      else if (nfpChange < 100) { score += 1; factors.push('NFP < 100K'); }
    }
  }
  if (latestClaims) {
    const ic = latestClaims.initial_claims;
    if (ic > 300000) { score += 2; factors.push('Initial claims > 300K'); }
    else if (ic > 250000) { score += 1; factors.push('Initial claims > 250K'); }
  }

  const alertLevel = score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Low';

  return jsonResponse({
    latest_nfp: latestNfp,
    latest_claims: latestClaims,
    alert_level: alertLevel,
    alert_factors: factors,
  }, 200, cors);
}

// GET /api/employment/indicators
async function listIndicators(
  url: URL,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 12, 1), 500);
  let query = supabase.table('economic_indicators').select('*');

  const indicator = url.searchParams.get('indicator');
  if (indicator) query = query.eq('indicator', indicator.toUpperCase());

  const { data } = await query.order('reference_period', { ascending: false }).limit(limit);
  const rows = data || [];
  return jsonResponse({ data: rows, count: rows.length }, 200, cors);
}

// GET /api/employment/weekly-claims
async function listWeeklyClaims(
  url: URL,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 12, 1), 500);
  const { data } = await supabase.table('weekly_claims').select('*')
    .order('week_ending', { ascending: false }).limit(limit);
  const rows = data || [];
  return jsonResponse({ data: rows, count: rows.length }, 200, cors);
}

// GET /api/employment/revisions/:indicator_id
async function listRevisions(
  supabase: ReturnType<typeof getSupabase>,
  indicatorId: number,
  cors: Record<string, string> | null,
) {
  const { data } = await supabase.table('economic_indicator_revisions').select('*')
    .eq('indicator_id', indicatorId).order('revision_number');
  const rows = data || [];
  return jsonResponse({ data: rows, count: rows.length }, 200, cors);
}

// POST /api/employment/indicators — upsert with revision tracking
async function upsertIndicator(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const body = await parseJsonBody(request);
  const indicator = typeof body.indicator === 'string' ? body.indicator.toUpperCase() : '';
  const referencePeriod = typeof body.reference_period === 'string' ? body.reference_period : '';
  if (!indicator || !referencePeriod) {
    return errorResponse('indicator and reference_period are required', 400, cors);
  }

  // 既存チェック
  const { data: existing } = await supabase.table('economic_indicators')
    .select('id, current_value, revision_count')
    .eq('indicator', indicator)
    .eq('reference_period', referencePeriod)
    .limit(1);

  const insertFields: Record<string, unknown> = {
    indicator,
    reference_period: referencePeriod,
    current_value: body.current_value ?? null,
    nfp_change: body.nfp_change ?? null,
    u3_rate: body.u3_rate ?? null,
    u6_rate: body.u6_rate ?? null,
    avg_hourly_earnings: body.avg_hourly_earnings ?? null,
    wage_mom: body.wage_mom ?? null,
    labor_force_participation: body.labor_force_participation ?? null,
    notes: body.notes ?? null,
  };

  if (!existing?.length) {
    // 新規作成
    insertFields.revision_count = 0;
    const { data: created } = await supabase.table('economic_indicators').insert(insertFields).select('id');
    if (!created?.length) return errorResponse('Failed to create indicator', 500, cors);

    // 初回リビジョン
    await supabase.table('economic_indicator_revisions').insert({
      indicator_id: created[0].id,
      revision_number: 0,
      value: body.current_value ?? null,
      notes: '速報',
    });

    return jsonResponse({ status: 'created', id: created[0].id, revision_number: 0 }, 201, cors);
  }

  // 既存更新
  const ex = existing[0];
  const valueChanged = body.current_value !== undefined && body.current_value !== ex.current_value;

  if (valueChanged) {
    const newRevCount = (ex.revision_count || 0) + 1;
    insertFields.revision_count = newRevCount;

    await supabase.table('economic_indicators').update(insertFields).eq('id', ex.id);

    const change = Number(body.current_value) - Number(ex.current_value);
    await supabase.table('economic_indicator_revisions').insert({
      indicator_id: ex.id,
      revision_number: newRevCount,
      value: body.current_value,
      change_from_prev: change,
      change_pct_from_prev: ex.current_value ? Math.round((change / ex.current_value) * 10000) / 100 : null,
      notes: body.notes ?? null,
    });

    return jsonResponse({
      status: 'revised', id: ex.id,
      revision_number: newRevCount,
      change,
      direction: change > 0 ? '上方修正' : '下方修正',
    }, 200, cors);
  }

  // 値変更なし → その他フィールドのみ更新
  await supabase.table('economic_indicators').update(insertFields).eq('id', ex.id);
  return jsonResponse({
    status: 'updated', id: ex.id,
    revision_number: ex.revision_count || 0,
    change: null, direction: null,
  }, 200, cors);
}
