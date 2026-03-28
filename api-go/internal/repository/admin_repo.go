package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/open-regime/api-go/internal/model"
)

// AdminRepository handles persistence for admin-related tables.
type AdminRepository struct {
	pool *pgxpool.Pool
}

// NewAdminRepository creates a new AdminRepository.
func NewAdminRepository(pool *pgxpool.Pool) *AdminRepository {
	return &AdminRepository{pool: pool}
}

// ---------- Users ----------

const adminUserColumns = `id, email, display_name, plan, auth_provider, is_active, last_login_at, created_at`

// ListUsers returns all users ordered by created_at ASC.
func (r *AdminRepository) ListUsers(ctx context.Context) ([]model.AdminUserRow, error) {
	query := fmt.Sprintf(`SELECT %s FROM users ORDER BY created_at ASC`, adminUserColumns)
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("admin ListUsers query: %w", err)
	}
	users, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.AdminUserRow])
	if err != nil {
		return nil, fmt.Errorf("admin ListUsers collect: %w", err)
	}
	return users, nil
}

// GetUserForAudit returns plan, display_name, is_active for a user (used before update).
func (r *AdminRepository) GetUserForAudit(ctx context.Context, userID string) (map[string]any, error) {
	var plan string
	var displayName *string
	var isActive bool
	err := r.pool.QueryRow(ctx,
		`SELECT plan, display_name, is_active FROM users WHERE id = $1`, userID,
	).Scan(&plan, &displayName, &isActive)
	if err != nil {
		return nil, fmt.Errorf("admin GetUserForAudit: %w", err)
	}
	return map[string]any{
		"plan":         plan,
		"display_name": displayName,
		"is_active":    isActive,
	}, nil
}

// UpdateUser applies the given fields to a user.
func (r *AdminRepository) UpdateUser(ctx context.Context, userID string, fields map[string]any) error {
	// Build dynamic SET clause
	setClauses := ""
	args := []any{}
	i := 1
	for k, v := range fields {
		if i > 1 {
			setClauses += ", "
		}
		setClauses += fmt.Sprintf("%s = $%d", k, i)
		args = append(args, v)
		i++
	}
	args = append(args, userID)
	query := fmt.Sprintf(`UPDATE users SET %s, updated_at = now() WHERE id = $%d`, setClauses, i)

	tag, err := r.pool.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("admin UpdateUser: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("admin UpdateUser: no rows affected (id=%s)", userID)
	}
	return nil
}

// ---------- Stats ----------

// CountAllUsers returns total user count.
func (r *AdminRepository) CountAllUsers(ctx context.Context) (int, error) {
	var count int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

// CountActiveUsers returns users with last_login_at >= since.
func (r *AdminRepository) CountActiveUsers(ctx context.Context, since time.Time) (int, error) {
	var count int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users WHERE last_login_at >= $1`, since,
	).Scan(&count)
	return count, err
}

// CountNewUsers returns users with created_at >= since.
func (r *AdminRepository) CountNewUsers(ctx context.Context, since time.Time) (int, error) {
	var count int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users WHERE created_at >= $1`, since,
	).Scan(&count)
	return count, err
}

// DailySignups returns per-day signup counts since the given time, sorted by date.
func (r *AdminRepository) DailySignups(ctx context.Context, since time.Time) ([]model.DailySignup, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT created_at FROM users WHERE created_at >= $1 ORDER BY created_at ASC`, since,
	)
	if err != nil {
		return nil, fmt.Errorf("admin DailySignups query: %w", err)
	}
	defer rows.Close()

	dailyMap := map[string]int{}
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("admin DailySignups scan: %w", err)
		}
		day := t.Format("2006-01-02")
		dailyMap[day]++
	}

	result := make([]model.DailySignup, 0, len(dailyMap))
	for date, count := range dailyMap {
		result = append(result, model.DailySignup{Date: date, Count: count})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Date < result[j].Date })
	return result, nil
}

// ---------- Audit Logs ----------

// AuditLog inserts a fire-and-forget audit log entry.
func (r *AdminRepository) AuditLog(ctx context.Context, adminUserID, action, targetType, targetID string, oldValue, newValue any) {
	oldJSON, _ := json.Marshal(oldValue)
	newJSON, _ := json.Marshal(newValue)

	// Fire-and-forget: ignore errors.
	_, _ = r.pool.Exec(ctx,
		`INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, old_value, new_value)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		adminUserID, action, targetType, targetID, oldJSON, newJSON,
	)
}

