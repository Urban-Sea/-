/** H7: IP ベースの簡易レートリミッター (120 req/min/IP) */

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const ipHits = new Map<string, { count: number; resetAt: number }>();
let requestCounter = 0;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // 100リクエストごとに期限切れエントリをクリーンアップ
  if (++requestCounter % 100 === 0) {
    for (const [key, val] of ipHits) {
      if (val.resetAt <= now) ipHits.delete(key);
    }
  }

  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}
