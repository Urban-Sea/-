import useSWR from 'swr';
import type {
  StockMaster,
  SignalResponse,
  RegimeResponse,
  MarketStateRecord,
  LatestMarketState,
  LiquidityOverview,
  FedBalanceSheet,
  InterestRates,
  CreditSpreads,
  MarketIndicators,
  PlumbingSummary,
  HoldingRecord,
  HoldingsResponse,
  TradeRecord,
  TradeStats,
  EmploymentOverview,
  EconomicIndicator,
  WeeklyClaims,
  EmploymentRiskScore,
  RiskHistoryResponse,
  StockQuote,
  StockHistoryResponse,
  ExitAnalysisResponse,
  SignalHistoryResponse,
  ChartMarkersResponse,
  BatchResponse,
  HistoryChartsData,
  BacktestData,
  MarketEventsData,
  PolicyRegimeData,
  PortfolioHistoryResponse,
  CashBalancesResponse,
  HoldingsInitResponse,
  WatchlistsResponse,
  DiscoveryResponse,
} from '@/types';

import { isRedirecting, markRedirecting } from './auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshPromise: Promise<boolean> | null = null;

export async function refreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  }).then(r => r.ok).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit, isRetry = false): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...options?.headers,
    },
  });

  if (response.status === 401 && !isRetry) {
    const refreshed = await refreshToken();
    if (refreshed) {
      return fetchAPI(endpoint, options, true);
    }
    // 開発環境では auth bypass しているので redirect ループを避けるためエラーだけ throw
    if (typeof window !== 'undefined' && !isRedirecting() && process.env.NODE_ENV !== 'development') {
      markRedirecting();
      fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).catch(() => {});
      window.location.href = '/login/';
    }
    throw new ApiError(401, 'Session expired');
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || body.message || JSON.stringify(body);
    } catch {
      // ignore parse error
    }
    throw new ApiError(response.status, `API Error ${response.status}: ${detail}`);
  }

  return response.json();
}

