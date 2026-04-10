package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/open-regime/api-go/internal/model"
)

// DiscoveryRepository handles persistence for the discovered_stocks table.
type DiscoveryRepository struct {
	pool *pgxpool.Pool
}

// NewDiscoveryRepository creates a new DiscoveryRepository.
func NewDiscoveryRepository(pool *pgxpool.Pool) *DiscoveryRepository {
	return &DiscoveryRepository{pool: pool}
}

// UpsertDiscovery replaces all rows for a given scan_date within a transaction.
// This is idempotent: re-publishing the same date replaces the entire set.
func (r *DiscoveryRepository) UpsertDiscovery(ctx context.Context, scanDate string, tickers []model.DiscoveryTickerInput) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("discovery upsert begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Delete existing rows for this date (full-day replace).
	_, err = tx.Exec(ctx, `DELETE FROM discovered_stocks WHERE scan_date = $1`, scanDate)
	if err != nil {
		return 0, fmt.Errorf("discovery upsert delete: %w", err)
	}

	// Batch insert.
	batch := &pgx.Batch{}
	for _, t := range tickers {
		batch.Queue(
			`INSERT INTO discovered_stocks (scan_date, ticker, presets, finviz_score, fundament)
			 VALUES ($1, $2, $3, $4, $5)`,
			scanDate, t.Ticker, t.Presets, t.FinvizScore, t.Fundament,
		)
	}

	br := tx.SendBatch(ctx, batch)
	for range tickers {
		if _, err := br.Exec(); err != nil {
			br.Close()
			return 0, fmt.Errorf("discovery upsert insert: %w", err)
		}
	}
	br.Close()

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("discovery upsert commit: %w", err)
	}

	return len(tickers), nil
}

const discoveryColumns = `scan_date, ticker, presets, finviz_score, fundament, created_at,
	had_signal, signal_grade, entry_triggered, realized_pnl_pct, outcome_at`

// GetLatestDiscovery returns rows for the most recent scan_date.
func (r *DiscoveryRepository) GetLatestDiscovery(ctx context.Context) ([]model.DiscoveredStock, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM discovered_stocks
		 WHERE scan_date = (SELECT MAX(scan_date) FROM discovered_stocks)
		 ORDER BY finviz_score DESC`, discoveryColumns,
	)

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("discovery latest query: %w", err)
	}

	stocks, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.DiscoveredStock])
	if err != nil {
		return nil, fmt.Errorf("discovery latest collect: %w", err)
	}

	// Format scan_date for JSON output.
	for i := range stocks {
		stocks[i].FormatScanDate()
	}
	return stocks, nil
}

// GetDiscoveryHistory returns rows for the last N days.
func (r *DiscoveryRepository) GetDiscoveryHistory(ctx context.Context, days int) ([]model.DiscoveredStock, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM discovered_stocks
		 WHERE scan_date >= (current_date - $1::integer)
		 ORDER BY scan_date DESC, finviz_score DESC`, discoveryColumns,
	)

	rows, err := r.pool.Query(ctx, query, days)
	if err != nil {
		return nil, fmt.Errorf("discovery history query: %w", err)
	}

	stocks, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.DiscoveredStock])
	if err != nil {
		return nil, fmt.Errorf("discovery history collect: %w", err)
	}

	for i := range stocks {
		stocks[i].FormatScanDate()
	}
	return stocks, nil
}

// GetDiscoveryScanDates returns distinct scan dates (most recent first), up to limit.
func (r *DiscoveryRepository) GetDiscoveryScanDates(ctx context.Context, limit int) ([]time.Time, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT DISTINCT scan_date FROM discovered_stocks ORDER BY scan_date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("discovery scan dates query: %w", err)
	}
	defer rows.Close()

	var dates []time.Time
	for rows.Next() {
		var d time.Time
		if err := rows.Scan(&d); err != nil {
			return nil, fmt.Errorf("discovery scan dates scan: %w", err)
		}
		dates = append(dates, d)
	}
	return dates, rows.Err()
}
