package model

import "time"

// Watchlist represents a row in the user_watchlists table.
type Watchlist struct {
	ID        string    `json:"id"         db:"id"`
	UserID    string    `json:"user_id"    db:"user_id"`
	Name      string    `json:"name"       db:"name"`
	Tickers   []string  `json:"tickers"    db:"tickers"`
	IsDefault bool      `json:"is_default" db:"is_default"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}
