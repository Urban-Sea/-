import { Redis } from '@upstash/redis';
import type { Env } from '../env';

let _redis: Redis | null = null;

export function getRedis(env: Env): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}
