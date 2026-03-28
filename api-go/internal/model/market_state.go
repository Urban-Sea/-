package model

import "time"

// MarketState represents a row in the market_state_history table.
type MarketState struct {
	ID             int        `json:"id"              db:"id"`
	Date           DateOnly   `json:"date"            db:"date"`
	State          string     `json:"state"           db:"state"`
	Layer1Stress   *float64   `json:"layer1_stress"   db:"layer1_stress"`
	Layer2aStress  *float64   `json:"layer2a_stress"  db:"layer2a_stress"`
	Layer2bStress  *float64   `json:"layer2b_stress"  db:"layer2b_stress"`
	CreditPressure *string    `json:"credit_pressure" db:"credit_pressure"`
	Comment        *string    `json:"comment"         db:"comment"`
	CreatedAt      time.Time  `json:"created_at"      db:"created_at"`
}

// MarketStateListResponse is the paginated list response.
type MarketStateListResponse struct {
	Records []MarketState `json:"records"`
	Total   int           `json:"total"`
}

// CreateMarketStateRequest is the body for POST /api/market-state.
type CreateMarketStateRequest struct {
	Date           string   `json:"date"`
	State          string   `json:"state"`
	Layer1Stress   *float64 `json:"layer1_stress"`
	Layer2aStress  *float64 `json:"layer2a_stress"`
	Layer2bStress  *float64 `json:"layer2b_stress"`
	CreditPressure *string  `json:"credit_pressure"`
	Comment        *string  `json:"comment"`
}