// Stocks API
export async function getStocks(params?: {
  category?: string;
  watchlist?: string;
  active_only?: boolean;
}): Promise<{ stocks: StockMaster[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set('category', params.category);
  if (params?.watchlist) searchParams.set('watchlist', params.watchlist);
  if (params?.active_only !== undefined) searchParams.set('active_only', String(params.active_only));

  const query = searchParams.toString();
  return fetchAPI(`/api/stocks${query ? `?${query}` : ''}`);
}

export async function getStock(ticker: string): Promise<StockMaster> {
  return fetchAPI(`/api/stocks/${ticker}`);
}

// Signal API
export async function getSignal(
  ticker: string,
  mode?: 'aggressive' | 'balanced' | 'conservative'
): Promise<SignalResponse> {
  const query = mode ? `?mode=${mode}` : '';
  return fetchAPI(`/api/signal/${ticker}${query}`);
}

// Regime API
export async function getRegime(): Promise<RegimeResponse> {
  return fetchAPI('/api/regime');
}

// Market State API
export async function getMarketState(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ data: MarketStateRecord[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const query = searchParams.toString();
  return fetchAPI(`/api/market-state${query ? `?${query}` : ''}`);
}

export async function getLatestMarketState(): Promise<LatestMarketState> {
  return fetchAPI('/api/market-state/latest');
}

// Liquidity API
export async function getLiquidityOverview(): Promise<LiquidityOverview> {
  return fetchAPI('/api/liquidity/overview');
}

export async function getFedBalanceSheet(limit = 30): Promise<{ data: FedBalanceSheet[]; count: number }> {
  return fetchAPI(`/api/liquidity/fed-balance-sheet?limit=${limit}`);
}

export async function getInterestRates(limit = 30): Promise<{ data: InterestRates[]; count: number }> {
  return fetchAPI(`/api/liquidity/interest-rates?limit=${limit}`);
}

export async function getCreditSpreads(limit = 30): Promise<{ data: CreditSpreads[]; count: number }> {
  return fetchAPI(`/api/liquidity/credit-spreads?limit=${limit}`);
}

export async function getMarketIndicators(limit = 30): Promise<{ data: MarketIndicators[]; count: number }> {
  return fetchAPI(`/api/liquidity/market-indicators?limit=${limit}`);
}

export async function getPlumbingSummary(): Promise<PlumbingSummary> {
  return fetchAPI('/api/liquidity/plumbing-summary');
}

// Holdings API
export async function getHoldings(): Promise<HoldingsResponse> {
  return fetchAPI('/api/holdings');
}

export async function createHolding(holding: Partial<HoldingRecord>): Promise<HoldingRecord> {
  return fetchAPI('/api/holdings', {
    method: 'POST',
    body: JSON.stringify(holding),
  });
}

export async function updateHolding(
  holdingId: string,
  holding: Partial<HoldingRecord>,
): Promise<HoldingRecord> {
  return fetchAPI(`/api/holdings/${holdingId}`, {
    method: 'PUT',
    body: JSON.stringify(holding),
  });
}

export async function deleteHolding(holdingId: string): Promise<void> {
  return fetchAPI(`/api/holdings/${holdingId}`, {
    method: 'DELETE',
  });
}

// Trades API
export async function getTrades(params?: {
  ticker?: string;
  action?: 'BUY' | 'SELL';
  limit?: number;
}): Promise<{ trades: TradeRecord[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.ticker) searchParams.set('ticker', params.ticker);
  if (params?.action) searchParams.set('action', params.action);
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const query = searchParams.toString();
  return fetchAPI(`/api/trades${query ? `?${query}` : ''}`);
}

export async function getTradeStats(): Promise<TradeStats> {
  return fetchAPI('/api/trades/stats');
}

export async function createTrade(trade: Partial<TradeRecord>): Promise<TradeRecord> {
  return fetchAPI('/api/trades', {
    method: 'POST',
    body: JSON.stringify(trade),
  });
}

export async function deleteTrade(tradeId: string): Promise<void> {
  return fetchAPI(`/api/trades/${tradeId}`, { method: 'DELETE' });
}

// Sell from Holding API
export async function sellFromHolding(params: {
  holding_id: string;
  shares: number;
  price: number;
  trade_date: string;
  fees?: number;
  reason?: string;
  lessons_learned?: string;
}): Promise<{ status: string; trade: TradeRecord; holding_status: string; profit_loss: number; profit_loss_pct: number }> {
  const sp = new URLSearchParams();
  sp.set('holding_id', params.holding_id);
  sp.set('shares', String(params.shares));
  sp.set('price', String(params.price));
  sp.set('trade_date', params.trade_date);
  if (params.fees != null) sp.set('fees', String(params.fees));
  if (params.reason) sp.set('reason', params.reason);
  if (params.lessons_learned) sp.set('lessons_learned', params.lessons_learned);
  return fetchAPI(`/api/trades/sell-from-holding?${sp.toString()}`, { method: 'POST' });
}

// Employment API
export async function getEmploymentOverview(): Promise<EmploymentOverview> {
  return fetchAPI('/api/employment/overview');
}

export async function getEconomicIndicators(params?: {
  indicator?: string;
  limit?: number;
}): Promise<{ data: EconomicIndicator[]; count: number }> {
  const searchParams = new URLSearchParams();
  if (params?.indicator) searchParams.set('indicator', params.indicator);
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const query = searchParams.toString();
  return fetchAPI(`/api/employment/indicators${query ? `?${query}` : ''}`);
}

export async function getWeeklyClaims(limit = 30): Promise<{ data: WeeklyClaims[]; count: number }> {
  return fetchAPI(`/api/employment/weekly-claims?limit=${limit}`);
}

export async function getEmploymentRiskScore(): Promise<EmploymentRiskScore> {
  return fetchAPI('/api/employment/risk-score');
}

export async function getRiskHistory(months = 120): Promise<RiskHistoryResponse> {
  return fetchAPI(`/api/employment/risk-history?months=${months}`);
}

// FX API
export async function getUsdJpy(): Promise<{ rate: number }> {
  return fetchAPI('/api/fx/usdjpy');
}

export function useUsdJpy() {
  return useSWR('usdjpy', getUsdJpy, { refreshInterval: 5 * 60 * 1000 });
}

// Stock Price API
export async function getStockQuote(ticker: string): Promise<StockQuote> {
  const response = await fetchAPI<{ ticker: string; quote: StockQuote }>(`/api/stock/${ticker}/quote`);
  return response.quote;
}

export async function getBatchQuotes(tickers: string[]): Promise<{ quotes: StockQuote[]; count: number }> {
  const param = tickers.sort().join(',');
  return fetchAPI(`/api/stock/batch-quotes?tickers=${encodeURIComponent(param)}`);
}

export async function getStockHistory(
  ticker: string,
  period: string = '3mo'
): Promise<StockHistoryResponse> {
  return fetchAPI(`/api/stock/${ticker}/history?period=${period}`);
}

// Exit API
export async function getExitAnalysis(
  ticker: string,
  entryPrice: number,
  entryDate?: string
): Promise<ExitAnalysisResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('entry_price', String(entryPrice));
  if (entryDate) searchParams.set('entry_date', entryDate);

  return fetchAPI(`/api/exit/${ticker}?${searchParams.toString()}`);
}

// Signal History API
export async function getSignalHistory(
  ticker: string,
  period: string = '1y',
  mode: string = 'balanced',
  exitMode: string = 'standard'
): Promise<SignalHistoryResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('period', period);
  searchParams.set('mode', mode);
  searchParams.set('exit_mode', exitMode);

  return fetchAPI(`/api/signal/${ticker}/history?${searchParams.toString()}`);
}

