package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// EmploymentRepository handles persistence for employment-related tables.
type EmploymentRepository struct {
	pool *pgxpool.Pool
}

// NewEmploymentRepository creates a new EmploymentRepository.
func NewEmploymentRepository(pool *pgxpool.Pool) *EmploymentRepository {
	return &EmploymentRepository{pool: pool}
}

const indicatorColumns = `id, indicator, reference_period, current_value, revision_count,
	nfp_change, u3_rate, u6_rate, avg_hourly_earnings, wage_mom,
	labor_force_participation, notes, created_at, updated_at`

const claimsColumns = `week_ending, initial_claims, continued_claims,
	initial_claims_4w_avg, created_at, updated_at`

const revisionColumns = `id, indicator_id, revision_number, value, published_date,
	change_from_prev, change_pct_from_prev, notes, created_at`

// LatestNFP returns the latest NFP economic indicator.
func (r *EmploymentRepository) LatestNFP(ctx context.Context) (*model.EconomicIndicator, error) {
	query := fmt.Sprintf(`SELECT %s FROM economic_indicators
		WHERE indicator = 'NFP' ORDER BY reference_period DESC LIMIT 1`, indicatorColumns)
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("LatestNFP query: %w", err)
	}
	ind, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.EconomicIndicator])
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("LatestNFP collect: %w", err)
	}
	return ind, nil
}

// LatestWeeklyClaims returns the latest weekly claims row.
func (r *EmploymentRepository) LatestWeeklyClaims(ctx context.Context) (*model.WeeklyClaims, error) {
	query := fmt.Sprintf(`SELECT %s FROM weekly_claims
		ORDER BY week_ending DESC LIMIT 1`, claimsColumns)
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("LatestWeeklyClaims query: %w", err)
	}
	c, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.WeeklyClaims])
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("LatestWeeklyClaims collect: %w", err)
	}
	return c, nil
}

// ListIndicators returns economic indicators with optional filter.
func (r *EmploymentRepository) ListIndicators(ctx context.Context, indicator string, limit int) ([]model.EconomicIndicator, error) {
	query := fmt.Sprintf(`SELECT %s FROM economic_indicators`, indicatorColumns)
	args := []any{}
	argIdx := 1

	if indicator != "" {
		query += fmt.Sprintf(` WHERE indicator = $%d`, argIdx)
		args = append(args, indicator)
		argIdx++
	}

	query += ` ORDER BY reference_period DESC`
	query += fmt.Sprintf(` LIMIT $%d`, argIdx)
	args = append(args, limit)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("ListIndicators query: %w", err)
	}
	result, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.EconomicIndicator])
	if err != nil {
		return nil, fmt.Errorf("ListIndicators collect: %w", err)
	}
	return result, nil
}

// ListWeeklyClaims returns weekly claims ordered by week_ending DESC.
func (r *EmploymentRepository) ListWeeklyClaims(ctx context.Context, limit int) ([]model.WeeklyClaims, error) {
	query := fmt.Sprintf(`SELECT %s FROM weekly_claims
		ORDER BY week_ending DESC LIMIT $1`, claimsColumns)
	rows, err := r.pool.Query(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("ListWeeklyClaims query: %w", err)
	}
	result, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.WeeklyClaims])
	if err != nil {
		return nil, fmt.Errorf("ListWeeklyClaims collect: %w", err)
	}
	return result, nil
}

// ListRevisions returns revisions for a given indicator ID.
func (r *EmploymentRepository) ListRevisions(ctx context.Context, indicatorID int) ([]model.EconomicIndicatorRevision, error) {
	query := fmt.Sprintf(`SELECT %s FROM economic_indicator_revisions
		WHERE indicator_id = $1 ORDER BY revision_number`, revisionColumns)
	rows, err := r.pool.Query(ctx, query, indicatorID)
	if err != nil {
		return nil, fmt.Errorf("ListRevisions query: %w", err)
	}
	result, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.EconomicIndicatorRevision])
	if err != nil {
		return nil, fmt.Errorf("ListRevisions collect: %w", err)
	}
	return result, nil
}

// FindExistingIndicator checks if an indicator exists for the given indicator+reference_period.
func (r *EmploymentRepository) FindExistingIndicator(ctx context.Context, indicator, referencePeriod string) (*model.EconomicIndicator, error) {
	query := `SELECT id, current_value, revision_count FROM economic_indicators
		WHERE indicator = $1 AND reference_period = $2 LIMIT 1`
	row := r.pool.QueryRow(ctx, query, indicator, referencePeriod)

	var ind model.EconomicIndicator
	err := row.Scan(&ind.ID, &ind.CurrentValue, &ind.RevisionCount)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("FindExistingIndicator scan: %w", err)
	}
	return &ind, nil
}

// InsertIndicator inserts a new economic indicator and returns its ID.
func (r *EmploymentRepository) InsertIndicator(ctx context.Context, input model.IndicatorInput) (int, error) {
	query := `INSERT INTO economic_indicators
		(indicator, reference_period, current_value, revision_count,
		 nfp_change, u3_rate, u6_rate, avg_hourly_earnings, wage_mom,
		 labor_force_participation, notes)
		VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id`
	var id int
	err := r.pool.QueryRow(ctx, query,
		input.Indicator, input.ReferencePeriod, input.CurrentValue,
		input.NFPChange, input.U3Rate, input.U6Rate,
		input.AvgHourlyEarnings, input.WageMoM,
		input.LaborForceParticipation, input.Notes,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("InsertIndicator: %w", err)
	}
	return id, nil
}

