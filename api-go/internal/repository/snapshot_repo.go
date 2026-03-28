package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// SnapshotRepository handles persistence for the portfolio_snapshots table.
type SnapshotRepository struct {
	pool *pgxpool.Pool
}

// NewSnapshotRepository creates a new SnapshotRepository.
func NewSnapshotRepository(pool *pgxpool.Pool) *SnapshotRepository {
	return &SnapshotRepository{pool: pool}
}

const snapshotColumns = `id, user_id, snapshot_date, total_market_value_usd, total_cost_usd,
	unrealized_pnl_usd, cash_usd, total_assets_usd, fx_rate_usdjpy,
	holdings_count, holdings_detail, created_at`

// ListByUser retrieves portfolio snapshots for a user within the given number of months.
func (r *SnapshotRepository) ListByUser(ctx context.Context, userID string, months int) ([]model.PortfolioSnapshot, error) {
	query := fmt.Sprintf(`
		SELECT %s FROM portfolio_snapshots
		WHERE user_id = $1 AND snapshot_date >= (CURRENT_DATE - ($2 || ' months')::interval)
		ORDER BY snapshot_date`, snapshotColumns)

	rows, err := r.pool.Query(ctx, query, userID, fmt.Sprintf("%d", months))
	if err != nil {
		return nil, fmt.Errorf("snapshot ListByUser query: %w", err)
	}
	snapshots, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.PortfolioSnapshot])
	if err != nil {
		return nil, fmt.Errorf("snapshot ListByUser collect: %w", err)
	}
	return snapshots, nil
}

// GetLatestUSDJPY retrieves the most recent usdjpy value from market_indicators.
func (r *SnapshotRepository) GetLatestUSDJPY(ctx context.Context) (*float64, error) {
	var rate *float64
	err := r.pool.QueryRow(ctx,
		`SELECT usdjpy FROM market_indicators WHERE usdjpy IS NOT NULL ORDER BY date DESC LIMIT 1`).
		Scan(&rate)
	if err != nil {
		return nil, fmt.Errorf("snapshot GetLatestUSDJPY: %w", err)
	}
	return rate, nil
}
