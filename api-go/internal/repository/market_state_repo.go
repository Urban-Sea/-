package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// MarketStateRepository handles persistence for the market_state_history table.
type MarketStateRepository struct {
	pool *pgxpool.Pool
}

// NewMarketStateRepository creates a new MarketStateRepository.
func NewMarketStateRepository(pool *pgxpool.Pool) *MarketStateRepository {
	return &MarketStateRepository{pool: pool}
}

const marketStateColumns = `id, date, state, layer1_stress, layer2a_stress, layer2b_stress, credit_pressure, comment, created_at`

// List retrieves market state history with pagination, ordered by date descending.
// Returns the rows and the total count.
func (r *MarketStateRepository) List(ctx context.Context, limit, offset int) ([]model.MarketState, int, error) {
	// Get total count.
	var total int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM market_state_history`).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("marketState List count: %w", err)
	}

	query := fmt.Sprintf(
		`SELECT %s FROM market_state_history ORDER BY date DESC LIMIT $1 OFFSET $2`,
		marketStateColumns,
	)
	rows, err := r.pool.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("marketState List query: %w", err)
	}
	states, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.MarketState])
	if err != nil {
		return nil, 0, fmt.Errorf("marketState List collect: %w", err)
	}

	return states, total, nil
}

// GetLatest retrieves the most recent market state entry.
func (r *MarketStateRepository) GetLatest(ctx context.Context) (*model.MarketState, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM market_state_history ORDER BY date DESC LIMIT 1`,
		marketStateColumns,
	)
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("marketState GetLatest query: %w", err)
	}
	state, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.MarketState])
	if err != nil {
		return nil, fmt.Errorf("marketState GetLatest collect: %w", err)
	}
	return state, nil
}

// Create inserts a new market state row and returns the created row.
func (r *MarketStateRepository) Create(ctx context.Context, req model.CreateMarketStateRequest) (*model.MarketState, error) {
	query := fmt.Sprintf(`
		INSERT INTO market_state_history (date, state, layer1_stress, layer2a_stress, layer2b_stress, credit_pressure, comment)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING %s`, marketStateColumns)

	rows, err := r.pool.Query(ctx, query,
		req.Date, req.State,
		req.Layer1Stress, req.Layer2aStress, req.Layer2bStress,
		req.CreditPressure, req.Comment,
	)
	if err != nil {
		return nil, fmt.Errorf("marketState Create query: %w", err)
	}
	state, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.MarketState])
	if err != nil {
		return nil, fmt.Errorf("marketState Create collect: %w", err)
	}
	return state, nil
}
