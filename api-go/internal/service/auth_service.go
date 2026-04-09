package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"

	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

const (
	userCacheTTL = 5 * time.Minute
	// Per-operation context timeouts (skill rule: conn-timeouts).
	// GetUser is called on every authenticated request via AuthMiddleware,
	// so a slow Redis must not block the API. 500ms is generous (Docker-local
	// Redis ~1ms) but errs on the side of cache hits over false negatives.
	userCacheGetTimeout = 500 * time.Millisecond
	userCacheSetTimeout = 500 * time.Millisecond
)

// Claims represents the JWT claims issued by this service.
type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// AuthService handles JWT issuance/validation and user lookup with caching.
type AuthService struct {
	jwtSecret []byte
	userRepo  *repository.UserRepository
	redis     *redis.Client
}

// NewAuthService creates a new AuthService.
func NewAuthService(jwtSecret string, userRepo *repository.UserRepository, redis *redis.Client) *AuthService {
	return &AuthService{
		jwtSecret: []byte(jwtSecret),
		userRepo:  userRepo,
		redis:     redis,
	}
}

// IssueJWT creates a signed HS256 JWT with user_id, email, iat, and exp (24h).
func (s *AuthService) IssueJWT(userID, email string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(24 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

// ValidateJWT parses and verifies the token, returning the claims if valid.
func (s *AuthService) ValidateJWT(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	return claims, nil
}

// ValidateJWTForRefresh parses and verifies the token signature without checking exp.
// Instead, it checks that the token was issued (iat) within the last 7 days.
// This allows refreshing expired tokens while limiting the refresh window.
func (s *AuthService) ValidateJWTForRefresh(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.jwtSecret, nil
	}, jwt.WithoutClaimsValidation())
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, fmt.Errorf("invalid token claims")
	}
	if claims.IssuedAt == nil || time.Since(claims.IssuedAt.Time) > 7*24*time.Hour {
		return nil, fmt.Errorf("token too old for refresh")
	}
	return claims, nil
}

// GetUser returns a user by ID, checking Redis cache first, then falling back to DB.
//
// Cache GET/SET each have their own context.WithTimeout (skill rule: conn-timeouts)
// so that a slow/unhealthy Redis cannot block the request. This is critical because
// GetUser is invoked on every authenticated API call via AuthMiddleware.
func (s *AuthService) GetUser(ctx context.Context, userID string) (*model.User, error) {
	cacheKey := "user:" + userID

	// Try cache first (with bounded timeout).
	{
		getCtx, cancel := context.WithTimeout(ctx, userCacheGetTimeout)
		data, err := s.redis.Get(getCtx, cacheKey).Bytes()
		cancel()
		if err == nil {
			var u model.User
			if jsonErr := json.Unmarshal(data, &u); jsonErr == nil {
				return &u, nil
			}
			// If unmarshal fails, fall through to DB.
		}
	}

	// Cache miss — query DB.
	u, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// Cache the result (best-effort, with bounded timeout).
	if encoded, jsonErr := json.Marshal(u); jsonErr == nil {
		setCtx, cancel := context.WithTimeout(ctx, userCacheSetTimeout)
		_ = s.redis.Set(setCtx, cacheKey, encoded, userCacheTTL).Err()
		cancel()
	}

	return u, nil
}
