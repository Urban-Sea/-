package model

// ============================================================
// DB Row Models
// ============================================================

// FedBalanceSheet represents a row in the fed_balance_sheet table.
type FedBalanceSheet struct {
	Date      DateOnly `json:"date"       db:"date"`
	Reserves  *float64 `json:"reserves"   db:"reserves"`
	RRP       *float64 `json:"rrp"        db:"rrp"`
	TGA       *float64 `json:"tga"        db:"tga"`
	SOMAAssets *float64 `json:"soma_assets" db:"soma_assets"`
}

// InterestRates represents a row in the interest_rates table.
type InterestRates struct {
	Date           DateOnly `json:"date"            db:"date"`
	FedFunds       *float64 `json:"fed_funds"       db:"fed_funds"`
	Treasury2Y     *float64 `json:"treasury_2y"     db:"treasury_2y"`
	Treasury10Y    *float64 `json:"treasury_10y"    db:"treasury_10y"`
	TreasurySpread *float64 `json:"treasury_spread" db:"treasury_spread"`
}

// CreditSpreads represents a row in the credit_spreads table.
type CreditSpreads struct {
	Date      DateOnly `json:"date"       db:"date"`
	HYSpread  *float64 `json:"hy_spread"  db:"hy_spread"`
	IGSpread  *float64 `json:"ig_spread"  db:"ig_spread"`
	TEDSpread *float64 `json:"ted_spread" db:"ted_spread"`
}

// MarketIndicators represents a row in the market_indicators table.
type MarketIndicators struct {
	Date      DateOnly `json:"date"       db:"date"`
	VIX       *float64 `json:"vix"        db:"vix"`
	DXY       *float64 `json:"dxy"        db:"dxy"`
	SP500     *float64 `json:"sp500"      db:"sp500"`
	NASDAQ    *float64 `json:"nasdaq"     db:"nasdaq"`
	Russell2000 *float64 `json:"russell2000" db:"russell2000"`
	USDJPY    *float64 `json:"usdjpy"     db:"usdjpy"`
}

// MarginDebt represents a row in the margin_debt table.
type MarginDebt struct {
	Date         DateOnly `json:"date"          db:"date"`
	DebitBalance *float64 `json:"debit_balance" db:"debit_balance"`
	FreeCredit   *float64 `json:"free_credit"   db:"free_credit"`
	Change2Y     *float64 `json:"change_2y"     db:"change_2y"`
}

// MMFAssets represents a row in the mmf_assets table.
type MMFAssets struct {
	Date        DateOnly `json:"date"         db:"date"`
	TotalAssets *float64 `json:"total_assets" db:"total_assets"`
	Change3M    *float64 `json:"change_3m"    db:"change_3m"`
}

// BankSector represents a row in the bank_sector table.
type BankSector struct {
	Date         DateOnly `json:"date"           db:"date"`
	KREClose     *float64 `json:"kre_close"      db:"kre_close"`
	KRE52WHigh   *float64 `json:"kre_52w_high"   db:"kre_52w_high"`
	KRE52WLow    *float64 `json:"kre_52w_low"    db:"kre_52w_low"`
	KRE52WChange *float64 `json:"kre_52w_change" db:"kre_52w_change"`
}

// SRFUsage represents a row in the srf_usage table.
type SRFUsage struct {
	Date   DateOnly `json:"date"   db:"date"`
	Amount *float64 `json:"amount" db:"amount"`
	Source *string  `json:"source" db:"source"`
}

// LayerStressHistory represents a row in the layer_stress_history table.
type LayerStressHistory struct {
	ID          int       `json:"id"           db:"id"`
	Date        DateOnly  `json:"date"         db:"date"`
	Layer       string    `json:"layer"        db:"layer"`
	StressScore *float64  `json:"stress_score" db:"stress_score"`
	Components  *string   `json:"components"   db:"components"`
}

// NOTE: EconomicIndicator is defined in employment.go (shared across packages).

// ============================================================
// CRUD List Response
// ============================================================

// LiquidityListResponse is the standard {data, count} response.
type LiquidityListResponse struct {
	Data  any `json:"data"`
	Count int `json:"count"`
}

// ============================================================
// Margin Debt Upsert
// ============================================================

