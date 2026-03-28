package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// LiquidityRepository handles all liquidity-related table queries.
type LiquidityRepository struct {
	pool *pgxpool.Pool
}

// NewLiquidityRepository creates a new LiquidityRepository.
func NewLiquidityRepository(pool *pgxpool.Pool) *LiquidityRepository {
	return &LiquidityRepository{pool: pool}
}

// ============================================================
// CRUD: fed_balance_sheet
// ============================================================

// ListFedBalanceSheet returns rows from fed_balance_sheet ordered by date DESC.
func (r *LiquidityRepository) ListFedBalanceSheet(ctx context.Context, limit int) ([]model.FedBalanceSheet, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, reserves, rrp, tga, soma_assets FROM fed_balance_sheet ORDER BY date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listFedBalanceSheet: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.FedBalanceSheet])
}

// ListFedBalanceSheetAsc returns all rows ascending (for net liquidity history).
func (r *LiquidityRepository) ListFedBalanceSheetAsc(ctx context.Context) ([]model.FedBalanceSheet, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, reserves, rrp, tga, soma_assets FROM fed_balance_sheet ORDER BY date ASC`)
	if err != nil {
		return nil, fmt.Errorf("listFedBalanceSheetAsc: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.FedBalanceSheet])
}

// ListFedBalanceSheetAscLimit returns rows ascending with a limit.
func (r *LiquidityRepository) ListFedBalanceSheetAscLimit(ctx context.Context, limit int) ([]model.FedBalanceSheet, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, reserves, rrp, tga, soma_assets FROM fed_balance_sheet ORDER BY date ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listFedBalanceSheetAscLimit: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.FedBalanceSheet])
}

// ListFedBalanceSheetRange returns rows in a date range, ascending.
func (r *LiquidityRepository) ListFedBalanceSheetRange(ctx context.Context, startDate, endDate string, limit int) ([]model.FedBalanceSheet, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, reserves, rrp, tga, soma_assets FROM fed_balance_sheet
		 WHERE date >= $1 AND date <= $2 ORDER BY date ASC LIMIT $3`, startDate, endDate, limit)
	if err != nil {
		return nil, fmt.Errorf("listFedBalanceSheetRange: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.FedBalanceSheet])
}

// ============================================================
// CRUD: interest_rates
// ============================================================

// ListInterestRates returns rows from interest_rates ordered by date DESC.
func (r *LiquidityRepository) ListInterestRates(ctx context.Context, limit int) ([]model.InterestRates, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, fed_funds, treasury_2y, treasury_10y, treasury_spread FROM interest_rates ORDER BY date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listInterestRates: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.InterestRates])
}

// ListInterestRatesRange returns rows in a date range, ascending.
func (r *LiquidityRepository) ListInterestRatesRange(ctx context.Context, startDate, endDate string, limit int) ([]model.InterestRates, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, fed_funds, treasury_2y, treasury_10y, treasury_spread FROM interest_rates
		 WHERE date >= $1 AND date <= $2 ORDER BY date ASC LIMIT $3`, startDate, endDate, limit)
	if err != nil {
		return nil, fmt.Errorf("listInterestRatesRange: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.InterestRates])
}

// ============================================================
// CRUD: credit_spreads
// ============================================================

// ListCreditSpreads returns rows from credit_spreads ordered by date DESC.
func (r *LiquidityRepository) ListCreditSpreads(ctx context.Context, limit int) ([]model.CreditSpreads, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, hy_spread, ig_spread, ted_spread FROM credit_spreads ORDER BY date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listCreditSpreads: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.CreditSpreads])
}

// ListCreditSpreadsRange returns rows in a date range, ascending.
func (r *LiquidityRepository) ListCreditSpreadsRange(ctx context.Context, startDate, endDate string, limit int) ([]model.CreditSpreads, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, hy_spread, ig_spread, ted_spread FROM credit_spreads
		 WHERE date >= $1 AND date <= $2 ORDER BY date ASC LIMIT $3`, startDate, endDate, limit)
	if err != nil {
		return nil, fmt.Errorf("listCreditSpreadsRange: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.CreditSpreads])
}

// ============================================================
// CRUD: market_indicators
// ============================================================

// ListMarketIndicators returns rows from market_indicators ordered by date DESC.
func (r *LiquidityRepository) ListMarketIndicators(ctx context.Context, limit int) ([]model.MarketIndicators, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, vix, dxy, sp500, nasdaq, russell2000, usdjpy FROM market_indicators ORDER BY date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listMarketIndicators: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.MarketIndicators])
}

