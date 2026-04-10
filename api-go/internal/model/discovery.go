package model

import (
	"encoding/json"
	"time"
)

// DiscoveredStock represents a row in the discovered_stocks table.
type DiscoveredStock struct {
	ScanDate       time.Time       `json:"-"                db:"scan_date"`
	ScanDateStr    string          `json:"scan_date"        db:"-"`
	Ticker         string          `json:"ticker"           db:"ticker"`
	Presets        []string        `json:"presets"          db:"presets"`
	FinvizScore    float64         `json:"finviz_score"     db:"finviz_score"`
	Fundament      json.RawMessage `json:"fundament"        db:"fundament"`
	CreatedAt      time.Time       `json:"created_at"       db:"created_at"`
	HadSignal      *bool           `json:"had_signal"       db:"had_signal"`
	SignalGrade    *string         `json:"signal_grade"     db:"signal_grade"`
	EntryTriggered *bool           `json:"entry_triggered"  db:"entry_triggered"`
	RealizedPnlPct *float64        `json:"realized_pnl_pct" db:"realized_pnl_pct"`
	OutcomeAt      *time.Time      `json:"outcome_at"       db:"outcome_at"`
}

// FormatScanDate populates ScanDateStr from ScanDate.
func (d *DiscoveredStock) FormatScanDate() {
	d.ScanDateStr = d.ScanDate.Format("2006-01-02")
}

// DiscoveryUpsertRequest is the JSON body for POST /api/admin/discovery/upsert.
type DiscoveryUpsertRequest struct {
	ScanDate             string                 `json:"scan_date"`
	ScanStartedAt        string                 `json:"scan_started_at"`
	ScanFinishedAt       string                 `json:"scan_finished_at"`
	ScannerVersion       string                 `json:"scanner_version"`
	FinvizfinanceVersion string                 `json:"finvizfinance_version"`
	PresetCounts         map[string]int         `json:"preset_counts"`
	TotalUnique          int                    `json:"total_unique"`
	AfterThreshold       int                    `json:"after_threshold"`
	Threshold            float64                `json:"threshold"`
	DiscountFloorApplied bool                   `json:"discount_floor_applied"`
	Tickers              []DiscoveryTickerInput `json:"tickers"`
}

// DiscoveryTickerInput represents one ticker in the upsert payload.
type DiscoveryTickerInput struct {
	Ticker      string          `json:"ticker"`
	Presets     []string        `json:"presets"`
	FinvizScore float64         `json:"finviz_score"`
	Fundament   json.RawMessage `json:"fundament"`
}

// DiscoveryResponse is the response for GET /api/discovery/today.
type DiscoveryResponse struct {
	ScanDate       string            `json:"scan_date"`
	PresetCounts   map[string]int    `json:"preset_counts"`
	TotalUnique    int               `json:"total_unique"`
	AfterThreshold int               `json:"after_threshold"`
	Threshold      float64           `json:"threshold"`
	Tickers        []DiscoveredStock `json:"tickers"`
}
