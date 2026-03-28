package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/open-regime/api-go/internal/model"
)

// UserRepository handles persistence for the users table.
type UserRepository struct {
	pool *pgxpool.Pool
}

// NewUserRepository creates a new UserRepository.
func NewUserRepository(pool *pgxpool.Pool) *UserRepository {
	return &UserRepository{pool: pool}
}

const userColumns = `id, email, display_name, stripe_customer_id, plan,
	auth_provider, auth_provider_id, last_login_at, created_at, updated_at, is_active`

// FindByID retrieves a user by UUID (accepted as string).
func (r *UserRepository) FindByID(ctx context.Context, userID string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM users WHERE id = $1`, userColumns)
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("user FindByID query: %w", err)
	}
	user, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.User])
	if err != nil {
		return nil, fmt.Errorf("user FindByID collect: %w", err)
	}
	return user, nil
}

// FindByEmail retrieves a user by email address.
func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM users WHERE email = $1`, userColumns)
	rows, err := r.pool.Query(ctx, query, email)
	if err != nil {
		return nil, fmt.Errorf("user FindByEmail query: %w", err)
	}
	user, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.User])
	if err != nil {
		return nil, fmt.Errorf("user FindByEmail collect: %w", err)
	}
	return user, nil
}

// FindByAuthProviderID retrieves a user by auth_provider_id.
func (r *UserRepository) FindByAuthProviderID(ctx context.Context, providerID string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM users WHERE auth_provider_id = $1`, userColumns)
	rows, err := r.pool.Query(ctx, query, providerID)
	if err != nil {
		return nil, fmt.Errorf("user FindByAuthProviderID query: %w", err)
	}
	user, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.User])
	if err != nil {
		return nil, fmt.Errorf("user FindByAuthProviderID collect: %w", err)
	}
	return user, nil
}

// Create inserts a new user and returns the created row.
func (r *UserRepository) Create(ctx context.Context, email, authProvider, authProviderID string) (*model.User, error) {
	query := fmt.Sprintf(`
		INSERT INTO users (email, auth_provider, auth_provider_id)
		VALUES ($1, $2, $3)
		RETURNING %s`, userColumns)
	rows, err := r.pool.Query(ctx, query, email, authProvider, authProviderID)
	if err != nil {
		return nil, fmt.Errorf("user Create query: %w", err)
	}
	user, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.User])
	if err != nil {
		return nil, fmt.Errorf("user Create collect: %w", err)
	}
	return user, nil
}

// UpdateDisplayName sets the display_name for a user.
func (r *UserRepository) UpdateDisplayName(ctx context.Context, userID, displayName string) error {
	query := `UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2`
	tag, err := r.pool.Exec(ctx, query, displayName, userID)
	if err != nil {
		return fmt.Errorf("user UpdateDisplayName: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("user UpdateDisplayName: no rows affected (id=%s)", userID)
	}
	return nil
}

// UpdateLastLogin sets last_login_at to now() for a user.
func (r *UserRepository) UpdateLastLogin(ctx context.Context, userID string) error {
	query := `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`
	tag, err := r.pool.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("user UpdateLastLogin: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("user UpdateLastLogin: no rows affected (id=%s)", userID)
	}
	return nil
}

// UpdateStripeCustomerID sets the stripe_customer_id for a user.
func (r *UserRepository) UpdateStripeCustomerID(ctx context.Context, userID, customerID string) error {
	query := `UPDATE users SET stripe_customer_id = $1, updated_at = now() WHERE id = $2`
	tag, err := r.pool.Exec(ctx, query, customerID, userID)
	if err != nil {
		return fmt.Errorf("user UpdateStripeCustomerID: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("user UpdateStripeCustomerID: no rows affected (id=%s)", userID)
	}
	return nil
}

// UpdatePlan sets the plan for a user.
func (r *UserRepository) UpdatePlan(ctx context.Context, userID, plan string) error {
	query := `UPDATE users SET plan = $1, updated_at = now() WHERE id = $2`
	tag, err := r.pool.Exec(ctx, query, plan, userID)
	if err != nil {
		return fmt.Errorf("user UpdatePlan: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("user UpdatePlan: no rows affected (id=%s)", userID)
	}
	return nil
}

// FindByStripeCustomerID retrieves a user by stripe_customer_id.
func (r *UserRepository) FindByStripeCustomerID(ctx context.Context, customerID string) (*model.User, error) {
	query := fmt.Sprintf(`SELECT %s FROM users WHERE stripe_customer_id = $1`, userColumns)
	rows, err := r.pool.Query(ctx, query, customerID)
	if err != nil {
		return nil, fmt.Errorf("user FindByStripeCustomerID query: %w", err)
	}
	user, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[model.User])
	if err != nil {
		return nil, fmt.Errorf("user FindByStripeCustomerID collect: %w", err)
	}
	return user, nil
}

// UpdateAuthProvider updates auth_provider and auth_provider_id for a user.
func (r *UserRepository) UpdateAuthProvider(ctx context.Context, userID, authProvider, authProviderID string) error {
	query := `UPDATE users SET auth_provider = $1, auth_provider_id = $2, updated_at = now() WHERE id = $3`
	tag, err := r.pool.Exec(ctx, query, authProvider, authProviderID, userID)
	if err != nil {
		return fmt.Errorf("user UpdateAuthProvider: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("user UpdateAuthProvider: no rows affected (id=%s)", userID)
	}
	return nil
}
