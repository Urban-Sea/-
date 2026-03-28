package model

import "time"

// Stock represents a row in the stock_master table.
type Stock struct {
	Ticker            string    `json:"ticker"             db:"ticker"`
	Name              *string   `json:"name"               db:"name"`
	Sector            *string   `json:"sector"             db:"sector"`
	Industry          *string   `json:"industry"           db:"industry"`
	PriceCategory     *string   `json:"price_category"     db:"price_category"`
	WatchlistCategory *string   `json:"watchlist_category" db:"watchlist_category"`
	MarketCap         *int64    `json:"market_cap"         db:"market_cap"`
	Exchange          *string   `json:"exchange"           db:"exchange"`
	IsActive          bool      `json:"is_active"          db:"is_active"`
	AddedAt           time.Time `json:"added_at"           db:"added_at"`
	UpdatedAt         time.Time `json:"updated_at"         db:"updated_at"`
}

// StockListResponse is the envelope for the list endpoint.
type StockListResponse struct {
	Stocks []Stock `json:"stocks"`
	Total  int     `json:"total"`
}

// CategoriesResponse holds distinct price and watchlist categories.
type CategoriesResponse struct {
	PriceCategories     []string `json:"price_categories"`
	WatchlistCategories []string `json:"watchlist_categories"`
}
