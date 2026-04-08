package model

import (
	"encoding/json"
	"time"
)

// AdminUserRow represents a user row for admin listing (subset of columns).
type AdminUserRow struct {
	ID           string     `json:"id"            db:"id"`
	Email        string     `json:"email"         db:"email"`
	DisplayName  *string    `json:"display_name"  db:"display_name"`
	Plan         string     `json:"plan"          db:"plan"`
	AuthProvider string     `json:"auth_provider" db:"auth_provider"`
	IsActive     bool       `json:"is_active"     db:"is_active"`
	LastLoginAt  *time.Time `json:"last_login_at" db:"last_login_at"`
	CreatedAt    time.Time  `json:"created_at"    db:"created_at"`
}

// AuditLog represents a row in admin_audit_logs.
type AuditLog struct {
	ID          int64           `json:"id"            db:"id"`
	AdminUserID string          `json:"admin_user_id" db:"admin_user_id"`
	Action      string          `json:"action"        db:"action"`
	TargetType  string          `json:"target_type"   db:"target_type"`
	TargetID    string          `json:"target_id"     db:"target_id"`
	OldValue    json.RawMessage `json:"old_value"     db:"old_value"`
	NewValue    json.RawMessage `json:"new_value"     db:"new_value"`
	CreatedAt   time.Time       `json:"created_at"    db:"created_at"`
}

// AuditLogWithEmail extends AuditLog with the admin's email.
type AuditLogWithEmail struct {
	AuditLog
	AdminEmail string `json:"admin_email"`
}

// BatchLog represents a row in batch_logs.
type BatchLog struct {
	ID               int64      `json:"id"                db:"id"`
	JobType          string     `json:"job_type"          db:"job_type"`
	Status           string     `json:"status"            db:"status"`
	StartedAt        *time.Time `json:"started_at"        db:"started_at"`
	FinishedAt       *time.Time `json:"finished_at"       db:"finished_at"`
	DurationSeconds  *float64   `json:"duration_seconds"  db:"duration_seconds"`
	RecordsProcessed *int       `json:"records_processed" db:"records_processed"`
	ErrorMessage     *string    `json:"error_message"     db:"error_message"`
	Details          []byte     `json:"details"           db:"details"`
}

// FeatureFlag represents a row in feature_flags.
type FeatureFlag struct {
	ID          int64     `json:"id"          db:"id"`
	FlagKey     string    `json:"flag_key"    db:"flag_key"`
	Description *string   `json:"description" db:"description"`
	Enabled     bool      `json:"enabled"     db:"enabled"`
	CreatedAt   time.Time `json:"created_at"  db:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"  db:"updated_at"`
}

// DailySignup holds a date string and count for stats.
type DailySignup struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// AdminStats holds the aggregated admin dashboard statistics.
type AdminStats struct {
	TotalUsers   int           `json:"total_users"`
	Active7D     int           `json:"active_7d"`
	Active30D    int           `json:"active_30d"`
	NewThisMonth int           `json:"new_this_month"`
	DailySignups []DailySignup `json:"daily_signups"`
}
