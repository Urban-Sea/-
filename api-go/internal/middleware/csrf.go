package middleware

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// CSRFProtection rejects state-changing requests (POST/PUT/PATCH/DELETE)
// that lack the X-Requested-With header. Browsers enforce CORS preflight
// for custom headers, so cross-origin forms/scripts cannot set this header
// without the server explicitly allowing the origin — which we restrict
// in CORSMiddleware. This is the "custom header" CSRF defence pattern.
//
// Safe methods (GET, HEAD, OPTIONS) are always allowed.
// Stripe webhook (/api/billing/webhook) is excluded because Stripe
// cannot send custom headers.
func CSRFProtection() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			method := c.Request().Method
			if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
				return next(c)
			}

			// Stripe webhook sends its own signature — cannot add custom headers
			if c.Path() == "/api/billing/webhook" {
				return next(c)
			}

			if c.Request().Header.Get("X-Requested-With") == "" {
				return c.JSON(http.StatusForbidden, map[string]string{
					"detail": "missing X-Requested-With header",
				})
			}

			return next(c)
		}
	}
}
