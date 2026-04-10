// Stock types
export interface StockMaster {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  price_category: 'penny' | 'mid' | 'large' | null;
  watchlist_category: string | null;
  market_cap: number | null;
  exchange: string | null;
  is_active: boolean;
}

// Signal types
export interface SignalCondition {
  found?: boolean;
  date?: string;
  strength?: string;
  value?: number;
  converged?: boolean;
  threshold?: number;
}

export interface SignalResponse {
  ticker: string;
  name?: string | null;
  timestamp: string;
  price: number;
  price_change_pct: number;
  price_category: string;
  combined_ready: boolean;
  conditions: {
    bearish_choch: SignalCondition;
    bullish_choch: SignalCondition;
    ema_convergence: SignalCondition;
  };
  relative_strength: {
    change_pct: number;
    trend: 'UP' | 'FLAT' | 'DOWN';
    down_threshold: number;
  };
  regime: string;
  benchmark_ticker?: string;
  benchmark_price?: number;
  benchmark_ema_long?: number;
  ema_short_slope?: number;
  mode: string;
  entry_allowed: boolean;
  position_size_pct: number;
  mode_note: string;
  other_modes: Record<string, { entry_allowed: boolean; position_size_pct: number }>;
}

// Regime types
export interface RegimeResponse {
  regime: 'BULL' | 'BEAR' | 'RECOVERY' | 'WEAKENING';
  timestamp: string;
  benchmark_ticker: string;
  benchmark_price: number;
  benchmark_ema_long: number;
  benchmark_ema_short: number;
  above_long_ema: boolean;
  ema_short_slope: number;
  description: string;
  entry_recommendation: string;
  asset_class: string;
}

// Market State types
export interface MarketStateRecord {
  id?: number;
  date: string;
  spy_regime?: string;
  qqq_regime?: string;
  btc_regime?: string;
  overall_regime?: string;
  layer1_stress?: number;
  layer2_stress?: number;
  layer3_stress?: number;
  layer4_stress?: number;
  overall_stress?: number;
  notes?: string;
  created_at?: string;
}

export interface LatestMarketState {
  date: string;
  spy_regime?: string;
  qqq_regime?: string;
  btc_regime?: string;
  overall_regime?: string;
  stress_levels: {
    layer1?: number;
    layer2?: number;
    layer3?: number;
    layer4?: number;
    overall?: number;
  };
  updated_at?: string;
}

// Liquidity types
export interface FedBalanceSheet {
  date: string;
  reserves?: number;
  rrp?: number;
  tga?: number;
  soma_assets?: number;
}

export interface InterestRates {
  date: string;
  fed_funds?: number;
  treasury_2y?: number;
  treasury_10y?: number;
  treasury_spread?: number;
}

export interface CreditSpreads {
  date: string;
  hy_spread?: number;
  ig_spread?: number;
  ted_spread?: number;
}

export interface MarketIndicators {
  date: string;
  vix?: number;
  dxy?: number;
  sp500?: number;
  nasdaq?: number;
}

export interface LiquidityOverview {
  fed_balance_sheet: FedBalanceSheet | null;
  interest_rates: InterestRates | null;
  credit_spreads: CreditSpreads | null;
  market_indicators: MarketIndicators | null;
  liquidity_stress: 'Low' | 'Medium' | 'High';
  stress_factors: string[];
}

// Plumbing Summary types (Layer stress calculations)
export interface LayerStress {
  stress_score: number;
  interpretation: string;
  z_score?: number;
  net_liquidity?: number;
  fed_data?: {
    date: string;
    soma_assets: number | null;
    reserves: number | null;
    rrp: number | null;
    tga: number | null;
  };
  // Layer 2A
  interpretation_type?: string;
  alerts?: string[];
  components?: Record<string, unknown>;
  // Layer 2B
  phase?: string;
  margin_debt_2y?: number;
  margin_debt_1y?: number;
  it_bubble_comparison?: number;
  it_bubble_peak?: number;
  data_date?: string;
}

export interface CreditPressure {
  level: 'Low' | 'Medium' | 'High';
  pressure_count: number;
  components: Record<string, { value: number | null; status: string }>;
  alerts: string[];
}

