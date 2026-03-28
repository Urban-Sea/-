package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// CashRepository handles persistence for the cash_balances table.
type CashRepository struct {
	pool *pgxpool.Pool
}

// NewCashRepository creates a new CashRepository.
func NewCashRepository(pool *pgxpool.Pool) *CashRepository {
	return &CashRepository{pool: pool}
}

const cashColumns = `id, user_id, label, currency, amount, account_type, updated_at`

// ListByUser retrieves all cash balances for a user.
func (r *CashRepository) ListByUser(ctx context.Context, userID string) ([]model.CashBalance, error) {
	query := fmt.Sprintf(
		`SELECT %s FROM cash_balances WHERE user_id = $1 ORDER BY label`, cashColumns)
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("cash ListByUser query: %w", err)
	}
	balances, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.CashBalance])
	if err != nil {
		return nil, fmt.Errorf("cash ListByUser collect: %w", err)
	}
	return balances, nil
}

// Create inserts a new cash balance and returns it.
func (r *CashRepository) Create(ctx context.Context, userID string, req model.CreateCashBalanceRequest) (*model.CashBalance, error) {
	currency := "JPY"
	if req.Currency != nil {
		currency = *req.Currency
	}
	amount := 0.0
	if req.Amount != nil {
		amount = *req.Amount
	}

	query := fmt.Sprintf(`
		INSERT INTO cash_balances (user_id, label, currency, amount, account_type)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING %s`, cashColumns)

	rows, err := r.pool.Query(ctx, query, userID, req.Label, currency, amount, req.AccountType)
	if err != nil {
		return nil, fmt.Errorf("cash Create query: %w", err)
	}
	cb, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.CashBalance])
	if err != nil {
		return nil, fmt.Errorf("cash Create collect: %w", err)
	}
	return cb, nil
}

// Update updates a cash balance and returns the updated row.
func (r *CashRepository) Update(ctx context.Context, userID, cashID string, req model.UpdateCashBalanceRequest) (*model.CashBalance, error) {
	query := fmt.Sprintf(`
		UPDATE cash_balances SET
			label        = COALESCE($1, label),
			currency     = COALESCE($2, currency),
			amount       = COALESCE($3, amount),
			account_type = COALESCE($4, account_type),
			updated_at   = now()
		WHERE id = $5 AND user_id = $6
		RETURNING %s`, cashColumns)

	rows, err := r.pool.Query(ctx, query,
		req.Label, req.Currency, req.Amount, req.AccountType,
		cashID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("cash Update query: %w", err)
	}
	cb, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.CashBalance])
	if err != nil {
		return nil, fmt.Errorf("cash Update collect: %w", err)
	}
	return cb, nil
}

// Delete removes a cash balance by ID, scoped to user.
func (r *CashRepository) Delete(ctx context.Context, userID, cashID string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM cash_balances WHERE id = $1 AND user_id = $2`, cashID, userID)
	if err != nil {
		return fmt.Errorf("cash Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("cash Delete: no rows affected (id=%s)", cashID)
	}
	return nil
}
