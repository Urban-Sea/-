import useSWR from 'swr';
import { getAuthEmail } from './auth-store';
import { getMfaToken } from './mfa-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://open-regime-api.ryu3ta-ke-mo100307.workers.dev';

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const email = getAuthEmail();
  const mfaToken = getMfaToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(email ? { 'X-User-Email': email } : {}),
      ...(mfaToken ? { 'X-MFA-Token': mfaToken } : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || body.message || JSON.stringify(body);
    } catch {
      // ignore parse error
    }
    throw new Error(`API Error ${response.status}: ${detail}`);
  }

  return response.json();
}

// ============================================================
// Types
// ============================================================

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  auth_provider: string;
  is_active?: boolean;
  created_at: string;
  last_login_at: string | null;
  is_admin?: boolean;
}

export interface AdminUsersResponse {
  users: UserProfile[];
  total: number;
}

export interface AdminStats {
  total_users: number;
  active_7d: number;
  active_30d: number;
  new_this_month: number;
  daily_signups: { date: string; count: number }[];
}

export interface AuditLog {
  id: number;
  admin_user_id: string;
  admin_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface BatchLog {
  id: number;
  job_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  records_processed: number;
  error_message: string | null;
  details: Record<string, unknown> | null;
}

export interface FeatureFlag {
  id: number;
  flag_key: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// MFA Types & Functions
// ============================================================

export interface MfaStatus {
  mfa_enabled: boolean;
  mfa_setup: boolean;
}

export interface MfaSetupResponse {
  secret: string;
  qr_code: string;
  provisioning_uri: string;
}

export interface MfaVerifyResponse {
  status: string;
  token: string;
  expires_at: string;
}

export interface MfaSessionResponse {
  valid: boolean;
  reason?: string;
  expires_at?: string;
}

export async function fetchMfaStatus(): Promise<MfaStatus> {
  return fetchAPI('/api/admin/mfa/status');
}

export async function startMfaSetup(): Promise<MfaSetupResponse> {
  return fetchAPI('/api/admin/mfa/setup', { method: 'POST' });
}

export async function verifyMfaSetup(code: string): Promise<MfaVerifyResponse> {
  return fetchAPI('/api/admin/mfa/setup/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function verifyMfaCode(code: string): Promise<MfaVerifyResponse> {
  return fetchAPI('/api/admin/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function checkMfaSession(): Promise<MfaSessionResponse> {
  return fetchAPI('/api/admin/mfa/session');
}

/** H4: サーバー側で MFA セッションを無効化 */
export async function logoutMfa(): Promise<{ status: string }> {
  return fetchAPI('/api/admin/mfa/session', { method: 'DELETE' });
}

// ============================================================
// Hooks
// ============================================================

export function useMe() {
  return useSWR<UserProfile>('/api/me');
}

export function useAdminUsers() {
  return useSWR<AdminUsersResponse>('/api/admin/users');
}

export function useAdminStats() {
  return useSWR<AdminStats>('/api/admin/stats');
}

export function useAuditLogs(limit = 50) {
  return useSWR<{ logs: AuditLog[]; total: number }>(
    `/api/admin/audit-logs?limit=${limit}`,
  );
}

export function useBatchLogs(limit = 50) {
  return useSWR<{ logs: BatchLog[]; total: number }>(
    `/api/admin/batch-logs?limit=${limit}`,
  );
}

export function useFeatureFlags() {
  return useSWR<{ flags: FeatureFlag[]; total: number }>(
    '/api/admin/feature-flags',
  );
}

// ============================================================
// Mutations
// ============================================================

export async function updateUser(
  userId: string,
  data: { plan?: string; display_name?: string; is_active?: boolean },
): Promise<{ status: string }> {
  return fetchAPI(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function createFeatureFlag(
  data: { flag_key: string; description?: string },
): Promise<{ flag: FeatureFlag }> {
  return fetchAPI('/api/admin/feature-flags', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateFeatureFlag(
  flagId: number,
  data: { enabled: boolean },
): Promise<{ status: string }> {
  return fetchAPI(`/api/admin/feature-flags/${flagId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
