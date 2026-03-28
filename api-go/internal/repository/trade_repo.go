package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// TradeRepository handles persistence for the trades table.
type TradeRepository struct {
	pool *pgxpool.Pool
}

// NewTradeRepository creates a new TradeRepository.
func NewTradeRepository(pool *pgxpool.Pool) *TradeRepository {
	return &TradeRepository{pool: pool}
}

// Pool exposes the underlying pool for transaction use in handlers.
func (r *TradeRepository) Pool() *pgxpool.Pool {
	return r.pool
}

const tradeColumns = `id, user_id, holding_id, ticker, action, shares, price, fees,
	trade_date, account_type, regime, rs_trend, reason, lessons_learned,
	profit_loss, profit_loss_pct, holding_days, created_at`

// TradeListFilter holds optional filters for listing trades.
type TradeListFilter struct {
	UserID string
	Ticker *string
	Action *string
	Limit  int
}

// List retrieves trades for a user with optional filters, ordered by trade_date DESC.
func (r *TradeRepository) List(ctx context.Context, f TradeListFilter) ([]model.Trade, error) {
	query := fmt.Sprintf(`SELECT %s FROM trades WHERE user_id = $1`, tradeColumns)
	args := []any{f.UserID}
	argIdx := 2

	if f.Ticker != nil {
		query += fmt.Sprintf(` AND ticker = $%d`, argIdx)
		args = append(args, *f.Ticker)
		argIdx++
	}

	if f.Action != nil {
		query += fmt.Sprintf(` AND action = $%d`, argIdx)
		args = append(args, *f.Action)
		argIdx++
	}

	query += ` ORDER BY trade_date DESC`

	if f.Limit > 0 {
		query += fmt.Sprintf(` LIMIT $%d`, argIdx)
		args = append(args, f.Limit)
	}

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("trade List query: %w", err)
	}
	trades, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.Trade])
	if err != nil {
		return nil, fmt.Errorf("trade List collect: %w", err)
	}
	return trades, nil
}

// GetByID retrieves a single trade by id and user_id.
func (r *TradeRepository) GetByID(ctx context.Context, tradeID, userID string) (*model.Trade, error) {
	query := fmt.Sprintf(`SELECT %s FROM trades WHERE id = $1 AND user_id = $2`, tradeColumns)
	rows, err := r.pool.Query(ctx, query, tradeID, userID)
	if err != nil {
		return nil, fmt.Errorf("trade GetByID query: %w", err)
	}
	trade, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Trade])
	if err != nil {
		return nil, fmt.Errorf("trade GetByID collect: %w", err)
	}
	return trade, nil
}

// Create inserts a new trade and returns the created row.
func (r *TradeRepository) Create(ctx context.Context, t *model.Trade) (*model.Trade, error) {
	query := fmt.Sprintf(`
		INSERT INTO trades (user_id, holding_id, ticker, action, shares, price, fees,
			trade_date, account_type, regime, rs_trend, reason, lessons_learned,
			profit_loss, profit_loss_pct, holding_days)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		RETURNING %s`, tradeColumns)
	rows, err := r.pool.Query(ctx, query,
		t.UserID, t.HoldingID, t.Ticker, t.Action, t.Shares, t.Price, t.Fees,
		t.TradeDate, t.AccountType, t.Regime, t.RSTrend, t.Reason, t.LessonsLearned,
		t.ProfitLoss, t.ProfitLossPct, t.HoldingDays,
	)
	if err != nil {
		return nil, fmt.Errorf("trade Create query: %w", err)
	}
	trade, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Trade])
	if err != nil {
		return nil, fmt.Errorf("trade Create collect: %w", err)
	}
	return trade, nil
}

// Delete removes a trade by id and user_id. Returns true if a row was deleted.
func (r *TradeRepository) Delete(ctx context.Context, tradeID, userID string) (bool, error) {
	query := `DELETE FROM trades WHERE id = $1 AND user_id = $2`
	tag, err := r.pool.Exec(ctx, query, tradeID, userID)
	if err != nil {
		return false, fmt.Errorf("trade Delete: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// GetAllForStats retrieves all trades for a user (used to compute stats in-memory).
func (r *TradeRepository) GetAllForStats(ctx context.Context, userID string) ([]model.Trade, error) {
	query := fmt.Sprintf(`SELECT %s FROM trades WHERE user_id = $1 ORDER BY trade_date DESC`, tradeColumns)
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("trade GetAllForStats query: %w", err)
	}
	trades, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.Trade])
	if err != nil {
		return nil, fmt.Errorf("trade GetAllForStats collect: %w", err)
	}
	return trades, nil
}