// Chart Markers API (BOS/CHoCH/FVG)
export async function getChartMarkers(
  ticker: string,
  period: string = '3mo'
): Promise<ChartMarkersResponse> {
  return fetchAPI(`/api/signal/${ticker}/chart-markers?period=${period}`);
}

// Batch Signal Analysis API
export async function getBatchSignals(
  tickers: string[],
  mode: string = 'balanced'
): Promise<BatchResponse> {
  return fetchAPI('/api/signal/batch', {
    method: 'POST',
    body: JSON.stringify({ tickers, mode }),
  });
}

// History Charts API
export async function getHistoryCharts(
  period: string = '2y',
  startDate?: string,
  endDate?: string
): Promise<HistoryChartsData> {
  const params = new URLSearchParams();
  params.set('period', period);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  return fetchAPI(`/api/liquidity/history-charts?${params.toString()}`);
}

// Market Events API
export async function getMarketEvents(): Promise<MarketEventsData> {
  return fetchAPI('/api/liquidity/events');
}

// Policy Regime API
export async function getPolicyRegime(): Promise<PolicyRegimeData> {
  return fetchAPI('/api/liquidity/policy-regime');
}

// Backtest States API
export async function getBacktestStates(
  limit: number = 120
): Promise<BacktestData> {
  return fetchAPI(`/api/liquidity/backtest-states?limit=${limit}`);
}

// ============================================================
// SWR Hooks — client-side cache with stale-while-revalidate
// ============================================================

export function useRegime() {
  return useSWR<RegimeResponse>('/api/regime');
}

export function useLatestMarketState() {
  return useSWR<LatestMarketState>('/api/market-state/latest');
}

export function useLiquidityOverview() {
  return useSWR<LiquidityOverview>('/api/liquidity/overview');
}

export function usePlumbingSummary() {
  return useSWR<PlumbingSummary>('/api/liquidity/plumbing-summary');
}

export function useMarketEvents() {
  return useSWR<MarketEventsData>('/api/liquidity/events');
}

export function usePolicyRegime() {
  return useSWR<PolicyRegimeData>('/api/liquidity/policy-regime');
}

export function useHistoryCharts(period: string, startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  params.set('period', period);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  return useSWR<HistoryChartsData>(`/api/liquidity/history-charts?${params.toString()}`);
}

export function useBacktestStates(limit: number = 120) {
  return useSWR<BacktestData>(`/api/liquidity/backtest-states?limit=${limit}`);
}

export function useEmploymentRiskScore() {
  return useSWR<EmploymentRiskScore>('/api/employment/risk-score');
}

export function useRiskHistory(months: number = 350) {
  return useSWR<RiskHistoryResponse>(`/api/employment/risk-history?months=${months}`);
}

export function useHoldings() {
  return useSWR<HoldingsResponse>('/api/holdings', {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 10000,
  });
}

export function useHoldingsInit() {
  return useSWR<HoldingsInitResponse>('/api/holdings/init', async (url: string) => {
    try {
      return await fetchAPI<HoldingsInitResponse>(url);
    } catch (err) {
      // /init not deployed yet — fall back to 3 parallel calls
      if (err instanceof Error && err.message.includes('404')) {
        const [h, c, fx] = await Promise.all([
          fetchAPI<HoldingsResponse>('/api/holdings'),
          fetchAPI<CashBalancesResponse>('/api/holdings/cash'),
          fetchAPI<{ rate: number }>('/api/fx/usdjpy').catch(() => ({ rate: 150.0 })),
        ]);
        return {
          holdings: h.holdings,
          total: h.total,
          total_value: h.total_value ?? 0,
          cash: c,
          fx_rate: fx.rate,
        };
      }
      throw err;
    }
  }, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 10000,
  });
}

