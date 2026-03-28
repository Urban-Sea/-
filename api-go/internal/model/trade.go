package model

import "time"

// Trade represents a row in the trades table.
type Trade struct {
	ID             string     `json:"id"               db:"id"`
	UserID         string     `json:"user_id"          db:"user_id"`
	HoldingID      *string    `json:"holding_id"       db:"holding_id"`
	Ticker         string     `json:"ticker"           db:"ticker"`
	Action         string     `json:"action"           db:"action"`
	Shares         float64    `json:"shares"           db:"shares"`
	Price          float64    `json:"price"            db:"price"`
	Fees           float64    `json:"fees"             db:"fees"`
	TradeDate      time.Time  `json:"trade_date"       db:"trade_date"`
	AccountType    *string    `json:"account_type"     db:"account_type"`
	Regime         *string    `json:"regime"           db:"regime"`
	RSTrend        *string    `json:"rs_trend"         db:"rs_trend"`
	Reason         *string    `json:"reason"           db:"reason"`
	LessonsLearned *string    `json:"lessons_learned"  db:"lessons_learned"`
	ProfitLoss     *float64   `json:"profit_loss"      db:"profit_loss"`
	ProfitLossPct  *float64   `json:"profit_loss_pct"  db:"profit_loss_pct"`
	HoldingDays    *int       `json:"holding_days"     db:"holding_days"`
	CreatedAt      time.Time  `json:"created_at"       db:"created_at"`
}

// TradeStats contains aggregated trade statistics for a user.
type TradeStats struct {
	TotalTrades    int     `json:"total_trades"`
	BuyCount       int     `json:"buy_count"`
	SellCount      int     `json:"sell_count"`
	TotalProfitLoss float64 `json:"total_profit_loss"`
	WinCount       int     `json:"win_count"`
	LossCount      int     `json:"loss_count"`
	WinRate        float64 `json:"win_rate"`
	AvgProfit      float64 `json:"avg_profit"`
	AvgLoss        float64 `json:"avg_loss"`
	ProfitFactor   float64 `json:"profit_factor"`
}

// HoldingRow represents the fields needed from holdings for sell-from-holding.
type HoldingRow struct {
	ID        string    `db:"id"`
	UserID    string    `db:"user_id"`
	Ticker    string    `db:"ticker"`
	Shares    float64   `db:"shares"`
	AvgPrice  float64   `db:"avg_price"`
	EntryDate *time.Time `db:"entry_date"`
}
