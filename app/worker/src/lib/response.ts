import { SECURITY_HEADERS } from '../middleware/security-headers';
import { safeCors } from '../middleware/cors';

/** JSON レスポンスを生成 */
export function jsonResponse(
  data: unknown,
  status: number = 200,
  cors: Record<string, string> | null = null,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...safeCors(cors),
      ...SECURITY_HEADERS,
    },
  });
}

/** エラーレスポンスを生成 (FastAPI 互換形式: { detail: string }) */
export function errorResponse(
  detail: string,
  status: number,
  cors: Record<string, string> | null = null,
): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...safeCors(cors),
      ...SECURITY_HEADERS,
    },
  });
}
