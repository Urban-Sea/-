import type { Env } from '../env';

/** 許可オリジンリストを構築 */
export function buildAllowedOrigins(env: Env): string[] {
  const raw = env.ALLOWED_ORIGIN || '';
  const allowed = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.some(o => o.startsWith('http://localhost'))) {
    if (!allowed.includes('http://localhost:3000')) allowed.push('http://localhost:3000');
    if (!allowed.includes('http://localhost:3001')) allowed.push('http://localhost:3001');
  }
  return allowed;
}

/** CORS ヘッダー — M1: 不正 Origin には null を返す */
export function corsHeaders(origin: string, allowed: string[]): Record<string, string> | null {
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email, X-MFA-Token',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

/** CORS ヘッダーを安全に結合（null なら空オブジェクト） */
export function safeCors(cors: Record<string, string> | null): Record<string, string> {
  return cors ?? {};
}
