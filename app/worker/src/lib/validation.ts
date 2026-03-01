/** Ticker シンボルのバリデーション (大文字英数字 + . + - のみ, 1-10文字) */
const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export function isValidTicker(ticker: string): boolean {
  return TICKER_RE.test(ticker);
}

/** メールアドレスの簡易バリデーション */
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** UUID v4 のバリデーション */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(id: string): boolean {
  return UUID_RE.test(id);
}

/** リクエストボディを安全にパース */
export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {};
    }
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 正の数値かチェック */
export function isPositiveNumber(val: unknown): val is number {
  return typeof val === 'number' && val > 0 && isFinite(val);
}

/** 文字列を安全にトリム（null/undefined → undefined） */
export function trimOrUndef(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed || undefined;
}