// ListAuditLogs returns the most recent audit logs with limit.
func (r *AdminRepository) ListAuditLogs(ctx context.Context, limit int) ([]model.AuditLog, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, admin_user_id, action, target_type, target_id, old_value, new_value, created_at
		 FROM admin_audit_logs ORDER BY created_at DESC LIMIT $1`, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("admin ListAuditLogs query: %w", err)
	}
	logs, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.AuditLog])
	if err != nil {
		return nil, fmt.Errorf("admin ListAuditLogs collect: %w", err)
	}
	return logs, nil
}

// GetEmailsByIDs returns a map of user_id -> email for the given IDs.
func (r *AdminRepository) GetEmailsByIDs(ctx context.Context, ids []string) (map[string]string, error) {
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, email FROM users WHERE id = ANY($1)`, ids,
	)
	if err != nil {
		return nil, fmt.Errorf("admin GetEmailsByIDs query: %w", err)
	}
	defer rows.Close()

	m := make(map[string]string, len(ids))
	for rows.Next() {
		var id, email string
		if err := rows.Scan(&id, &email); err != nil {
			return nil, fmt.Errorf("admin GetEmailsByIDs scan: %w", err)
		}
		m[id] = email
	}
	return m, nil
}

// ---------- Batch Logs ----------

// ListBatchLogs returns the most recent batch logs with limit.
func (r *AdminRepository) ListBatchLogs(ctx context.Context, limit int) ([]model.BatchLog, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, job_type, status, started_at, finished_at, duration_seconds,
		        records_processed, error_message, details
		 FROM batch_logs ORDER BY started_at DESC LIMIT $1`, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("admin ListBatchLogs query: %w", err)
	}
	logs, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.BatchLog])
	if err != nil {
		return nil, fmt.Errorf("admin ListBatchLogs collect: %w", err)
	}
	return logs, nil
}

// ---------- Feature Flags ----------

// ListFeatureFlags returns all feature flags ordered by created_at ASC.
func (r *AdminRepository) ListFeatureFlags(ctx context.Context) ([]model.FeatureFlag, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, flag_key, description, enabled, created_at, updated_at
		 FROM feature_flags ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, fmt.Errorf("admin ListFeatureFlags query: %w", err)
	}
	flags, err := pgx.CollectRows(rows, pgx.RowToStructByName[model.FeatureFlag])
	if err != nil {
		return nil, fmt.Errorf("admin ListFeatureFlags collect: %w", err)
	}
	return flags, nil
}

// CreateFeatureFlag inserts a new feature flag and returns it.
func (r *AdminRepository) CreateFeatureFlag(ctx context.Context, flagKey, description string) (*model.FeatureFlag, error) {
	var desc *string
	if description != "" {
		desc = &description
	}
	rows, err := r.pool.Query(ctx,
		`INSERT INTO feature_flags (flag_key, description, enabled)
		 VALUES ($1, $2, false)
		 RETURNING id, flag_key, description, enabled, created_at, updated_at`,
		flagKey, desc,
	)
	if err != nil {
		return nil, fmt.Errorf("admin CreateFeatureFlag query: %w", err)
	}
	flag, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.FeatureFlag])
	if err != nil {
		return nil, fmt.Errorf("admin CreateFeatureFlag collect: %w", err)
	}
	return flag, nil
}

// GetFeatureFlagByID returns flag_key and enabled for audit logging.
func (r *AdminRepository) GetFeatureFlagByID(ctx context.Context, id int64) (string, bool, error) {
	var flagKey string
	var enabled bool
	err := r.pool.QueryRow(ctx,
		`SELECT flag_key, enabled FROM feature_flags WHERE id = $1`, id,
	).Scan(&flagKey, &enabled)
	if err != nil {
		return "", false, err
	}
	return flagKey, enabled, nil
}

// UpdateFeatureFlagEnabled sets the enabled field and updated_at for a flag.
func (r *AdminRepository) UpdateFeatureFlagEnabled(ctx context.Context, id int64, enabled bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE feature_flags SET enabled = $1, updated_at = now() WHERE id = $2`,
		enabled, id,
	)
	if err != nil {
		return fmt.Errorf("admin UpdateFeatureFlagEnabled: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("admin UpdateFeatureFlagEnabled: no rows affected (id=%d)", id)
	}
	return nil
}
