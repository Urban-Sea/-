package model

import "time"

// User represents a row in the users table.
type User struct {
	ID               string     `json:"id"                db:"id"`
	Email            string     `json:"email"             db:"email"`
	DisplayName      *string    `json:"display_name"      db:"display_name"`
	StripeCustomerID *string    `json:"stripe_customer_id" db:"stripe_customer_id"`
	Plan             string     `json:"plan"              db:"plan"`
	AuthProvider     string     `json:"auth_provider"     db:"auth_provider"`
	AuthProviderID   *string    `json:"auth_provider_id"  db:"auth_provider_id"`
	LastLoginAt      *time.Time `json:"last_login_at"     db:"last_login_at"`
	CreatedAt        time.Time  `json:"created_at"        db:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"        db:"updated_at"`
	IsActive         bool       `json:"is_active"         db:"is_active"`
}

// UserResponse extends User with computed fields for API responses.
type UserResponse struct {
	User
	IsAdmin bool `json:"is_admin"`
}
