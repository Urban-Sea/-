/**
 * /api/admin — 管理者用 CRUD エンドポイント
 * ポート元: app/backend/routers/admin.py
 * 全エンドポイント requireAdminMfa
 */

import type { Env } from '../env';
import { AuthError } from '../middleware/auth';
import { requireAdminMfa, auditLog } from '../middleware/admin-auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody } from '../lib/validation';

const VALID_PLANS = new Set(['free', 'pro_trial', 'pro', 'demo']);

export async function handleAdmin(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/admin', '') || '/';
  const method = request.method;

  try {
    const adminId = await requireAdminMfa(request, env, supabase);

    // Users
    if (path === '/users' && method === 'GET') return listUsers(supabase, cors);
    const userMatch = path.match(/^\/users\/([^/]+)$/);
    if (userMatch && method === 'PATCH') {
      return updateUser(request, supabase, adminId, userMatch[1], cors);
    }

    // Stats
    if (path === '/stats' && method === 'GET') return getStats(supabase, cors);

    // Audit Logs
    if (path === '/audit-logs' && method === 'GET') return listAuditLogs(url, supabase, cors);

    // Batch Logs
    if (path === '/batch-logs' && method === 'GET') return listBatchLogs(url, supabase, cors);

    // Feature Flags
    if (path === '/feature-flags' && method === 'GET') return listFeatureFlags(supabase, cors);
    if (path === '/feature-flags' && method === 'POST') {
      return createFeatureFlag(request, supabase, adminId, cors);
    }
    const flagMatch = path.match(/^\/feature-flags\/(\d+)$/);
    if (flagMatch && method === 'PATCH') {
      return updateFeatureFlag(request, supabase, adminId, Number(flagMatch[1]), cors);
    }

    return errorResponse('Not Found', 404, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

// GET /api/admin/users
async function listUsers(
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const { data } = await supabase
    .table('users')
    .select('id, email, display_name, plan, auth_provider, is_active, last_login_at, created_at')
    .order('created_at', { ascending: true });
  const users = data || [];
  return jsonResponse({ users, total: users.length }, 200, cors);
}

// PATCH /api/admin/users/:id
async function updateUser(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  adminId: string,
  targetUserId: string,
  cors: Record<string, string> | null,
) {
  const body = await parseJsonBody(request);
  const allowed = new Set(['plan', 'display_name', 'is_active']);
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (allowed.has(k)) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return errorResponse('No valid fields to update', 400, cors);
  }

  if ('plan' in updates && !VALID_PLANS.has(updates.plan as string)) {
    return errorResponse(
      `Invalid plan. Must be one of: ${[...VALID_PLANS].sort().join(', ')}`,
      400, cors,
    );
  }
  if ('is_active' in updates && typeof updates.is_active !== 'boolean') {
    return errorResponse('is_active must be boolean', 400, cors);
  }

  // 変更前の値を取得（監査ログ用）
  const { data: old } = await supabase
    .table('users')
    .select('plan, display_name, is_active')
    .eq('id', targetUserId)
    .limit(1);
  const oldValue = old?.[0] ?? {};

  await supabase.table('users').update(updates).eq('id', targetUserId);

  await auditLog(supabase, adminId, 'update_user', 'user', targetUserId, oldValue, updates);

  return jsonResponse({ status: 'updated' }, 200, cors);
}

// GET /api/admin/stats
async function getStats(
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const now = new Date();
  const day7 = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const day30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [allRes, active7dRes, active30dRes, newMonthRes, recentRes] = await Promise.all([
    supabase.table('users').select('id', { count: 'exact' }),
    supabase.table('users').select('id', { count: 'exact' }).gte('last_login_at', day7),
    supabase.table('users').select('id', { count: 'exact' }).gte('last_login_at', day30),
    supabase.table('users').select('id', { count: 'exact' }).gte('created_at', monthStart),
    supabase.table('users').select('created_at').gte('created_at', day30).order('created_at', { ascending: true }),
  ]);

  // 日別登録数
  const dailySignups: Record<string, number> = {};
  for (const u of recentRes.data || []) {
    const day = (u.created_at as string).slice(0, 10);
    dailySignups[day] = (dailySignups[day] || 0) + 1;
  }

  return jsonResponse({
    total_users: allRes.count || 0,
    active_7d: active7dRes.count || 0,
    active_30d: active30dRes.count || 0,
    new_this_month: newMonthRes.count || 0,
    daily_signups: Object.entries(dailySignups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
  }, 200, cors);
}

// GET /api/admin/audit-logs
async function listAuditLogs(
  url: URL,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);

  const { data } = await supabase
    .table('admin_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = data || [];

  // admin_user_id → email マッピング
  const adminIds = [...new Set(rows.map(r => r.admin_user_id))].filter(Boolean);
  let emailMap: Record<string, string> = {};
  if (adminIds.length > 0) {
    const { data: admins } = await supabase
      .table('users')
      .select('id, email')
      .in('id', adminIds);
    emailMap = Object.fromEntries((admins || []).map(a => [a.id, a.email]));
  }

  const logs = rows.map(r => ({
    ...r,
    admin_email: emailMap[r.admin_user_id] || 'unknown',
  }));

  return jsonResponse({ logs, total: logs.length }, 200, cors);
}

// GET /api/admin/batch-logs
async function listBatchLogs(
  url: URL,
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);

  const { data } = await supabase
    .table('batch_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  const logs = data || [];
  return jsonResponse({ logs, total: logs.length }, 200, cors);
}

// GET /api/admin/feature-flags
async function listFeatureFlags(
  supabase: ReturnType<typeof getSupabase>,
  cors: Record<string, string> | null,
) {
  const { data } = await supabase
    .table('feature_flags')
    .select('*')
    .order('created_at', { ascending: true });
  const flags = data || [];
  return jsonResponse({ flags, total: flags.length }, 200, cors);
}

// POST /api/admin/feature-flags
async function createFeatureFlag(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  adminId: string,
  cors: Record<string, string> | null,
) {
  const body = await parseJsonBody(request);
  const flagKey = typeof body.flag_key === 'string' ? body.flag_key.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (!flagKey) return errorResponse('flag_key is required', 400, cors);

  const { data, error } = await supabase.table('feature_flags').insert({
    flag_key: flagKey,
    description: description || null,
    enabled: false,
  }).select();

  if (error) return errorResponse('Flag key already exists', 409, cors);

  await auditLog(supabase, adminId, 'create_feature_flag', 'feature_flag', flagKey,
    undefined, { flag_key: flagKey, enabled: false });

  return jsonResponse({ flag: data?.[0] ?? null }, 201, cors);
}

// PATCH /api/admin/feature-flags/:id
async function updateFeatureFlag(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  adminId: string,
  flagId: number,
  cors: Record<string, string> | null,
) {
  const body = await parseJsonBody(request);
  if (typeof body.enabled !== 'boolean') {
    return errorResponse('enabled must be boolean', 400, cors);
  }

  const { data: old } = await supabase
    .table('feature_flags')
    .select('flag_key, enabled')
    .eq('id', flagId)
    .limit(1);

  if (!old?.length) return errorResponse('Flag not found', 404, cors);

  await supabase.table('feature_flags').update({
    enabled: body.enabled,
    updated_at: new Date().toISOString(),
  }).eq('id', flagId);

  await auditLog(supabase, adminId, 'update_feature_flag', 'feature_flag', old[0].flag_key,
    { enabled: old[0].enabled }, { enabled: body.enabled });

  return jsonResponse({ status: 'updated' }, 200, cors);
}
