/**
 * /api/me — ユーザープロフィール
 * ポート元: app/backend/routers/users.py
 */

import type { Env } from '../env';
import { requireAuth, AuthError } from '../middleware/auth';
import { isAdminEmail } from '../middleware/admin-auth';
import { getSupabase } from '../lib/supabase';
import { jsonResponse, errorResponse } from '../lib/response';
import { parseJsonBody } from '../lib/validation';

const UPDATABLE_FIELDS = new Set(['display_name']);

export async function handleMe(
  request: Request,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const supabase = getSupabase(env);

  try {
    const userId = await requireAuth(request, env, supabase);

    if (request.method === 'GET') {
      return getMe(supabase, userId, env, cors);
    }
    if (request.method === 'PATCH') {
      return updateMe(request, supabase, userId, cors);
    }

    return errorResponse('Method not allowed', 405, cors);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status, cors);
    return errorResponse('Internal server error', 500, cors);
  }
}

async function getMe(
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
  env: Env,
  cors: Record<string, string> | null,
): Promise<Response> {
  const { data } = await supabase
    .table('users')
    .select('id, email, display_name, plan, auth_provider, created_at')
    .eq('id', userId)
    .limit(1);

  if (!data || data.length === 0) {
    return errorResponse('User not found', 404, cors);
  }

  const user = data[0] as Record<string, unknown>;
  user.is_admin = isAdminEmail((user.email as string) || '', env);
  return jsonResponse(user, 200, cors);
}

async function updateMe(
  request: Request,
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
  cors: Record<string, string> | null,
): Promise<Response> {
  const body = await parseJsonBody(request);
  const updates: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(body)) {
    if (UPDATABLE_FIELDS.has(k)) updates[k] = v;
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('No valid fields to update', 400, cors);
  }

  // display_name バリデーション
  if ('display_name' in updates) {
    const name = updates.display_name;
    if (name !== null) {
      const trimmed = String(name).trim();
      if (trimmed.length > 50) {
        return errorResponse('Display name too long (max 50)', 400, cors);
      }
      updates.display_name = trimmed || null;
    }
  }

  await supabase.table('users').update(updates).eq('id', userId);
  return jsonResponse({ status: 'updated' }, 200, cors);
}
