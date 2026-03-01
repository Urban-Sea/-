/**
 * /api/liquidity — 流動性データ CRUD 部分
 * ポート元: app/backend/routers/liquidity.py の CRUD エンドポイント
 * 計算系 (overview, plumbing-summary 等) は Backend にプロキシ
 */

import type { Env } from '../env';
import { requireAuth, AuthError } from '../middleware/auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody } from '../lib/validation';

export async function handleLiquidityCrud(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/liquidity', '') || '/';
  const method = request.method;

  try {
    if (method === 'GET') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 500);

      if (path === '/fed-balance-sheet') return simpleSelect(supabase, 'fed_balance_sheet', limit, cors);
      if (path === '/interest-rates') return simpleSelect(supabase, 'interest_rates', limit, cors);
      if (path === '/credit-spreads') return simpleSelect(supabase, 'credit_spreads', limit, cors);
      if (path === '/market-indicators') return simpleSelect(supabase, 'market_indicators', limit, cors);
    }

    if (path === '/margin-debt' && method === 'POST') {
      await requireAuth(request, env, supabase);
      return upsertMarginDebt(request, supabase, cors);
    }

    return errorResponse('Not Found', 404, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

// 共通: テーブルから最新 N 件取得
async function simpleSelect(
  supabase: ReturnType<typeof getSupabase>,
  table: string,
  limit: number,
  cors: Record<string, string> | null,
) {
  const { data } = await supabase.table(table).select('*')
    .order('date', { ascending: false }).limit(limit);
  const rows = data || [];
  return jsonResponse({ data: rows, count: rows.length }, 200, cors);
}

// POST /api/liquidity/margin-debt — upsert with 2-year change calc
async function upsertMarginDebt(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const body = await parseJsonBody(request);
  const date = typeof body.date === 'string' ? body.date : '';
  if (!date) return errorResponse('date is required', 400, cors);

  const debitBalance = typeof body.debit_balance === 'number' ? body.debit_balance : 0;
  const freeCredit = typeof body.free_credit === 'number' ? body.free_credit : null;

  // FINRA 形式 (millions) → dollars
  const debitDollars = debitBalance * 1_000_000;
  const freeCreditDollars = freeCredit !== null ? freeCredit * 1_000_000 : null;

  // 2年前のデータを取得して変化率を計算
  let change2y: number | null = null;
  try {
    const year = parseInt(date.slice(0, 4));
    const twoYearsAgo = `${year - 2}${date.slice(4)}`;
    const { data: prev } = await supabase.table('margin_debt')
      .select('debit_balance')
      .lte('date', twoYearsAgo)
      .order('date', { ascending: false })
      .limit(1);

    if (prev?.length && prev[0].debit_balance) {
      const prevVal = Number(prev[0].debit_balance);
      if (prevVal > 0) {
        change2y = Math.round(((debitDollars - prevVal) / prevVal) * 10000) / 100;
      }
    }
  } catch {
    // 2年前データなくても続行
  }

  // Upsert
  const { error } = await supabase.table('margin_debt').upsert({
    date,
    debit_balance: debitDollars,
    free_credit: freeCreditDollars,
    change_2y: change2y,
  }, { onConflict: 'date' });

  if (error) return errorResponse('Failed to upsert margin debt', 500, cors);

  return jsonResponse({
    status: 'ok',
    date,
    debit_balance: debitDollars,
    change_2y: change2y,
  }, 200, cors);
}