// MarginDebtInput is the body for POST /api/liquidity/margin-debt.
type MarginDebtInput struct {
	Date         string   `json:"date"`          // "2026-01-01"
	DebitBalance float64  `json:"debit_balance"` // FINRA value in millions
	FreeCredit   *float64 `json:"free_credit"`
}

// MarginDebtUpsertResponse is the response for margin-debt upsert.
type MarginDebtUpsertResponse struct {
	Status       string   `json:"status"`
	Date         string   `json:"date"`
	DebitBalance float64  `json:"debit_balance"`
	Change2Y     *float64 `json:"change_2y"`
}

// ============================================================
// Liquidity Overview
// ============================================================

// LiquidityOverview is the response for GET /api/liquidity/overview.
type LiquidityOverview struct {
	FedBalanceSheet  *FedBalanceSheet  `json:"fed_balance_sheet"`
	InterestRates    *InterestRates    `json:"interest_rates"`
	CreditSpreads    *CreditSpreads    `json:"credit_spreads"`
	MarketIndicators *MarketIndicators `json:"market_indicators"`
	LiquidityStress  string            `json:"liquidity_stress"`
	StressFactors    []string          `json:"stress_factors"`
}

// ============================================================
// Plumbing Summary (Layer Stress + Market State)
// ============================================================

// Layer1Result is the Layer 1 stress calculation result.
type Layer1Result struct {
	StressScore    int      `json:"stress_score"`
	ZScore         float64  `json:"z_score"`
	NetLiquidity   float64  `json:"net_liquidity"`
	Interpretation string   `json:"interpretation"`
	FedData        *FedData `json:"fed_data,omitempty"`
}

// FedData is the forward-filled FRB data snapshot.
type FedData struct {
	Date       string   `json:"date"`
	SOMAAssets *float64 `json:"soma_assets"`
	Reserves   *float64 `json:"reserves"`
	RRP        *float64 `json:"rrp"`
	TGA        *float64 `json:"tga"`
}

// Layer2AComponents are the individual component scores for Layer 2A.
type Layer2AComponents struct {
	ReservesChangeMoM *float64 `json:"reserves_change_mom"`
	KRE52WChange      *float64 `json:"kre_52w_change"`
	SRFUsage          *float64 `json:"srf_usage"`
	IGSpread          *float64 `json:"ig_spread"`
	Reserves          int      `json:"reserves"`
	KRE               int      `json:"kre"`
	SRF               int      `json:"srf"`
	IG                int      `json:"ig"`
	ReservesValue     *float64 `json:"reserves_value"`
}

// Layer2AResult is the Layer 2A stress calculation result.
type Layer2AResult struct {
	StressScore        int            `json:"stress_score"`
	Interpretation     string         `json:"interpretation"`
	InterpretationType string         `json:"interpretation_type"`
	Alerts             []string       `json:"alerts"`
	Components         Layer2AComponents `json:"components"`
}

// Layer2BComponents are the individual component values for Layer 2B.
type Layer2BComponents struct {
	MarginDebt2Y *float64 `json:"margin_debt_2y"`
	MarginDebt1Y *float64 `json:"margin_debt_1y"`
	MMFChange    *float64 `json:"mmf_change"`
	MarginScore  int      `json:"margin_score"`
	MMFScore     *int     `json:"mmf_score"`
}

// Layer2BResult is the Layer 2B stress calculation result.
type Layer2BResult struct {
	StressScore       int            `json:"stress_score"`
	Phase             string         `json:"phase"`
	MarginDebt2Y      float64        `json:"margin_debt_2y"`
	MarginDebt1Y      *float64       `json:"margin_debt_1y"`
	ITBubbleComparison float64       `json:"it_bubble_comparison"`
	ITBubblePeak      float64        `json:"it_bubble_peak"`
	Components        Layer2BComponents `json:"components"`
	DataDate          string         `json:"data_date,omitempty"`
}

// CreditPressureComponent holds a component's value and status.
type CreditPressureComponent struct {
	Value  *float64 `json:"value"`
	Status string   `json:"status"`
}

