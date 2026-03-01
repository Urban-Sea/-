/** H7: IP ベースレートリミッター (120 req/min/IP)
 *
 * L1: Redis (Upstash REST) — 永続化、isolate 間で共有
 * L2: インメモリ Map — Redis 障害時のフォールバック
 */

import type { Env } from '../env';
import { getRedis } from '../lib/redis';

const RATE_LIMIT = 120;
const RATE_WINDOW_SECONDS = 60;

// フォールバック: インメモリ Map
const ipHits = new Map<string, { count: number; resetAt: number }>();
let requestCounter = 0;

function checkRateLimitFallback(ip: string): boolean {
  const now = Date.now();

  if (++requestCounter % 100 === 0) {
    for (const [key, val] of ipHits) {
      if (val.resetAt <= now) ipHits.delete(key);
    }
  }

  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_SECONDS * 1000 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

export async function checkRateLimit(ip: string, env: Env): Promise<boolean> {
  try {
    const redis = getRedis(env);
    const key = `rl:ip:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, RATE_WINDOW_SECONDS);
    }
    return count <= RATE_LIMIT;
  } catch {
    // Redis 障害時はインメモリにフォールバック
    return checkRateLimitFallback(ip);
  }
}
