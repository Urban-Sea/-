package repository

import (
	"context"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// StockRepository handles persistence for the stock_master table.
type StockRepository struct {
	pool *pgxpool.Pool
}

// NewStockRepository creates a new StockRepository.
func NewStockRepository(pool *pgxpool.Pool) *StockRepository {
	return &StockRepository{pool: pool}
}

const stockColumns = `ticker, name, sector, industry, price_category, watchlist_category,
	market_cap, exchange, is_active, added_at, updated_at`

// StockListFilter holds optional filters for listing stocks.
type StockListFilter struct {
	Category          *string
	WatchlistCategory *string
	ActiveOnly        bool
}

// List retrieves stocks with optional filters, ordered by ticker.
func (r *StockRepository) List(ctx context.Context, f StockListFilter) ([]model.Stock, error) {
	query := fmt.Sprintf(`SELECT %s FROM stock_master WHERE 1=1`, stockColumns)
	args := []any{}
	argIdx := 1

	if f.ActiveOnly {
		query += fmt.Sprintf(` AND is_active = $%d`, argIdx)
		args = append(args, true)
		argIdx++
	}

	if f.Category != nil {
		query += fmt.Sprintf(` AND price_category = $%d`, argIdx)
		args = append(args, *f.Category)
		argIdx++
	}

	if f.WatchlistCategory != nil {
		query += fmt.Sprintf(` AND watchlist_category = $%d`, argIdx)
		args = append(args, *f.WatchlistCategory)
		argIdx++
	}

	query += ` ORDER BY ticker`

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("stock List query: %w", err)
	}
	stocks, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.Stock])
	if err != nil {
		return nil, fmt.Errorf("stock List collect: %w", err)
	}
	return stocks, nil
}

// FindByTicker retrieves a single stock by its ticker (case-insensitive).
func (r *StockRepository) FindByTicker(ctx context.Context, ticker string) (*model.Stock, error) {
	query := fmt.Sprintf(`SELECT %s FROM stock_master WHERE ticker = $1`, stockColumns)
	rows, err := r.pool.Query(ctx, query, ticker)
	if err != nil {
		return nil, fmt.Errorf("stock FindByTicker query: %w", err)
	}
	stock, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.Stock])
	if err != nil {
		return nil, fmt.Errorf("stock FindByTicker collect: %w", err)
	}
	return stock, nil
}

// GetCategories retrieves distinct price_category and watchlist_category values.
func (r *StockRepository) GetCategories(ctx context.Context) (*model.CategoriesResponse, error) {
	query := `SELECT price_category, watchlist_category FROM stock_master`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("stock GetCategories query: %w", err)
	}
	defer rows.Close()

	priceSet := map[string]struct{}{}
	watchlistSet := map[string]struct{}{}

	for rows.Next() {
		var priceCategory, watchlistCategory *string
		if err := rows.Scan(&priceCategory, &watchlistCategory); err != nil {
			return nil, fmt.Errorf("stock GetCategories scan: %w", err)
		}
		if priceCategory != nil && *priceCategory != "" {
			priceSet[*priceCategory] = struct{}{}
		}
		if watchlistCategory != nil && *watchlistCategory != "" {
			watchlistSet[*watchlistCategory] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stock GetCategories rows: %w", err)
	}

	priceCategories := make([]string, 0, len(priceSet))
	for k := range priceSet {
		priceCategories = append(priceCategories, k)
	}
	sort.Strings(priceCategories)

	watchlistCategories := make([]string, 0, len(watchlistSet))
	for k := range watchlistSet {
		watchlistCategories = append(watchlistCategories, k)
	}
	sort.Strings(watchlistCategories)

	return &model.CategoriesResponse{
		PriceCategories:     priceCategories,
		WatchlistCategories: watchlistCategories,
	}, nil
}
