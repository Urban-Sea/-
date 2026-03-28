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

const userCacheTTL = 5 * time.Minute

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

// GetUser returns a user by ID, checking Redis cache first, then falling back to DB.
func (s *AuthService) GetUser(ctx context.Context, userID string) (*model.User, error) {
	cacheKey := "user:" + userID

	// Try cache first.
	data, err := s.redis.Get(ctx, cacheKey).Bytes()
	if err == nil {
		var u model.User
		if jsonErr := json.Unmarshal(data, &u); jsonErr == nil {
			return &u, nil
		}
		// If unmarshal fails, fall through to DB.
	}

	// Cache miss — query DB.
	u, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// Cache the result.
	if encoded, jsonErr := json.Marshal(u); jsonErr == nil {
		_ = s.redis.Set(ctx, cacheKey, encoded, userCacheTTL).Err()
	}

	return u, nil
}
