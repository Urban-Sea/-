package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// HoldingRepository handles persistence for the holdings table.
type HoldingRepository struct {
	pool *pgxpool.Pool
}

// NewHoldingRepository creates a new HoldingRepository.
func NewHoldingRepository(pool *pgxpool.Pool) *HoldingRepository {
	return &HoldingRepository{pool: pool}
}

const holdingColumns = `id, user_id, ticker, shares, avg_price, entry_date, account_type,
	sector, regime_at_entry, rs_at_entry, fx_rate, target_price, stop_loss,
	thesis, notes, created_at, updated_at`

// ListByUser retrieves all holdings for a user, ordered by ticker.
func (r *HoldingRepository) ListByUser(ctx context.Context, userID string) ([]model.Holding, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM holdings WHERE user_id = $1 ORDER BY ticker`, holdingColumns)
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("holding ListByUser query: %w", err)
	}
	holdings, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.Holding])
	if err != nil {
		return nil, fmt.Errorf("holding ListByUser collect: %w", err)
	}
	return holdings, nil
}

// FindByID retrieves a holding by UUID, scoped to user.
func (r *HoldingRepository) FindByID(ctx context.Context, userID, holdingID string) (*model.Holding, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM holdings WHERE id = $1 AND user_id = $2`, holdingColumns)
	rows, err := r.pool.Query(ctx, query, holdingID, userID)
	if err != nil {
		return nil, fmt.Errorf("holding FindByID query: %w", err)
	}
	h, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Holding])
	if err != nil {
		return nil, fmt.Errorf("holding FindByID collect: %w", err)
	}
	return h, nil
}

// FindByTicker retrieves a holding by ticker, scoped to user.
func (r *HoldingRepository) FindByTicker(ctx context.Context, userID, ticker string) (*model.Holding, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM holdings WHERE user_id = $1 AND ticker = $2`, holdingColumns)
	rows, err := r.pool.Query(ctx, query, userID, ticker)
	if err != nil {
		return nil, fmt.Errorf("holding FindByTicker query: %w", err)
	}
	h, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Holding])
	if err != nil {
		return nil, fmt.Errorf("holding FindByTicker collect: %w", err)
	}
	return h, nil
}

// Create inserts a new holding and returns it.
func (r *HoldingRepository) Create(ctx context.Context, userID string, req model.CreateHoldingRequest) (*model.Holding, error) {
	accountType := "tokutei"
	if req.AccountType != nil {
		accountType = *req.AccountType
	}
	fxRate := 150.0
	if req.FxRate != nil {
		fxRate = *req.FxRate
	}

	query := fmt.Sprintf(`
		INSERT INTO holdings (user_id, ticker, shares, avg_price, entry_date,
			account_type, sector, regime_at_entry, rs_at_entry, fx_rate,
			target_price, stop_loss, thesis, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING %s`, holdingColumns)

	rows, err := r.pool.Query(ctx, query,
		userID, req.Ticker, req.Shares, req.AvgPrice, req.EntryDate,
		accountType, req.Sector, req.RegimeAtEntry, req.RsAtEntry, fxRate,
		req.TargetPrice, req.StopLoss, req.Thesis, req.Notes,
	)
	if err != nil {
		return nil, fmt.Errorf("holding Create query: %w", err)
	}
	h, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Holding])
	if err != nil {
		return nil, fmt.Errorf("holding Create collect: %w", err)
	}
	return h, nil
}

// Update updates a holding and returns the updated row.
func (r *HoldingRepository) Update(ctx context.Context, userID, holdingID string, req model.UpdateHoldingRequest) (*model.Holding, error) {
	query := fmt.Sprintf(`
		UPDATE holdings SET
			shares       = COALESCE($1, shares),
			avg_price    = COALESCE($2, avg_price),
			account_type = COALESCE($3, account_type),
			sector       = COALESCE($4, sector),
			target_price = COALESCE($5, target_price),
			stop_loss    = COALESCE($6, stop_loss),
			thesis       = COALESCE($7, thesis),
			notes        = COALESCE($8, notes),
			updated_at   = now()
		WHERE id = $9 AND user_id = $10
		RETURNING %s`, holdingColumns)

	rows, err := r.pool.Query(ctx, query,
		req.Shares, req.AvgPrice, req.AccountType, req.Sector,
		req.TargetPrice, req.StopLoss, req.Thesis, req.Notes,
		holdingID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("holding Update query: %w", err)
	}
	h, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Holding])
	if err != nil {
		return nil, fmt.Errorf("holding Update collect: %w", err)
	}
	return h, nil
}

// AddShares performs a weighted-average buy-up and returns the updated holding.
func (r *HoldingRepository) AddShares(ctx context.Context, userID, holdingID string, newShares, newPrice float64) (*model.Holding, error) {
	query := fmt.Sprintf(`
		UPDATE holdings SET
			avg_price  = (shares * avg_price + $1 * $2) / (shares + $1),
			shares     = shares + $1,
			updated_at = now()
		WHERE id = $3 AND user_id = $4
		RETURNING %s`, holdingColumns)

	rows, err := r.pool.Query(ctx, query, newShares, newPrice, holdingID, userID)
	if err != nil {
		return nil, fmt.Errorf("holding AddShares query: %w", err)
	}
	h, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Holding])
	if err != nil {
		return nil, fmt.Errorf("holding AddShares collect: %w", err)
	}
	return h, nil
}

// Delete removes a holding by ID, scoped to user.
func (r *HoldingRepository) Delete(ctx context.Context, userID, holdingID string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM holdings WHERE id = $1 AND user_id = $2`, holdingID, userID)
	if err != nil {
		return fmt.Errorf("holding Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("holding Delete: no rows affected (id=%s)", holdingID)
	}
	return nil
}
