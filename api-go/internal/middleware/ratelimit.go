package middleware

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

const (
	rateLimitMax    = 120
	rateLimitWindow = 60 * time.Second
)

// inMemoryEntry tracks request count and window expiry for the fallback limiter.
type inMemoryEntry struct {
	count   int
	resetAt time.Time
}

// RateLimitMiddleware returns middleware that enforces 120 requests per minute
// per IP. It uses Redis as the primary store and falls back to an in-memory
// sync.Map when Redis is unavailable.
func RateLimitMiddleware(redisClient *redis.Client) echo.MiddlewareFunc {
	var fallback sync.Map

	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ip := c.RealIP()
			key := fmt.Sprintf("rl:ip:%s", ip)
			ctx := c.Request().Context()

			// Try Redis first.
			if redisClient != nil {
				count, err := redisClient.Incr(ctx, key).Result()
				if err == nil {
					if count == 1 {
						redisClient.Expire(ctx, key, rateLimitWindow)
					}
					if count > rateLimitMax {
						return c.JSON(http.StatusTooManyRequests, map[string]string{
							"detail": "Rate limit exceeded",
						})
					}
					return next(c)
				}
				// Redis error — fall through to in-memory fallback.
			}

			// In-memory fallback.
			now := time.Now()
			val, _ := fallback.LoadOrStore(ip, &inMemoryEntry{
				count:   0,
				resetAt: now.Add(rateLimitWindow),
			})
			entry := val.(*inMemoryEntry)

			if now.After(entry.resetAt) {
				entry.count = 0
				entry.resetAt = now.Add(rateLimitWindow)
			}

			entry.count++
			if entry.count > rateLimitMax {
				return c.JSON(http.StatusTooManyRequests, map[string]string{
					"detail": "Rate limit exceeded",
				})
			}

			return next(c)
		}
	}
}