// UpdateIndicator updates an existing economic indicator by ID.
func (r *EmploymentRepository) UpdateIndicator(ctx context.Context, id int, input model.IndicatorInput, revisionCount int) error {
	query := `UPDATE economic_indicators SET
		current_value = $1, nfp_change = $2, u3_rate = $3, u6_rate = $4,
		avg_hourly_earnings = $5, wage_mom = $6, labor_force_participation = $7,
		notes = $8, revision_count = $9, updated_at = $10
		WHERE id = $11`
	_, err := r.pool.Exec(ctx, query,
		input.CurrentValue, input.NFPChange, input.U3Rate, input.U6Rate,
		input.AvgHourlyEarnings, input.WageMoM, input.LaborForceParticipation,
		input.Notes, revisionCount, time.Now(),
		id,
	)
	if err != nil {
		return fmt.Errorf("UpdateIndicator: %w", err)
	}
	return nil
}

// InsertRevision inserts a new revision record.
func (r *EmploymentRepository) InsertRevision(ctx context.Context, indicatorID, revisionNumber int, value *float64, changeFromPrev, changePctPrev *float64, notes *string) error {
	query := `INSERT INTO economic_indicator_revisions
		(indicator_id, revision_number, value, published_date, change_from_prev, change_pct_from_prev, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`
	publishedDate := time.Now().Format("2006-01-02")
	_, err := r.pool.Exec(ctx, query,
		indicatorID, revisionNumber, value, publishedDate,
		changeFromPrev, changePctPrev, notes,
	)
	if err != nil {
		return fmt.Errorf("InsertRevision: %w", err)
	}
	return nil
}

// --- Risk score data fetching ---

// ListNFPRows returns NFP indicators ordered by reference_period DESC.
func (r *EmploymentRepository) ListNFPRows(ctx context.Context, limit int) ([]map[string]any, error) {
	query := `SELECT * FROM economic_indicators
		WHERE indicator = 'NFP' ORDER BY reference_period DESC LIMIT $1`
	return r.queryToMaps(ctx, query, limit)
}

// ListClaimsRows returns weekly claims ordered by week_ending DESC.
func (r *EmploymentRepository) ListClaimsRows(ctx context.Context, limit int) ([]map[string]any, error) {
	query := `SELECT * FROM weekly_claims ORDER BY week_ending DESC LIMIT $1`
	return r.queryToMaps(ctx, query, limit)
}

// ListIndicatorsByNames returns indicators matching given names, ordered by reference_period DESC.
func (r *EmploymentRepository) ListIndicatorsByNames(ctx context.Context, names []string, limit int) ([]map[string]any, error) {
	query := `SELECT * FROM economic_indicators
		WHERE indicator = ANY($1) ORDER BY reference_period DESC LIMIT $2`
	return r.queryToMaps(ctx, query, names, limit)
}

// ListMarketIndicators returns market indicators for K-shape proxy.
func (r *EmploymentRepository) ListMarketIndicators(ctx context.Context, limit int) ([]map[string]any, error) {
	query := `SELECT date, sp500, russell2000 FROM market_indicators
		ORDER BY date DESC LIMIT $1`
	return r.queryToMaps(ctx, query, limit)
}

// ListManualInputs returns manual inputs for specified metrics.
func (r *EmploymentRepository) ListManualInputs(ctx context.Context, metrics []string, limit int) ([]map[string]any, error) {
	query := `SELECT metric, reference_date, value FROM manual_inputs
		WHERE metric = ANY($1) ORDER BY reference_date DESC LIMIT $2`
	return r.queryToMaps(ctx, query, metrics, limit)
}

// --- Risk history data fetching ---

// ListNFPRowsForHistory returns NFP rows for risk history.
func (r *EmploymentRepository) ListNFPRowsForHistory(ctx context.Context, limit int) ([]map[string]any, error) {
	query := `SELECT * FROM economic_indicators
		WHERE indicator = 'NFP' ORDER BY reference_period DESC LIMIT $1`
	return r.queryToMaps(ctx, query, limit)
}

// ListClaimsRowsSince returns weekly claims since start date.
// Limit 10000 = 約 192 年分の週次データに相当 (実 DB は 1422 行)
func (r *EmploymentRepository) ListClaimsRowsSince(ctx context.Context, startDate string) ([]map[string]any, error) {
	query := `SELECT week_ending, initial_claims, initial_claims_4w_avg FROM weekly_claims
		WHERE week_ending >= $1 ORDER BY week_ending ASC LIMIT 10000`
	return r.queryToMaps(ctx, query, startDate)
}

// ListConsumerIndicatorsSince returns consumer/structure indicators since start date.
// Limit 10000 = 5 指標 × 月次で約 166 年分に相当 (実 DB は ~1700 行)
func (r *EmploymentRepository) ListConsumerIndicatorsSince(ctx context.Context, startDate string) ([]map[string]any, error) {
	query := `SELECT indicator, reference_period, current_value FROM economic_indicators
		WHERE indicator = ANY($1) AND reference_period >= $2
		ORDER BY reference_period ASC LIMIT 10000`
	names := []string{"W875RX1", "UMCSENT", "DRCCLACBS", "UNEMPLOY", "JOLTS"}
	return r.queryToMaps(ctx, query, names, startDate)
}

// ListMarketIndicatorsSince returns market indicators since start date (paginated).
func (r *EmploymentRepository) ListMarketIndicatorsSince(ctx context.Context, startDate string) ([]map[string]any, error) {
	query := `SELECT date, sp500, russell2000 FROM market_indicators
		WHERE date >= $1 ORDER BY date ASC`
	return r.queryToMaps(ctx, query, startDate)
}

// queryToMaps executes a query and returns results as []map[string]any.
func (r *EmploymentRepository) queryToMaps(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	descs := rows.FieldDescriptions()
	var result []map[string]any

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]any, len(descs))
		for i, fd := range descs {
			m[string(fd.Name)] = values[i]
		}
		result = append(result, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
