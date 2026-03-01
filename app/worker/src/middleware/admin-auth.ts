/**
 * Admin 認証ミドルウェア
 * require_admin: JWT 認証 + ADMIN_EMAILS チェック
 * require_admin_mfa: require_admin + MFA セッション検証
 */

import type { Env } from '../env';
import type { AppSupabase } from '../lib/supabase';
import { requireAuth, AuthError } from './auth';

/** ADMIN_EMAILS 環境変数をパースしてセットに変換 */
function getAdminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** メールアドレスが管理者かどうか判定 */
export function isAdminEmail(email: string, env: Env): boolean {
  return getAdminEmails(env).has(email.trim().toLowerCase());
}

/** 管理者権限を検証 — users テーブルから email を取得し ADMIN_EMAILS と照合 */
export async function requireAdmin(
  request: Request,
  env: Env,
  supabase: AppSupabase,
): Promise<string> {
  const userId = await requireAuth(request, env, supabase);

  const { data } = await supabase
    .table('users')
    .select('email')
    .eq('id', userId)
    .limit(1);

  if (!data || data.length === 0) {
    throw new AuthError(404, 'Not Found');
  }

  const email = data[0].email.toLowerCase();
  if (!getAdminEmails(env).has(email)) {
    throw new AuthError(404, 'Not Found');
  }

  return userId;
}

/** 管理者 + MFA セッション検証 */
export async function requireAdminMfa(
  request: Request,
  env: Env,
  supabase: AppSupabase,
): Promise<string> {
  const adminId = await requireAdmin(request, env, supabase);

  // MFA 設定状態チェック
  const { data: mfaData } = await supabase
    .table('admin_mfa')
    .select('enabled')
    .eq('user_id', adminId)
    .limit(1);

  // MFA 未設定 or 無効 → そのまま通過
  if (!mfaData || mfaData.length === 0 || !mfaData[0].enabled) {
    return adminId;
  }

  // MFA 有効 → トークン検証必須
  const xMfaToken = request.headers.get('X-MFA-Token');
  if (!xMfaToken) {
    throw new AuthError(403, 'MFA verification required');
  }

  // SHA-256 ハッシュ
  const tokenBytes = new TextEncoder().encode(xMfaToken);
  const hashBuf = await crypto.subtle.digest('SHA-256', tokenBytes);
  const tokenHash = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const now = new Date().toISOString();
  const { data: session } = await supabase
    .table('admin_mfa_sessions')
    .select('id')
    .eq('user_id', adminId)
    .eq('token_hash', tokenHash)
    .gte('expires_at', now)
    .limit(1);

  if (!session || session.length === 0) {
    throw new AuthError(403, 'MFA session expired or invalid');
  }

  return adminId;
}

/** 監査ログを記録（失敗しても例外にしない） */
export async function auditLog(
  supabase: AppSupabase,
  adminUserId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  oldValue?: Record<string, unknown>,
  newValue?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.table('admin_audit_logs').insert({
      admin_user_id: adminUserId,
      action,
      target_type: targetType ?? null,
      target_id: targetId ?? null,
      old_value: oldValue ? JSON.stringify(oldValue) : null,
      new_value: newValue ? JSON.stringify(newValue) : null,
    });
  } catch {
    // audit log failure is non-critical
  }
}
