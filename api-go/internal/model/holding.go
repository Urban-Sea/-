package model

import "time"

// Holding represents a row in the holdings table.
type Holding struct {
	ID            string     `json:"id"              db:"id"`
	UserID        string     `json:"user_id"         db:"user_id"`
	Ticker        string     `json:"ticker"          db:"ticker"`
	Shares        float64    `json:"shares"          db:"shares"`
	AvgPrice      float64    `json:"avg_price"       db:"avg_price"`
	EntryDate     *time.Time `json:"entry_date"      db:"entry_date"`
	AccountType   string     `json:"account_type"    db:"account_type"`
	Sector        *string    `json:"sector"          db:"sector"`
	RegimeAtEntry *string    `json:"regime_at_entry" db:"regime_at_entry"`
	RsAtEntry     *string    `json:"rs_at_entry"     db:"rs_at_entry"`
	FxRate        float64    `json:"fx_rate"          db:"fx_rate"`
	TargetPrice   *float64   `json:"target_price"    db:"target_price"`
	StopLoss      *float64   `json:"stop_loss"       db:"stop_loss"`
	Thesis        *string    `json:"thesis"          db:"thesis"`
	Notes         *string    `json:"notes"           db:"notes"`
	CreatedAt     time.Time  `json:"created_at"      db:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"      db:"updated_at"`
}

// CreateHoldingRequest is the JSON body for POST /api/holdings.
type CreateHoldingRequest struct {
	Ticker        string   `json:"ticker"`
	Shares        float64  `json:"shares"`
	AvgPrice      float64  `json:"avg_price"`
	EntryDate     *string  `json:"entry_date"`
	AccountType   *string  `json:"account_type"`
	Sector        *string  `json:"sector"`
	RegimeAtEntry *string  `json:"regime_at_entry"`
	RsAtEntry     *string  `json:"rs_at_entry"`
	FxRate        *float64 `json:"fx_rate"`
	TargetPrice   *float64 `json:"target_price"`
	StopLoss      *float64 `json:"stop_loss"`
	Thesis        *string  `json:"thesis"`
	Notes         *string  `json:"notes"`
}

// UpdateHoldingRequest is the JSON body for PUT /api/holdings/:id.
type UpdateHoldingRequest struct {
	Shares      *float64 `json:"shares"`
	AvgPrice    *float64 `json:"avg_price"`
	AccountType *string  `json:"account_type"`
	Sector      *string  `json:"sector"`
	TargetPrice *float64 `json:"target_price"`
	StopLoss    *float64 `json:"stop_loss"`
	Thesis      *string  `json:"thesis"`
	Notes       *string  `json:"notes"`
}

// HoldingListResponse is the envelope for GET /api/holdings.
type HoldingListResponse struct {
	Holdings   []Holding `json:"holdings"`
	Total      int       `json:"total"`
	TotalValue float64   `json:"total_value"`
}

// CashBalance represents a row in the cash_balances table.
type CashBalance struct {
	ID          string    `json:"id"           db:"id"`
	UserID      string    `json:"user_id"      db:"user_id"`
	Label       string    `json:"label"        db:"label"`
	Currency    string    `json:"currency"     db:"currency"`
	Amount      float64   `json:"amount"       db:"amount"`
	AccountType *string   `json:"account_type" db:"account_type"`
	UpdatedAt   time.Time `json:"updated_at"   db:"updated_at"`
}

// CreateCashBalanceRequest is the JSON body for POST /api/holdings/cash.
type CreateCashBalanceRequest struct {
	Label       string   `json:"label"`
	Currency    *string  `json:"currency"`
	Amount      *float64 `json:"amount"`
	AccountType *string  `json:"account_type"`
}

// UpdateCashBalanceRequest is the JSON body for PUT /api/holdings/cash/:id.
type UpdateCashBalanceRequest struct {
	Label       *string  `json:"label"`
	Currency    *string  `json:"currency"`
	Amount      *float64 `json:"amount"`
	AccountType *string  `json:"account_type"`
}

// CashListResponse is the envelope for GET /api/holdings/cash.
type CashListResponse struct {
	Balances []CashBalance `json:"balances"`
	Total    float64       `json:"total"`
}

// PortfolioSnapshot represents a row in the portfolio_snapshots table.
type PortfolioSnapshot struct {
	ID                 string     `json:"id"                    db:"id"`
	UserID             string     `json:"user_id"               db:"user_id"`
	SnapshotDate       time.Time  `json:"snapshot_date"         db:"snapshot_date"`
	TotalMarketValueUS float64    `json:"total_market_value_usd" db:"total_market_value_usd"`
	TotalCostUSD       float64    `json:"total_cost_usd"        db:"total_cost_usd"`
	UnrealizedPnlUSD   float64    `json:"unrealized_pnl_usd"   db:"unrealized_pnl_usd"`
	CashUSD            float64    `json:"cash_usd"              db:"cash_usd"`
	TotalAssetsUSD     float64    `json:"total_assets_usd"      db:"total_assets_usd"`
	FxRateUSDJPY       *float64   `json:"fx_rate_usdjpy"        db:"fx_rate_usdjpy"`
	HoldingsCount      int        `json:"holdings_count"        db:"holdings_count"`
	HoldingsDetail     *string    `json:"holdings_detail"       db:"holdings_detail"`
	CreatedAt          time.Time  `json:"created_at"            db:"created_at"`
}

// PortfolioHistoryResponse is the envelope for GET /api/holdings/portfolio-history.
type PortfolioHistoryResponse struct {
	History []PortfolioSnapshot    `json:"history"`
	Summary map[string]interface{} `json:"summary"`
}

// HoldingsInitResponse is the envelope for GET /api/holdings/init.
type HoldingsInitResponse struct {
	Holdings   []Holding `json:"holdings"`
	Total      int       `json:"total"`
	TotalValue float64   `json:"total_value"`
	Cash       struct {
		Balances []CashBalance `json:"balances"`
		Total    float64       `json:"total"`
	} `json:"cash"`
	FxRate *float64 `json:"fx_rate"`
}
