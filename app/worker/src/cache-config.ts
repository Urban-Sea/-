/** Cache TTL configuration per API endpoint. Returns TTL in seconds, or 0 for no-cache. */

interface CacheRule {
  pattern: RegExp;
  ttl: number; // seconds
}

const CACHE_RULES: CacheRule[] = [
  // Daily batch data — cache until next batch (24h)
  { pattern: /^\/api\/liquidity\/overview$/, ttl: 24 * 3600 },
  { pattern: /^\/api\/liquidity\/plumbing-summary$/, ttl: 24 * 3600 },
  { pattern: /^\/api\/liquidity\/events$/, ttl: 24 * 3600 },
  { pattern: /^\/api\/liquidity\/policy-regime$/, ttl: 24 * 3600 },
  { pattern: /^\/api\/liquidity\/history-charts$/, ttl: 24 * 3600 },
  { pattern: /^\/api\/liquidity\/backtest-states$/, ttl: 24 * 3600 },

  // Employment — also daily batch
  { pattern: /^\/api\/employment\/risk-score$/, ttl: 24 * 3600 },
  { pattern: /^\/api\/employment\/risk-history$/, ttl: 24 * 3600 },
  { pattern: /^\/api\/employment\/overview$/, ttl: 24 * 3600 },

  // Master data
  { pattern: /^\/api\/stocks$/, ttl: 24 * 3600 },

  // Market-connected, short cache
  { pattern: /^\/api\/regime$/, ttl: 5 * 60 },
  { pattern: /^\/api\/market-state\/latest$/, ttl: 5 * 60 },
  { pattern: /^\/api\/fx\/usdjpy$/, ttl: 5 * 60 },
  { pattern: /^\/api\/stock\/batch-quotes/, ttl: 5 * 60 },

  // Per-user endpoints — no cache (cache poisoning 防止: C3)
  // Backend が JWT で認証するため、Worker 側でユーザーデータをキャッシュしない
  { pattern: /^\/api\/me/, ttl: 0 },
  { pattern: /^\/api\/holdings/, ttl: 0 },
  { pattern: /^\/api\/trades/, ttl: 0 },
  { pattern: /^\/api\/watchlist/, ttl: 0 },

  // No cache: real-time / on-demand
  { pattern: /^\/api\/signal\//, ttl: 0 },
  { pattern: /^\/api\/stock\//, ttl: 0 },
  { pattern: /^\/api\/exit\//, ttl: 0 },
];

export function getCacheTtl(pathname: string): number {
  for (const rule of CACHE_RULES) {
    if (rule.pattern.test(pathname)) {
      return rule.ttl;
    }
  }
  // Default: no cache for unknown endpoints
  return 0;
}
