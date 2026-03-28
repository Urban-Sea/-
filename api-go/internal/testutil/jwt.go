package testutil

import (
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

// TestJWTSecret is the shared secret used in tests.
const TestJWTSecret = "test-secret-key-for-unit-tests"

// TestClaims matches the production Claims struct in service/auth_service.go.
type TestClaims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// GenerateTestToken creates a signed JWT for testing.
func GenerateTestToken(userID, email string) string {
	now := time.Now()
	claims := TestClaims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(TestJWTSecret))
	return signed
}

// GenerateExpiredToken creates an already-expired JWT for testing.
func GenerateExpiredToken(userID, email string) string {
	past := time.Now().Add(-48 * time.Hour)
	claims := TestClaims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(past),
			ExpiresAt: jwt.NewNumericDate(past.Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(TestJWTSecret))
	return signed
}

// SetTokenCookie adds a "token" cookie to the request.
func SetTokenCookie(req *http.Request, token string) {
	req.AddCookie(&http.Cookie{Name: "token", Value: token})
}

// SetAuthContext sets user_id and email on an echo.Context (simulates auth middleware).
func SetAuthContext(c echo.Context, userID, email string) {
	c.Set("user_id", userID)
	c.Set("email", email)
}