export interface MarketStateInfo {
  code: string;
  label: string;
  description: string;
  action: string;
  color: string;
  comment: string;
  all_states: Array<{
    code: string;
    label: string;
    description: string;
    action: string;
    color: string;
    priority: number;
  }>;
  state_count: number;
}

export interface PlumbingSummary {
  timestamp: string;
  layers: {
    layer1: LayerStress | null;
    layer2a: LayerStress | null;
    layer2b: LayerStress | null;
  };
  credit_pressure: CreditPressure | null;
  market_state: MarketStateInfo | null;
  market_indicators: MarketIndicators | null;
  interest_rates: InterestRates | null;
  credit_spreads: CreditSpreads | null;
}

// Holdings types
export interface HoldingRecord {
  id?: string;
  user_id?: string;
  ticker: string;
  shares: number;
  avg_price: number;
  entry_date?: string;
  account_type?: 'nisa' | 'tokutei';
  sector?: string;
  regime_at_entry?: string;
  rs_at_entry?: string;
  fx_rate?: number;
  target_price?: number;
  stop_loss?: number;
  thesis?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface HoldingsResponse {
  holdings: HoldingRecord[];
  total: number;
  total_value?: number;
}

// Trade types
export interface TradeRecord {
  id?: string;
  user_id?: string;
  holding_id?: string;
  ticker: string;
  action: 'BUY' | 'SELL';
  shares: number;
  price: number;
  fees?: number;
  trade_date: string;
  account_type?: string;
  regime?: string;
  rs_trend?: string;
  reason?: string;
  lessons_learned?: string;
  profit_loss?: number;
  profit_loss_pct?: number;
  holding_days?: number;
  created_at?: string;
}

export interface TradeStats {
  total_trades: number;
  buy_count: number;
  sell_count: number;
  total_profit_loss: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  avg_profit: number;
  avg_loss: number;
  profit_factor: number;
}

// Portfolio History (snapshot-based, market value)
export interface PortfolioHistoryPoint {
  date: string;
  total_market_value_usd: number;
  total_cost_usd: number;
  unrealized_pnl_usd: number;
  cash_usd: number;
  total_assets_usd: number;
  holdings_count: number;
  fx_rate_usdjpy: number;
}

export interface PortfolioHistoryResponse {
  history: PortfolioHistoryPoint[];
  summary: {
    total_market_value_usd: number;
    total_cost_usd: number;
    unrealized_pnl_usd: number;
    total_cash_usd: number;
    total_assets_usd: number;
    fx_rate_usdjpy: number;
  };
}

// Cash Balances
export interface CashBalance {
  id: string;
  user_id: string;
  label: string;
  currency: string;
  amount: number;
  account_type: string | null;
  updated_at: string;
}

export interface CashBalancesResponse {
  balances: CashBalance[];
  total: number;
}

// Holdings Init (combined endpoint)
export interface HoldingsInitResponse {
  holdings: HoldingRecord[];
  total: number;
  total_value: number;
  cash: CashBalancesResponse;
  fx_rate: number;
}

// Employment types
export interface EconomicIndicator {
  id: number;
  indicator: string;
  reference_period: string;
  current_value?: number;
  revision_count: number;
  nfp_change?: number;
  u3_rate?: number;
  u6_rate?: number;
  avg_hourly_earnings?: number;
  wage_mom?: number;
  labor_force_participation?: number;
  notes?: string;
}

export interface WeeklyClaims {
  week_ending: string;
  initial_claims?: number;
  continued_claims?: number;
  initial_claims_4w_avg?: number;
}

export interface EmploymentOverview {
  latest_nfp: EconomicIndicator | null;
  latest_claims: WeeklyClaims | null;
  alert_level: 'Low' | 'Medium' | 'High';
  alert_factors: string[];
}

// Employment Risk Score types (100-point scoring)
export interface RiskSubScore {
  name: string;
  score: number;
  max_score: number;
  detail: string;
  status: 'normal' | 'warning' | 'danger';
}

export interface RiskScoreCategory {
  name: string;
  score: number;
  max_score: number;
  components: RiskSubScore[];
}

export interface SahmRuleData {
  current_u3: number | null;
  u3_3m_avg: number | null;
  u3_12m_low_3m_avg: number | null;
  sahm_value: number | null;
  triggered: boolean;
  peak_out: boolean;
  near_peak_out: boolean;
}

export interface PhaseInfo {
  code: string;
  label: string;
  description: string;
  action: string;
  color: string;
  position_limit: number;
}

export interface EmploymentRiskScore {
  total_score: number;
  phase: PhaseInfo;
  categories: RiskScoreCategory[];
  sahm_rule: SahmRuleData;
  alert_factors: string[];
  timestamp: string;
  latest_nfp: EconomicIndicator | null;
  latest_claims: WeeklyClaims | null;
  nfp_history: Array<{
    reference_period: string;
    current_value: number | null;  // PAYEMS 絶対値 (千人) — NFP 累積チャート用
    nfp_change: number | null;
    u3_rate: number | null;
    u6_rate: number | null;
    labor_force_participation: number | null;
    avg_hourly_earnings: number | null;
    wage_mom: number | null;
  }>;
  claims_history: Array<{
    week_ending: string;
    initial_claims: number | null;
    continued_claims: number | null;
    initial_claims_4w_avg: number | null;
  }>;
  consumer_history: Array<{
    indicator: string;
    reference_period: string;
    current_value: number | null;
  }>;
}

// Stock quote types
export interface StockQuote {
  ticker: string;
  name?: string | null;
  price: number;
  change: number;
  change_pct: number;
  high: number;
  low: number;
  open: number;
  prev_close: number;
  volume: number;
  market_cap?: number;
  updated_at: string;
}

// Stock history types
export interface StockHistoryData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockHistoryResponse {
  ticker: string;
  period: string;
  data: StockHistoryData[];
  updated_at?: string;
}

// Exit types
export interface ExitLayerStatus {
  layer: number;
  name: string;
  status: 'SAFE' | 'WARNING' | 'TRIGGERED';
  detail?: string;
  trigger_price?: number;
}

export interface ExitAnalysisResponse {
  ticker: string;
  current_price: number;
  entry_price: number;
  pnl_pct: number;
  should_exit: boolean;
  exit_type?: string;
  exit_pct: number;
  exit_reason?: string;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  layers: ExitLayerStatus[];
  targets: Array<{
    type: string;
    price: number;
    pct: number;
    exit_pct: number;
  }>;
  structure_stop: number;
  ema_status: {
    ema_8: number;
    ema_13: number;
    ema_21: number;
    above_ema_8: boolean;
    above_ema_13: boolean;
    above_ema_21: boolean;
  };
  updated_at: string;
}

// Historical signal types (legacy - entry only)
export interface HistoricalSignal {
  date: string;
  price: number;
  ema_convergence: number;
  rs_diff: number;
  pnl_5d: number | null;
  pnl_10d: number | null;
  pnl_20d: number | null;
  max_pnl_20d: number | null;
  min_pnl_20d: number | null;
}

// Multi-type signal (ENTRY, HEAT, RSI_HIGH, EXIT)
export type SignalType = 'ENTRY' | 'HEAT' | 'RSI_HIGH' | 'EXIT';
export type ExitType = 'BOS' | 'MIRROR_FULL' | 'MIRROR_WARN' | 'TRAIL' | 'BEAR_CHOCH';

export interface TimelineSignal {
  date: string;
  end_date?: string;
  days: number;
  type: SignalType;
  price: number;
  end_price?: number;
  detail: string;
  // ENTRY fields
  rs_trend?: string;
  size_pct?: number;
  // HEAT fields
  heat_score?: number;
  heat_level?: string;
  action?: string;
  regime?: string;
  // EXIT fields
  exit_type?: ExitType;
  exit_pct?: number;
}

export interface SignalHistoryStats {
  total_signals: number;
  entry_count?: number;
  exit_count?: number;
  rsi_high_count?: number;
  heat_count?: number;
  avg_pnl_5d: number | null;
  avg_pnl_10d: number | null;
  avg_pnl_20d: number | null;
  win_rate_5d: number | null;
  win_rate_10d: number | null;
  win_rate_20d: number | null;
  // PatB Exit stats
  patb_trades?: number;
  patb_avg_pnl?: number;
  patb_median_pnl?: number;
  patb_win_rate?: number;
  patb_pf?: number | null;
  patb_avg_hold_days?: number;
}

export interface TradeResult {
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  exit_reason: string;
  return_pct: number;
  holding_days: number;
}

export interface LiveExitStatus {
  entry_date: string;
  entry_price: number;
  entry_regime: string;
  holding_days: number;
  unrealized_pct: number;
  atr_floor_price: number;
  atr_floor_triggered: boolean;
  partial_exit_done: boolean;
  bearish_choch_detected: boolean;
  choch_exit_date: string | null;
  ema_death_cross: boolean;
  trail_active: boolean;
  trail_stop_price: number | null;
  highest_price: number;
  nearest_exit_reason: string | null;
  trade_completed: boolean;
}

export interface SignalHistoryResponse {
  ticker: string;
  period: string;
  mode: string;
  timestamp: string;
  signals: HistoricalSignal[];
  stats: SignalHistoryStats;
  timeline?: TimelineSignal[];
  total_signals?: number;
  trade_results?: TradeResult[];
  live_exit_statuses?: LiveExitStatus[];
}

// Chart marker types
export interface BOSMarker {
  date: string;
  type: 'BULLISH' | 'BEARISH';
  price: number;
  broken_level: number;
  strength_pct: number;
}

export interface CHoCHMarker {
  date: string;
  type: 'BULLISH' | 'BEARISH';
  price: number;
  previous_price: number;
}

export interface FVGMarker {
  date: string;
  type: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  gap_pct: number;
}

export interface OrderBlockMarker {
  zone_high: number;
  zone_low: number;
  direction: 'BULLISH' | 'BEARISH';
  freshness: number;
  cisd_confirmed: boolean;
  start_date: string;
  status: string;
}

export interface OTEZoneMarker {
  upper: number;
  lower: number;
  fib_62: number;
  fib_79: number;
  swing_a: number;
  swing_b: number;
  direction: string;
  status: string;
}

export interface PremiumDiscountZone {
  swing_high: number;
  swing_low: number;
  equilibrium: number;
  current_price: number;
  position: number;
  zone: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
  swing_high_date: string | null;
  swing_low_date: string | null;
}

export interface ChartMarkersResponse {
  ticker: string;
  period: string;
  timestamp: string;
  bos: BOSMarker[];
  choch: CHoCHMarker[];
  fvg: FVGMarker[];
  order_blocks: OrderBlockMarker[];
  ote_zones: OTEZoneMarker[];
  premium_discount: PremiumDiscountZone | null;
  data_points: number;
}

// Batch analysis types
export interface BatchResult {
  ticker: string;
  name?: string | null;
  price?: number;
  price_change_pct?: number;
  combined_ready: boolean;
  entry_allowed: boolean;
  position_size_pct: number;
  relative_strength?: {
    change_pct: number;
    trend: 'UP' | 'FLAT' | 'DOWN';
  };
  regime?: string;
  exit_atr_floor?: number;
  exit_verdict?: string;
  exit_verdict_color?: string;
  exit_verdict_reason?: string;
  exit_verdict_sell_pct?: number;
  exit_unrealized_pct?: number;
  exit_holding_days?: number;
  exit_entry_date?: string;
  error: boolean;
  error_message?: string;
}

export interface BatchResponse {
  mode: string;
  total_analyzed: number;
  entry_ready_count: number;
  results: BatchResult[];
  timestamp: string;
}

// Risk History types (monthly risk score timeline)
export interface RiskHistoryPoint {
  date: string;
  total_score: number;
  employment_score: number;
  consumer_score: number;
  structure_score: number;
  phase: string;
  sahm_value: number | null;
}

export interface RiskHistoryResponse {
  history: RiskHistoryPoint[];
  sp500: Array<{ date: string; close: number }>;
}

// History Charts types
export interface HistoryChartsData {
  period: string;
  start_date: string;
  end_date: string;
  data: {
    net_liquidity: Array<{
      date: string;
      net_liquidity: number | null;
      soma_assets: number | null;
      rrp: number | null;
      tga: number | null;
    }>;
    margin_debt: Array<{
      date: string;
      debit_balance: number | null;
      change_2y: number | null;
    }>;
    bank_sector: Array<{
      date: string;
      kre_close: number | null;
      kre_52w_change: number | null;
    }>;
    credit_spreads: Array<{
      date: string;
      hy_spread: number | null;
      ig_spread: number | null;
    }>;
    market_indicators: Array<{
      date: string;
      vix: number | null;
      sp500: number | null;
      nasdaq: number | null;
      dxy: number | null;
    }>;
    interest_rates: Array<{
      date: string;
      fed_funds: number | null;
      treasury_2y: number | null;
      treasury_10y: number | null;
      treasury_spread: number | null;
    }>;
    layer_scores?: Array<{
      date: string;
      layer1: number | null;
      layer2a: number | null;
      layer2b: number | null;
    }>;
    layer_divergence?: Array<{
      date: string;
      divergence: number | null;
      z_l2b?: number | null;
      z_sp500?: number | null;
    }>;
  };
}

// Event Detection types
export interface MarketEvent {
  event_type: string;
  event_label: string;
  severity: 'CRITICAL' | 'ALERT' | 'WARNING';
  description: string;
  trigger_value: number;
  threshold: number;
}

export interface MarketEventsData {
  events: MarketEvent[];
  event_count: number;
  highest_severity: string | null;
  timestamp: string;
}

// Policy Regime types
export interface FedActionRoomItem {
  level: string;
  room_pct?: number | null;
  constraint?: string | null;
  rrp_buffer?: number | null;
  tga_level?: number | null;
  comment?: string | null;
}

export interface FedActionRoom {
  rate_cut_room: FedActionRoomItem;
  absorption_room: FedActionRoomItem;
  fiscal_assist_potential: FedActionRoomItem;
  overall_room: string;
}

export interface PolicyRegimeData {
  regime: string;
  regime_label: string;
  description: string;
  fed_action_room: FedActionRoom;
  signals: string[];
  fed_comment: string;
}

// Watchlist types
export interface WatchlistRecord {
  id: string;
  user_id: string;
  name: string;
  tickers: string[];
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface WatchlistsResponse {
  watchlists: WatchlistRecord[];
  total: number;
}

// Crisis Event types (for backtest timeline)
export interface CrisisEvent {
  event: string;
  description: string;
  event_date: string;
  state_code: string;
  state_label: string;
  color: string;
  layer1_stress: number;
  layer2a_stress: number;
  layer2b_stress: number;
  sp500: number | null;
  return_6m: number | null;
}

// Backtest types
export interface BacktestState {
  date: string;
  state_code: string;
  state_label: string;
  color: string;
  action: string;
  layer1_stress: number;
  layer2a_stress: number;
  layer2b_stress: number;
  sp500: number | null;
  return_6m: number | null;
}

export interface StateDefinition {
  code: string;
  label: string;
  description: string;
  conditions: string;
  action: string;
  color: string;
}

export interface StateStats {
  avg_return_6m: number;
  win_rate: number;
  max_drawdown: number;
  best_return: number;
  sample_count: number;
  occurrence_pct: number;
}

export interface BacktestData {
  states: BacktestState[];
  state_definitions: StateDefinition[];
  state_stats: Record<string, StateStats>;
  total_months: number;
  event_timeline?: CrisisEvent[];
}

// ── Discovery (finviz Phase B) ──

export interface DiscoveredStock {
  scan_date: string;
  ticker: string;
  presets: string[];
  finviz_score: number;
  fundament: {
    Ticker?: string;
    Beta?: number | null;
    ATR?: number | null;
    SMA20?: number | null;
    SMA50?: number | null;
    SMA200?: number | null;
    '52W High'?: number | null;
    '52W Low'?: number | null;
    RSI?: number | null;
    Price?: number | null;
    Change?: number | null;
    Volume?: number | null;
    ROE?: number | null;
    'Debt/Eq'?: number | null;
    [key: string]: unknown;
  };
  created_at: string;
  had_signal?: boolean | null;
  signal_grade?: string | null;
}

export interface DiscoveryResponse {
  scan_date: string;
  preset_counts: Record<string, number>;
  total_unique: number;
  after_threshold: number;
  threshold: number;
  tickers: DiscoveredStock[];
}