export function useTrades(params?: { limit?: number; enabled?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  const enabled = params?.enabled !== false;
  return useSWR<{ trades: TradeRecord[]; total: number }>(
    enabled ? `/api/trades${query ? `?${query}` : ''}` : null,
    { keepPreviousData: true },
  );
}

export function useTradeStats(enabled: boolean = true) {
  return useSWR<TradeStats>(enabled ? '/api/trades/stats' : null, {
    keepPreviousData: true,
  });
}

export function usePortfolioHistory(months: number = 24, enabled: boolean = true) {
  return useSWR<PortfolioHistoryResponse>(
    enabled ? `/api/holdings/portfolio-history?months=${months}` : null,
    { keepPreviousData: true, revalidateOnFocus: false, dedupingInterval: 10000, refreshInterval: 30 * 60 * 1000 },
  );
}

export function useCashBalances() {
  return useSWR<CashBalancesResponse>('/api/holdings/cash', {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 10000,
    refreshInterval: 30 * 60 * 1000,
  });
}

export async function createCashBalance(data: { label: string; currency?: string; amount: number; account_type?: string }) {
  return fetchAPI('/api/holdings/cash', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateCashBalance(id: string, data: { label?: string; currency?: string; amount?: number; account_type?: string }) {
  return fetchAPI(`/api/holdings/cash/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteCashBalance(id: string) {
  return fetchAPI(`/api/holdings/cash/${id}`, { method: 'DELETE' });
}

// Watchlist API
export async function getWatchlists(): Promise<WatchlistsResponse> {
  return fetchAPI('/api/watchlist');
}

export async function addWatchlistTicker(ticker: string): Promise<void> {
  // Backend: POST /api/watchlist/:id/tickers with body {action, ticker}
  // id="default" auto-finds or creates the default watchlist.
  await fetchAPI('/api/watchlist/default/tickers', {
    method: 'POST',
    body: JSON.stringify({ action: 'add', ticker }),
  });
}

export async function removeWatchlistTicker(ticker: string): Promise<void> {
  await fetchAPI('/api/watchlist/default/tickers', {
    method: 'POST',
    body: JSON.stringify({ action: 'remove', ticker }),
  });
}

export function useWatchlist() {
  return useSWR<WatchlistsResponse>('/api/watchlist');
}

// User Profile API
export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  auth_provider: string;
  created_at: string;
  is_admin?: boolean;
}

export function useMe() {
  return useSWR<UserProfile>('/api/me');
}

export async function updateMe(data: { display_name: string | null }): Promise<{ status: string }> {
  return fetchAPI('/api/me', { method: 'PATCH', body: JSON.stringify(data) });
}

// Admin API
export interface AdminUsersResponse {
  users: UserProfile[];
  total: number;
}

export function useAdminUsers() {
  return useSWR<AdminUsersResponse>('/api/admin/users');
}

export async function updateUserPlan(
  userId: string,
  data: { plan?: string; display_name?: string },
): Promise<{ status: string }> {
  return fetchAPI(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function useStocks(params?: { active_only?: boolean }) {
  const searchParams = new URLSearchParams();
  if (params?.active_only !== undefined) searchParams.set('active_only', String(params.active_only));
  const query = searchParams.toString();
  return useSWR<{ stocks: StockMaster[]; total: number }>(`/api/stocks${query ? `?${query}` : ''}`);
}

export function useBatchQuotes(tickers: string[] | null) {
  // Custom key that encodes all tickers; fetcher splits into ≤20 chunks
  const sorted = tickers && tickers.length > 0 ? [...tickers].sort() : null;
  const key = sorted ? `batch-quotes:${sorted.join(',')}` : null;

  return useSWR<{ quotes: StockQuote[]; count: number }>(key, async () => {
    if (!sorted) return { quotes: [], count: 0 };
    const CHUNK = 20;
    if (sorted.length <= CHUNK) {
      return fetchAPI(`/api/stock/batch-quotes?tickers=${sorted.join(',')}`);
    }
    const chunks: string[][] = [];
    for (let i = 0; i < sorted.length; i += CHUNK) {
      chunks.push(sorted.slice(i, i + CHUNK));
    }
    const results = await Promise.all(
      chunks.map(c =>
        fetchAPI<{ quotes: StockQuote[]; count: number }>(
          `/api/stock/batch-quotes?tickers=${c.join(',')}`
        )
      )
    );
    return {
      quotes: results.flatMap(r => r.quotes),
      count: results.reduce((s, r) => s + r.count, 0),
    };
  }, { refreshInterval: 5 * 60 * 1000, keepPreviousData: true });
}

// ── Discovery ──

export function useDiscoveryToday() {
  return useSWR<DiscoveryResponse>('/api/discovery/today', {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });
}
