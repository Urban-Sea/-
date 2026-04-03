package model

import "time"

// EconomicIndicator represents a row in the economic_indicators table.
type EconomicIndicator struct {
	ID                       int        `json:"id"                         db:"id"`
	Indicator                string     `json:"indicator"                  db:"indicator"`
	ReferencePeriod          DateOnly   `json:"reference_period"           db:"reference_period"`
	CurrentValue             *float64   `json:"current_value"              db:"current_value"`
	RevisionCount            int        `json:"revision_count"             db:"revision_count"`
	NFPChange                *int       `json:"nfp_change"                 db:"nfp_change"`
	U3Rate                   *float64   `json:"u3_rate"                    db:"u3_rate"`
	U6Rate                   *float64   `json:"u6_rate"                    db:"u6_rate"`
	AvgHourlyEarnings        *float64   `json:"avg_hourly_earnings"        db:"avg_hourly_earnings"`
	WageMoM                  *float64   `json:"wage_mom"                   db:"wage_mom"`
	LaborForceParticipation  *float64   `json:"labor_force_participation"  db:"labor_force_participation"`
	Notes                    *string    `json:"notes"                      db:"notes"`
	CreatedAt                time.Time  `json:"created_at"                 db:"created_at"`
	UpdatedAt                time.Time  `json:"updated_at"                 db:"updated_at"`
}

// WeeklyClaims represents a row in the weekly_claims table.
type WeeklyClaims struct {
	WeekEnding         DateOnly  `json:"week_ending"            db:"week_ending"`
	InitialClaims      *int      `json:"initial_claims"         db:"initial_claims"`
	ContinuedClaims    *int      `json:"continued_claims"       db:"continued_claims"`
	InitialClaims4WAvg *int      `json:"initial_claims_4w_avg"  db:"initial_claims_4w_avg"`
	CreatedAt          time.Time `json:"created_at"             db:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"             db:"updated_at"`
}

// EconomicIndicatorRevision represents a row in the economic_indicator_revisions table.
type EconomicIndicatorRevision struct {
	ID              int       `json:"id"                  db:"id"`
	IndicatorID     int       `json:"indicator_id"        db:"indicator_id"`
	RevisionNumber  int       `json:"revision_number"     db:"revision_number"`
	Value           *float64  `json:"value"               db:"value"`
	PublishedDate   *DateOnly `json:"published_date"      db:"published_date"`
	ChangeFromPrev  *float64  `json:"change_from_prev"    db:"change_from_prev"`
	ChangePctPrev   *float64  `json:"change_pct_from_prev" db:"change_pct_from_prev"`
	Notes           *string   `json:"notes"               db:"notes"`
	CreatedAt       time.Time `json:"created_at"          db:"created_at"`
}

// IndicatorInput is the request body for POST /api/employment/indicators.
type IndicatorInput struct {
	Indicator               string   `json:"indicator"`
	ReferencePeriod         string   `json:"reference_period"`
	CurrentValue            *float64 `json:"current_value"`
	NFPChange               *int     `json:"nfp_change"`
	U3Rate                  *float64 `json:"u3_rate"`
	U6Rate                  *float64 `json:"u6_rate"`
	AvgHourlyEarnings       *float64 `json:"avg_hourly_earnings"`
	WageMoM                 *float64 `json:"wage_mom"`
	LaborForceParticipation *float64 `json:"labor_force_participation"`
	Notes                   *string  `json:"notes"`
}

// OverviewResponse is the response for GET /api/employment/overview.
type OverviewResponse struct {
	LatestNFP    *EconomicIndicator `json:"latest_nfp"`
	LatestClaims *WeeklyClaims      `json:"latest_claims"`
	AlertLevel   string             `json:"alert_level"`
	AlertFactors []string           `json:"alert_factors"`
}

// RiskSubScore represents one sub-component of the risk score.
type RiskSubScore struct {
	Name     string `json:"name"`
	Score    int    `json:"score"`
	MaxScore int    `json:"max_score"`
	Detail   string `json:"detail"`
	Status   string `json:"status"`
}

// RiskScoreCategory represents a category (Employment/Consumption/Structure).
type RiskScoreCategory struct {
	Name       string         `json:"name"`
	Score      int            `json:"score"`
	MaxScore   int            `json:"max_score"`
	Components []RiskSubScore `json:"components"`
}

// SahmRuleData holds Sahm Rule calculation results.
type SahmRuleData struct {
	CurrentU3       *float64 `json:"current_u3"`
	U33MAvg         *float64 `json:"u3_3m_avg"`
	U312MLow3MAvg   *float64 `json:"u3_12m_low_3m_avg"`
	SahmValue       *float64 `json:"sahm_value"`
	Triggered       bool     `json:"triggered"`
	PeakOut         bool     `json:"peak_out"`
	NearPeakOut     bool     `json:"near_peak_out"`
}

// PhaseInfo describes the current economic phase.
type PhaseInfo struct {
	Code          string `json:"code"`
	Label         string `json:"label"`
	Description   string `json:"description"`
	Action        string `json:"action"`
	Color         string `json:"color"`
	PositionLimit int    `json:"position_limit"`
}

// EmploymentRiskScore is the response for GET /api/employment/risk-score.
type EmploymentRiskScore struct {
	TotalScore      int                 `json:"total_score"`
	Phase           PhaseInfo           `json:"phase"`
	Categories      []RiskScoreCategory `json:"categories"`
	SahmRule        SahmRuleData        `json:"sahm_rule"`
	AlertFactors    []string            `json:"alert_factors"`
	Timestamp       string              `json:"timestamp"`
	LatestNFP       map[string]any      `json:"latest_nfp"`
	LatestClaims    map[string]any      `json:"latest_claims"`
	NFPHistory      []map[string]any    `json:"nfp_history"`
	ClaimsHistory   []map[string]any    `json:"claims_history"`
	ConsumerHistory []map[string]any    `json:"consumer_history"`
}

// RiskHistoryEntry is one month in the risk history.
type RiskHistoryEntry struct {
	Date            string   `json:"date"`
	TotalScore      int      `json:"total_score"`
	EmploymentScore int      `json:"employment_score"`
	ConsumerScore   int      `json:"consumer_score"`
	StructureScore  int      `json:"structure_score"`
	Phase           string   `json:"phase"`
	SahmValue       *float64 `json:"sahm_value"`
}

// SP500Entry is one entry in the S&P 500 history for risk-history.
type SP500Entry struct {
	Date  string  `json:"date"`
	Close float64 `json:"close"`
}

// RiskHistoryResponse is the response for GET /api/employment/risk-history.
type RiskHistoryResponse struct {
	History []RiskHistoryEntry `json:"history"`
	SP500   []SP500Entry       `json:"sp500"`
}

// ManualInput represents a row from the manual_inputs table.
type ManualInput struct {
	Metric        string   `json:"metric"         db:"metric"`
	ReferenceDate DateOnly `json:"reference_date"  db:"reference_date"`
	Value         float64 `json:"value"           db:"value"`
}

// MarketIndicator holds market data for K-shape proxy.
type MarketIndicator struct {
	Date       DateOnly `json:"date"        db:"date"`
	SP500      *float64 `json:"sp500"       db:"sp500"`
	Russell2000 *float64 `json:"russell2000" db:"russell2000"`
}
