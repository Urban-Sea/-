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
  StockQuote,
  StockHistoryResponse,
  ExitAnalysisResponse,
  SignalHistoryResponse,
  ChartMarkersResponse,
  BatchResponse,
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://empathetic-hope-production.up.railway.app';

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || body.message || JSON.stringify(body);
    } catch {
      // ignore parse error
    }
    throw new Error(`API Error ${response.status}: ${detail}`);
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
export async function getHoldings(userId?: string): Promise<HoldingsResponse> {
  const query = userId ? `?user_id=${userId}` : '';
  return fetchAPI(`/api/holdings${query}`);
}

export async function createHolding(holding: Partial<HoldingRecord>, userId?: string): Promise<HoldingRecord> {
  const query = userId ? `?user_id=${userId}` : '';
  return fetchAPI(`/api/holdings${query}`, {
    method: 'POST',
    body: JSON.stringify(holding),
  });
}

export async function updateHolding(
  holdingId: string,
  holding: Partial<HoldingRecord>,
  userId?: string
): Promise<HoldingRecord> {
  const query = userId ? `?user_id=${userId}` : '';
  return fetchAPI(`/api/holdings/${holdingId}${query}`, {
    method: 'PUT',
    body: JSON.stringify(holding),
  });
}

export async function deleteHolding(holdingId: string, userId?: string): Promise<void> {
  const query = userId ? `?user_id=${userId}` : '';
  return fetchAPI(`/api/holdings/${holdingId}${query}`, {
    method: 'DELETE',
  });
}

// Trades API
export async function getTrades(params?: {
  user_id?: string;
  ticker?: string;
  action?: 'BUY' | 'SELL';
  limit?: number;
}): Promise<{ trades: TradeRecord[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.user_id) searchParams.set('user_id', params.user_id);
  if (params?.ticker) searchParams.set('ticker', params.ticker);
  if (params?.action) searchParams.set('action', params.action);
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const query = searchParams.toString();
  return fetchAPI(`/api/trades${query ? `?${query}` : ''}`);
}

export async function getTradeStats(userId?: string): Promise<TradeStats> {
  const query = userId ? `?user_id=${userId}` : '';
  return fetchAPI(`/api/trades/stats${query}`);
}

export async function createTrade(trade: Partial<TradeRecord>, userId?: string): Promise<TradeRecord> {
  const query = userId ? `?user_id=${userId}` : '';
  return fetchAPI(`/api/trades${query}`, {
    method: 'POST',
    body: JSON.stringify(trade),
  });
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

// Stock Price API
export async function getStockQuote(ticker: string): Promise<StockQuote> {
  const response = await fetchAPI<{ ticker: string; quote: StockQuote }>(`/api/stock/${ticker}/quote`);
  return response.quote;
}

export async function getBatchQuotes(tickers: string[]): Promise<{ quotes: StockQuote[]; count: number }> {
  return fetchAPI('/api/stock/batch', {
    method: 'POST',
    body: JSON.stringify({ tickers }),
  });
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
  mode: string = 'balanced'
): Promise<SignalHistoryResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('period', period);
  searchParams.set('mode', mode);

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
