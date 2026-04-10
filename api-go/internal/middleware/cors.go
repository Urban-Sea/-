package middleware

import (
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/open-regime/api-go/internal/config"
)

// CORSMiddleware returns an Echo CORS middleware configured per environment.
func CORSMiddleware(cfg *config.Config) echo.MiddlewareFunc {
	var allowOrigins []string
	if cfg.IsProduction() {
		allowOrigins = []string{
			"https://open-regime.com",
			"https://admin.open-regime.com",
		}
	} else {
		allowOrigins = []string{
			"http://localhost:3000",
			"http://localhost",
		}
	}

	return middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins:     allowOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type", "Authorization", "X-MFA-Token", "X-Requested-With"},
		AllowCredentials: true,
		MaxAge:           86400,
	})
}
