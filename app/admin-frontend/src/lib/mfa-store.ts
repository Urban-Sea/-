/**
 * MFA トークン管理 (localStorage)
 * - セッショントークンを保存・取得・削除
 * - 有効期限チェック
 */

const MFA_TOKEN_KEY = 'admin_mfa_token';
const MFA_EXPIRES_KEY = 'admin_mfa_expires';

export function getMfaToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(MFA_TOKEN_KEY);
  const expires = localStorage.getItem(MFA_EXPIRES_KEY);

  if (!token || !expires) return null;

  // 有効期限チェック
  if (new Date(expires) <= new Date()) {
    clearMfaToken();
    return null;
  }

  return token;
}

export function setMfaToken(token: string, expiresAt: string): void {
  localStorage.setItem(MFA_TOKEN_KEY, token);
  localStorage.setItem(MFA_EXPIRES_KEY, expiresAt);
}

export function clearMfaToken(): void {
  localStorage.removeItem(MFA_TOKEN_KEY);
  localStorage.removeItem(MFA_EXPIRES_KEY);
}