// ListMarketIndicatorsRange returns rows in a date range, ascending.
func (r *LiquidityRepository) ListMarketIndicatorsRange(ctx context.Context, startDate, endDate string, limit int) ([]model.MarketIndicators, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, vix, dxy, sp500, nasdaq, russell2000, usdjpy FROM market_indicators
		 WHERE date >= $1 AND date <= $2 ORDER BY date ASC LIMIT $3`, startDate, endDate, limit)
	if err != nil {
		return nil, fmt.Errorf("listMarketIndicatorsRange: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.MarketIndicators])
}

// ============================================================
// margin_debt
// ============================================================

// ListMarginDebt returns rows from margin_debt ordered by date DESC.
func (r *LiquidityRepository) ListMarginDebt(ctx context.Context, limit int) ([]model.MarginDebt, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, debit_balance, free_credit, change_2y FROM margin_debt ORDER BY date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listMarginDebt: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.MarginDebt])
}

// ListMarginDebtAsc returns all rows ascending.
func (r *LiquidityRepository) ListMarginDebtAsc(ctx context.Context, limit int) ([]model.MarginDebt, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, debit_balance, free_credit, change_2y FROM margin_debt ORDER BY date ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listMarginDebtAsc: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.MarginDebt])
}

// ListMarginDebtRange returns rows in a date range, ascending.
func (r *LiquidityRepository) ListMarginDebtRange(ctx context.Context, startDate, endDate string, limit int) ([]model.MarginDebt, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, debit_balance, free_credit, change_2y FROM margin_debt
		 WHERE date >= $1 AND date <= $2 ORDER BY date ASC LIMIT $3`, startDate, endDate, limit)
	if err != nil {
		return nil, fmt.Errorf("listMarginDebtRange: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.MarginDebt])
}

// GetMarginDebtBefore returns the latest margin_debt row on or before the given date.
func (r *LiquidityRepository) GetMarginDebtBefore(ctx context.Context, date string) (*model.MarginDebt, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, debit_balance, free_credit, change_2y FROM margin_debt WHERE date <= $1 ORDER BY date DESC LIMIT 1`, date)
	if err != nil {
		return nil, fmt.Errorf("getMarginDebtBefore: %w", err)
	}
	md, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.MarginDebt])
	if err != nil {
		return nil, err
	}
	return md, nil
}

// UpsertMarginDebt inserts or updates a margin_debt row.
func (r *LiquidityRepository) UpsertMarginDebt(ctx context.Context, date string, debitBalance float64, freeCredit *float64, change2y *float64) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO margin_debt (date, debit_balance, free_credit, change_2y, updated_at)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (date) DO UPDATE SET
			debit_balance = EXCLUDED.debit_balance,
			free_credit = EXCLUDED.free_credit,
			change_2y = EXCLUDED.change_2y,
			updated_at = EXCLUDED.updated_at`,
		date, debitBalance, freeCredit, change2y, time.Now())
	if err != nil {
		return fmt.Errorf("upsertMarginDebt: %w", err)
	}
	return nil
}

// ============================================================
// mmf_assets
// ============================================================

// ListMMFAssetsDesc returns latest rows from mmf_assets ordered by date DESC.
func (r *LiquidityRepository) ListMMFAssetsDesc(ctx context.Context, limit int) ([]model.MMFAssets, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, total_assets, change_3m FROM mmf_assets ORDER BY date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listMMFAssetsDesc: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.MMFAssets])
}

// ListMMFAssetsAsc returns rows ascending.
func (r *LiquidityRepository) ListMMFAssetsAsc(ctx context.Context, limit int) ([]model.MMFAssets, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, total_assets, change_3m FROM mmf_assets ORDER BY date ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listMMFAssetsAsc: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.MMFAssets])
}

// ============================================================
// bank_sector
// ============================================================

// ListBankSectorDesc returns latest rows from bank_sector ordered by date DESC.
func (r *LiquidityRepository) ListBankSectorDesc(ctx context.Context, limit int) ([]model.BankSector, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, kre_close, kre_52w_high, kre_52w_low, kre_52w_change FROM bank_sector ORDER BY date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listBankSectorDesc: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.BankSector])
}

// ListBankSectorAsc returns rows ascending.
func (r *LiquidityRepository) ListBankSectorAsc(ctx context.Context, limit int) ([]model.BankSector, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, kre_close, kre_52w_high, kre_52w_low, kre_52w_change FROM bank_sector ORDER BY date ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listBankSectorAsc: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.BankSector])
}

// ListBankSectorRange returns rows in a date range, ascending.
func (r *LiquidityRepository) ListBankSectorRange(ctx context.Context, startDate, endDate string, limit int) ([]model.BankSector, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, kre_close, kre_52w_high, kre_52w_low, kre_52w_change FROM bank_sector
		 WHERE date >= $1 AND date <= $2 ORDER BY date ASC LIMIT $3`, startDate, endDate, limit)
	if err != nil {
		return nil, fmt.Errorf("listBankSectorRange: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.BankSector])
}

// ============================================================
// srf_usage
// ============================================================

// ListSRFUsageDesc returns latest rows from srf_usage ordered by date DESC.
func (r *LiquidityRepository) ListSRFUsageDesc(ctx context.Context, limit int) ([]model.SRFUsage, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, amount, source FROM srf_usage ORDER BY date DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listSRFUsageDesc: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.SRFUsage])
}

// ListSRFUsageAsc returns all rows ascending.
func (r *LiquidityRepository) ListSRFUsageAsc(ctx context.Context, limit int) ([]model.SRFUsage, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date, amount, source FROM srf_usage ORDER BY date ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("listSRFUsageAsc: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.SRFUsage])
}

// ============================================================
// layer_stress_history
// ============================================================

// ListLayerStressRange returns layer_stress_history rows in a date range, ascending.
func (r *LiquidityRepository) ListLayerStressRange(ctx context.Context, startDate, endDate string, limit int) ([]model.LayerStressHistory, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, date, layer, stress_score, components FROM layer_stress_history
		 WHERE date >= $1 AND date <= $2 ORDER BY date ASC LIMIT $3`, startDate, endDate, limit)
	if err != nil {
		return nil, fmt.Errorf("listLayerStressRange: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[model.LayerStressHistory])
}

// ============================================================
// economic_indicators (CPI for policy regime)
// ============================================================

// GetLatestCPI returns the latest CPI_YOY value.
func (r *LiquidityRepository) GetLatestCPI(ctx context.Context) (*float64, error) {
	var val *float64
	err := r.pool.QueryRow(ctx,
		`SELECT current_value FROM economic_indicators WHERE indicator = 'CPI_YOY' ORDER BY reference_period DESC LIMIT 1`).Scan(&val)
	if err != nil {
		return nil, err
	}
	return val, nil
}
