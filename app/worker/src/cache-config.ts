/** Cache TTL configuration per API endpoint. Returns TTL in seconds, or 0 for no-cache. */

interface CacheRule {
  pattern: RegExp;
  ttl: number; // seconds
}

const CACHE_RULES: CacheRule[] = [
  // Pre-computed daily batch data — long cache
  { pattern: /^\/api\/employment\/risk-score$/, ttl: 4 * 3600 },
  { pattern: /^\/api\/liquidity\/plumbing-summary$/, ttl: 4 * 3600 },
  { pattern: /^\/api\/liquidity\/events$/, ttl: 4 * 3600 },
  { pattern: /^\/api\/liquidity\/policy-regime$/, ttl: 4 * 3600 },

  // Heavy computation, monthly/infrequent data
  { pattern: /^\/api\/employment\/risk-history$/, ttl: 2 * 3600 },
  { pattern: /^\/api\/liquidity\/backtest-states$/, ttl: 2 * 3600 },

  // History / master data
  { pattern: /^\/api\/liquidity\/history-charts$/, ttl: 1 * 3600 },
  { pattern: /^\/api\/stocks$/, ttl: 1 * 3600 },

  // Weekly-ish refresh
  { pattern: /^\/api\/employment\/overview$/, ttl: 30 * 60 },

  // Aggregated data
  { pattern: /^\/api\/liquidity\/overview$/, ttl: 15 * 60 },

  // Market-connected, short cache
  { pattern: /^\/api\/regime$/, ttl: 5 * 60 },
  { pattern: /^\/api\/market-state\/latest$/, ttl: 5 * 60 },
  { pattern: /^\/api\/fx\/usdjpy$/, ttl: 5 * 60 },
  { pattern: /^\/api\/stock\/batch-quotes/, ttl: 5 * 60 },

  // User data: short per-user cache (cache key includes X-User-Email)
  { pattern: /^\/api\/holdings\/init$/, ttl: 60 },              // 1 min
  { pattern: /^\/api\/holdings$/, ttl: 60 },                    // 1 min (GET list only)
  { pattern: /^\/api\/holdings\/portfolio-history/, ttl: 120 },  // 2 min (daily batch data)
  { pattern: /^\/api\/holdings\/cash$/, ttl: 60 },              // 1 min (GET list only)
  // Holdings sub-routes (CRUD /{id}, /sell etc.) — no cache
  { pattern: /^\/api\/holdings\//, ttl: 0 },
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