// CreditPressureResult is the credit pressure assessment.
type CreditPressureResult struct {
	Level         string                              `json:"level"`
	PressureCount int                                 `json:"pressure_count"`
	Components    map[string]CreditPressureComponent  `json:"components"`
	Alerts        []string                            `json:"alerts"`
}

// MarketStateResult is the market state determination result.
type MarketStateResult struct {
	Code        string              `json:"code"`
	Label       string              `json:"label"`
	Description string              `json:"description"`
	Action      string              `json:"action"`
	Color       string              `json:"color"`
	Comment     string              `json:"comment"`
	AllStates   []MarketStateEntry  `json:"all_states"`
	StateCount  int                 `json:"state_count"`
}

// MarketStateEntry is a single matched state in the all_states list.
type MarketStateEntry struct {
	Code        string `json:"code"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Action      string `json:"action"`
	Color       string `json:"color"`
	Priority    int    `json:"priority"`
}

// PlumbingLayers groups the 3 layer results.
type PlumbingLayers struct {
	Layer1  *Layer1Result  `json:"layer1"`
	Layer2A *Layer2AResult `json:"layer2a"`
	Layer2B *Layer2BResult `json:"layer2b"`
}

// PlumbingSummary is the response for GET /api/liquidity/plumbing-summary.
type PlumbingSummary struct {
	Timestamp        string                `json:"timestamp"`
	Layers           PlumbingLayers        `json:"layers"`
	CreditPressure   *CreditPressureResult `json:"credit_pressure"`
	MarketState      *MarketStateResult    `json:"market_state"`
	MarketIndicators any                   `json:"market_indicators"`
	InterestRates    any                   `json:"interest_rates,omitempty"`
	CreditSpreads    any                   `json:"credit_spreads,omitempty"`
}

// ============================================================
// Market Events
// ============================================================

// MarketEventItem is a single detected event.
type MarketEventItem struct {
	EventType    string  `json:"event_type"`
	EventLabel   string  `json:"event_label"`
	Severity     string  `json:"severity"`
	Description  string  `json:"description"`
	TriggerValue float64 `json:"trigger_value"`
	Threshold    float64 `json:"threshold"`
}

// MarketEventsResponse is the response for GET /api/liquidity/events.
type MarketEventsResponse struct {
	Events          []MarketEventItem `json:"events"`
	EventCount      int               `json:"event_count"`
	HighestSeverity *string           `json:"highest_severity"`
	Timestamp       string            `json:"timestamp"`
}

// ============================================================
// Policy Regime
// ============================================================

// RateCutRoom describes the Fed's rate cut capacity.
type RateCutRoom struct {
	Level      string   `json:"level"`
	RoomPct    *float64 `json:"room_pct"`
	Constraint *string  `json:"constraint"`
}

// AbsorptionRoom describes the RRP buffer status.
type AbsorptionRoom struct {
	Level     string   `json:"level"`
	RRPBuffer *float64 `json:"rrp_buffer"`
	Comment   *string  `json:"comment"`
}

// FiscalAssistPotential describes TGA fiscal room.
type FiscalAssistPotential struct {
	Level    string   `json:"level"`
	TGALevel *float64 `json:"tga_level"`
	Comment  *string  `json:"comment"`
}

// FedActionRoom aggregates the 3 Fed action room sub-metrics.
type FedActionRoom struct {
	RateCutRoom          RateCutRoom          `json:"rate_cut_room"`
	AbsorptionRoom       AbsorptionRoom       `json:"absorption_room"`
	FiscalAssistPotential FiscalAssistPotential `json:"fiscal_assist_potential"`
	OverallRoom          string               `json:"overall_room"`
}

// PolicyRegimeResponse is the response for GET /api/liquidity/policy-regime.
type PolicyRegimeResponse struct {
	Regime        string        `json:"regime"`
	RegimeLabel   string        `json:"regime_label"`
	Description   string        `json:"description"`
	FedActionRoom FedActionRoom `json:"fed_action_room"`
	Signals       []string      `json:"signals"`
	FedComment    string        `json:"fed_comment"`
	Timestamp     string        `json:"timestamp"`
}

// ============================================================
// History Charts
// ============================================================

// NetLiquidityPoint is a single data point for net liquidity chart.
type NetLiquidityPoint struct {
	Date         string   `json:"date"`
	NetLiquidity *float64 `json:"net_liquidity"`
	SOMAAssets   *float64 `json:"soma_assets"`
	RRP          *float64 `json:"rrp"`
	TGA          *float64 `json:"tga"`
}

// LayerScorePoint groups layer scores by date.
type LayerScorePoint struct {
	Date   string   `json:"date"`
	Layer1 *float64 `json:"layer1"`
	Layer2A *float64 `json:"layer2a"`
	Layer2B *float64 `json:"layer2b"`
}

// DivergencePoint is a single data point for layer divergence chart.
type DivergencePoint struct {
	Date       string   `json:"date"`
	Divergence *float64 `json:"divergence"`
	ZL2B       *float64 `json:"z_l2b"`
	ZSP500     *float64 `json:"z_sp500"`
}

// HistoryChartsData holds all chart series.
type HistoryChartsData struct {
	NetLiquidity     []NetLiquidityPoint    `json:"net_liquidity"`
	MarginDebt       []map[string]any       `json:"margin_debt"`
	BankSector       []map[string]any       `json:"bank_sector"`
	CreditSpreads    []map[string]any       `json:"credit_spreads"`
	MarketIndicators []map[string]any       `json:"market_indicators"`
	InterestRates    []map[string]any       `json:"interest_rates"`
	LayerScores      []LayerScorePoint      `json:"layer_scores"`
	LayerDivergence  []DivergencePoint      `json:"layer_divergence"`
}

// HistoryChartsResponse is the response for GET /api/liquidity/history-charts.
type HistoryChartsResponse struct {
	Period    string            `json:"period"`
	StartDate string           `json:"start_date"`
	EndDate   string           `json:"end_date"`
	Data      HistoryChartsData `json:"data"`
}

// ============================================================
// Backtest States
// ============================================================

// BacktestStateEntry is a single monthly state assessment.
type BacktestStateEntry struct {
	Date          string   `json:"date"`
	StateCode     string   `json:"state_code"`
	StateLabel    string   `json:"state_label"`
	Color         string   `json:"color"`
	Action        string   `json:"action"`
	Layer1Stress  int      `json:"layer1_stress"`
	Layer2AStress int      `json:"layer2a_stress"`
	Layer2BStress int      `json:"layer2b_stress"`
	SP500         *float64 `json:"sp500"`
	Return6M      *float64 `json:"return_6m"`
}

// StateStats holds forward return statistics for a market state.
type StateStats struct {
	AvgReturn6M   float64 `json:"avg_return_6m"`
	WinRate       float64 `json:"win_rate"`
	MaxDrawdown   float64 `json:"max_drawdown"`
	BestReturn    float64 `json:"best_return"`
	SampleCount   int     `json:"sample_count"`
	OccurrencePct float64 `json:"occurrence_pct"`
}

// StateDefinition describes a market state for the UI.
type StateDefinition struct {
	Code        string `json:"code"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Conditions  string `json:"conditions"`
	Action      string `json:"action"`
	Color       string `json:"color"`
}

// CrisisTimelineEntry maps a historical crisis to its detected state.
type CrisisTimelineEntry struct {
	Event        string   `json:"event"`
	Description  string   `json:"description"`
	EventDate    string   `json:"event_date"`
	ActualDate   string   `json:"actual_date"`
	StateCode    string   `json:"state_code"`
	StateLabel   string   `json:"state_label"`
	Color        string   `json:"color"`
	Layer1Stress int      `json:"layer1_stress"`
	Layer2AStress int     `json:"layer2a_stress"`
	Layer2BStress int     `json:"layer2b_stress"`
	SP500        *float64 `json:"sp500"`
	Return6M     *float64 `json:"return_6m"`
}

// BacktestStatesResponse is the response for GET /api/liquidity/backtest-states.
type BacktestStatesResponse struct {
	States           []BacktestStateEntry       `json:"states"`
	StateDefinitions []StateDefinition          `json:"state_definitions"`
	StateStats       map[string]StateStats      `json:"state_stats"`
	TotalMonths      int                        `json:"total_months"`
	EventTimeline    []CrisisTimelineEntry      `json:"event_timeline"`
}

// ============================================================
// MarketState (existing — re-export for reference)
// Already defined in market_state.go
// ============================================================

