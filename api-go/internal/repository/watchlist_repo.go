package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// WatchlistRepository handles persistence for the user_watchlists table.
type WatchlistRepository struct {
	pool *pgxpool.Pool
}

// NewWatchlistRepository creates a new WatchlistRepository.
func NewWatchlistRepository(pool *pgxpool.Pool) *WatchlistRepository {
	return &WatchlistRepository{pool: pool}
}

const watchlistColumns = `id, user_id, name, tickers, is_default, created_at, updated_at`

// ListByUserID returns all watchlists for a user, default first then by name.
func (r *WatchlistRepository) ListByUserID(ctx context.Context, userID string) ([]model.Watchlist, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM user_watchlists WHERE user_id = $1 ORDER BY is_default DESC, name`,
		watchlistColumns,
	)
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("watchlist ListByUserID query: %w", err)
	}
	watchlists, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.Watchlist])
	if err != nil {
		return nil, fmt.Errorf("watchlist ListByUserID collect: %w", err)
	}
	return watchlists, nil
}

// FindByID retrieves a single watchlist by ID scoped to user.
func (r *WatchlistRepository) FindByID(ctx context.Context, userID, watchlistID string) (*model.Watchlist, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM user_watchlists WHERE id = $1 AND user_id = $2`,
		watchlistColumns,
	)
	rows, err := r.pool.Query(ctx, query, watchlistID, userID)
	if err != nil {
		return nil, fmt.Errorf("watchlist FindByID query: %w", err)
	}
	wl, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Watchlist])
	if err != nil {
		return nil, fmt.Errorf("watchlist FindByID collect: %w", err)
	}
	return wl, nil
}

// FindDefault retrieves the default watchlist for a user (if any).
func (r *WatchlistRepository) FindDefault(ctx context.Context, userID string) (*model.Watchlist, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM user_watchlists WHERE user_id = $1 AND is_default = true LIMIT 1`,
		watchlistColumns,
	)
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("watchlist FindDefault query: %w", err)
	}
	wl, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Watchlist])
	if err != nil {
		return nil, fmt.Errorf("watchlist FindDefault collect: %w", err)
	}
	return wl, nil
}

// Create inserts a new watchlist and returns the created row.
func (r *WatchlistRepository) Create(ctx context.Context, userID, name string, tickers []string, isDefault bool) (*model.Watchlist, error) {
	query := fmt.Sprintf(`
		INSERT INTO user_watchlists (user_id, name, tickers, is_default)
		VALUES ($1, $2, $3, $4)
		RETURNING %s`, watchlistColumns)
	rows, err := r.pool.Query(ctx, query, userID, name, tickers, isDefault)
	if err != nil {
		return nil, fmt.Errorf("watchlist Create query: %w", err)
	}
	wl, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Watchlist])
	if err != nil {
		return nil, fmt.Errorf("watchlist Create collect: %w", err)
	}
	return wl, nil
}

// Update modifies name, tickers, and/or is_default for a watchlist.
// Only non-nil fields are updated.
func (r *WatchlistRepository) Update(ctx context.Context, userID, watchlistID string, name *string, tickers []string, isDefault *bool) (*model.Watchlist, error) {
	// Build SET clause dynamically.
	setClauses := ""
	args := []any{}
	argIdx := 1

	if name != nil {
		setClauses += fmt.Sprintf("name = $%d, ", argIdx)
		args = append(args, *name)
		argIdx++
	}
	if tickers != nil {
		setClauses += fmt.Sprintf("tickers = $%d, ", argIdx)
		args = append(args, tickers)
		argIdx++
	}
	if isDefault != nil {
		setClauses += fmt.Sprintf("is_default = $%d, ", argIdx)
		args = append(args, *isDefault)
		argIdx++
	}

	if len(setClauses) == 0 {
		return nil, fmt.Errorf("watchlist Update: no fields to update")
	}
	// Trim trailing comma+space.
	setClauses = setClauses[:len(setClauses)-2]

	query := fmt.Sprintf(
		`UPDATE user_watchlists SET %s WHERE id = $%d AND user_id = $%d RETURNING %s`,
		setClauses, argIdx, argIdx+1, watchlistColumns,
	)
	args = append(args, watchlistID, userID)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("watchlist Update query: %w", err)
	}
	wl, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Watchlist])
	if err != nil {
		return nil, fmt.Errorf("watchlist Update collect: %w", err)
	}
	return wl, nil
}

// Delete removes a watchlist by ID scoped to user. Returns true if a row was deleted.
func (r *WatchlistRepository) Delete(ctx context.Context, userID, watchlistID string) (bool, error) {
	query := `DELETE FROM user_watchlists WHERE id = $1 AND user_id = $2`
	tag, err := r.pool.Exec(ctx, query, watchlistID, userID)
	if err != nil {
		return false, fmt.Errorf("watchlist Delete: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// UpdateTickers sets the tickers array for a watchlist.
func (r *WatchlistRepository) UpdateTickers(ctx context.Context, userID, watchlistID string, tickers []string) error {
	query := `UPDATE user_watchlists SET tickers = $1 WHERE id = $2 AND user_id = $3`
	tag, err := r.pool.Exec(ctx, query, tickers, watchlistID, userID)
	if err != nil {
		return fmt.Errorf("watchlist UpdateTickers: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("watchlist UpdateTickers: no rows affected")
	}
	return nil
}
