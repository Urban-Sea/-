package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/config"
)

// AdminMiddleware checks that the authenticated user is an admin.
// Returns 404 (not 403) to avoid leaking the existence of admin endpoints.
// Assumes AuthMiddleware has already run and set "email" in context.
func AdminMiddleware(cfg *config.Config) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			email, _ := c.Get("email").(string)
			if !cfg.IsAdmin(email) {
				return errJSON(c, http.StatusNotFound, "not found")
			}
			return next(c)
		}
	}
}

// AdminMFAMiddleware extends AdminMiddleware with optional MFA verification.
// If the admin has MFA enabled, the request must include a valid X-MFA-Token header.
func AdminMFAMiddleware(cfg *config.Config, pool *pgxpool.Pool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			email, _ := c.Get("email").(string)
			if !cfg.IsAdmin(email) {
				return errJSON(c, http.StatusNotFound, "not found")
			}

			userID, _ := c.Get("user_id").(string)
			ctx := c.Request().Context()

			// Check if MFA is enabled for this admin.
			var mfaEnabled bool
			err := pool.QueryRow(ctx,
				`SELECT enabled FROM admin_mfa WHERE user_id = $1`, userID,
			).Scan(&mfaEnabled)
			if err != nil {
				// No row means MFA not configured — pass through.
				return next(c)
			}

			if !mfaEnabled {
				return next(c)
			}

			// MFA is enabled — require X-MFA-Token header.
			token := c.Request().Header.Get("X-MFA-Token")
			if token == "" {
				return errJSON(c, http.StatusForbidden, "MFA token required")
			}

			// Hash the token and check against active sessions.
			hash := sha256.Sum256([]byte(token))
			tokenHash := hex.EncodeToString(hash[:])

			var expiresAt time.Time
			err = pool.QueryRow(ctx,
				`SELECT expires_at FROM admin_mfa_sessions
				  WHERE token_hash = $1 AND expires_at >= now()`, tokenHash,
			).Scan(&expiresAt)
			if err != nil {
				return errJSON(c, http.StatusForbidden, "invalid or expired MFA token")
			}

			return next(c)
		}
	}
}
