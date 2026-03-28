package middleware

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/service"
)

// errJSON returns a JSON error response in the format {"detail": "message"}.
func errJSON(c echo.Context, code int, msg string) error {
	return c.JSON(code, map[string]string{"detail": msg})
}

// AuthMiddleware validates the JWT from the HttpOnly "token" cookie,
// checks that the user is active, and sets user_id and email in the context.
func AuthMiddleware(authSvc *service.AuthService) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			cookie, err := c.Cookie("token")
			if err != nil {
				return errJSON(c, http.StatusUnauthorized, "authentication required")
			}

			claims, err := authSvc.ValidateJWT(cookie.Value)
			if err != nil {
				return errJSON(c, http.StatusUnauthorized, "invalid or expired token")
			}

			user, err := authSvc.GetUser(c.Request().Context(), claims.UserID)
			if err != nil {
				return errJSON(c, http.StatusUnauthorized, "user not found")
			}

			if !user.IsActive {
				return errJSON(c, http.StatusUnauthorized, "account is deactivated")
			}

			c.Set("user_id", claims.UserID)
			c.Set("email", claims.Email)

			return next(c)
		}
	}
}
