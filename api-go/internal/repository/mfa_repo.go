package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MFARecord represents a row in the admin_mfa table.
type MFARecord struct {
	ID        int       `db:"id"`
	UserID    string    `db:"user_id"`
	SecretEnc string    `db:"secret_enc"`
	Enabled   bool      `db:"enabled"`
	CreatedAt time.Time `db:"created_at"`
	UpdatedAt time.Time `db:"updated_at"`
}

// MFASession represents a row in the admin_mfa_sessions table.
type MFASession struct {
	ID        int       `db:"id"`
	UserID    string    `db:"user_id"`
	TokenHash string    `db:"token_hash"`
	ExpiresAt time.Time `db:"expires_at"`
	CreatedAt time.Time `db:"created_at"`
}

// MFARepository handles persistence for admin_mfa and admin_mfa_sessions.
type MFARepository struct {
	pool *pgxpool.Pool
}

// NewMFARepository creates a new MFARepository.
func NewMFARepository(pool *pgxpool.Pool) *MFARepository {
	return &MFARepository{pool: pool}
}

// FindMFAByUserID retrieves the MFA record for a user. Returns nil if not found.
func (r *MFARepository) FindMFAByUserID(ctx context.Context, userID string) (*MFARecord, error) {
	query := `SELECT id, user_id, secret_enc, enabled, created_at, updated_at
	          FROM admin_mfa WHERE user_id = $1 LIMIT 1`
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("mfa FindByUserID query: %w", err)
	}
	rec, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[MFARecord])
	if err != nil {
		return nil, err
	}
	return rec, nil
}

// InsertMFA creates a new MFA record.
func (r *MFARepository) InsertMFA(ctx context.Context, userID, secretEnc string) error {
	query := `INSERT INTO admin_mfa (user_id, secret_enc, enabled) VALUES ($1, $2, false)`
	_, err := r.pool.Exec(ctx, query, userID, secretEnc)
	if err != nil {
		return fmt.Errorf("mfa InsertMFA: %w", err)
	}
	return nil
}

// EnableMFA sets enabled=true for the user's MFA record.
func (r *MFARepository) EnableMFA(ctx context.Context, userID string) error {
	query := `UPDATE admin_mfa SET enabled = true, updated_at = now() WHERE user_id = $1`
	tag, err := r.pool.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("mfa EnableMFA: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("mfa EnableMFA: no rows affected (user_id=%s)", userID)
	}
	return nil
}

// InsertSession creates a new MFA session and returns the expiry time.
func (r *MFARepository) InsertSession(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	query := `INSERT INTO admin_mfa_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`
	_, err := r.pool.Exec(ctx, query, userID, tokenHash, expiresAt)
	if err != nil {
		return fmt.Errorf("mfa InsertSession: %w", err)
	}
	return nil
}

// FindValidSession looks up a non-expired session by user_id and token_hash.
func (r *MFARepository) FindValidSession(ctx context.Context, userID, tokenHash string) (*MFASession, error) {
	query := `SELECT id, user_id, token_hash, expires_at, created_at
	          FROM admin_mfa_sessions
	          WHERE user_id = $1 AND token_hash = $2 AND expires_at >= now()
	          LIMIT 1`
	rows, err := r.pool.Query(ctx, query, userID, tokenHash)
	if err != nil {
		return nil, fmt.Errorf("mfa FindValidSession query: %w", err)
	}
	sess, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[MFASession])
	if err != nil {
		return nil, err
	}
	return sess, nil
}

// DeleteSession removes a session by user_id and token_hash.
func (r *MFARepository) DeleteSession(ctx context.Context, userID, tokenHash string) error {
	query := `DELETE FROM admin_mfa_sessions WHERE user_id = $1 AND token_hash = $2`
	_, err := r.pool.Exec(ctx, query, userID, tokenHash)
	if err != nil {
		return fmt.Errorf("mfa DeleteSession: %w", err)
	}
	return nil
}

// GetUserEmail retrieves email from the users table.
func (r *MFARepository) GetUserEmail(ctx context.Context, userID string) (string, error) {
	var email string
	err := r.pool.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email)
	if err != nil {
		return "admin", nil
	}
	return email, nil
}
