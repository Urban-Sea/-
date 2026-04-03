package service

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-key-for-unit-tests"

func TestIssueAndValidateJWT(t *testing.T) {
	svc := &AuthService{jwtSecret: []byte(testSecret)}

	token, err := svc.IssueJWT("user-123", "test@example.com")
	if err != nil {
		t.Fatalf("IssueJWT failed: %v", err)
	}
	if token == "" {
		t.Fatal("IssueJWT returned empty token")
	}

	claims, err := svc.ValidateJWT(token)
	if err != nil {
		t.Fatalf("ValidateJWT failed: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Errorf("UserID = %q, want %q", claims.UserID, "user-123")
	}
	if claims.Email != "test@example.com" {
		t.Errorf("Email = %q, want %q", claims.Email, "test@example.com")
	}
}

func TestValidateJWT_Expired(t *testing.T) {
	svc := &AuthService{jwtSecret: []byte(testSecret)}

	past := time.Now().Add(-48 * time.Hour)
	claims := Claims{
		UserID: "user-123",
		Email:  "test@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(past),
			ExpiresAt: jwt.NewNumericDate(past.Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(testSecret))

	_, err := svc.ValidateJWT(signed)
	if err == nil {
		t.Fatal("ValidateJWT should fail for expired token")
	}
}

func TestValidateJWT_WrongSecret(t *testing.T) {
	svc := &AuthService{jwtSecret: []byte(testSecret)}

	// Sign with a different secret.
	claims := Claims{
		UserID: "user-123",
		Email:  "test@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte("wrong-secret"))

	_, err := svc.ValidateJWT(signed)
	if err == nil {
		t.Fatal("ValidateJWT should fail for wrong secret")
	}
}

func TestValidateJWT_Garbage(t *testing.T) {
	svc := &AuthService{jwtSecret: []byte(testSecret)}

	_, err := svc.ValidateJWT("not-a-jwt")
	if err == nil {
		t.Fatal("ValidateJWT should fail for garbage input")
	}
}

func TestValidateJWTForRefresh_RecentlyIssued(t *testing.T) {
	svc := &AuthService{jwtSecret: []byte(testSecret)}

	// Token issued 1 hour ago, expired (exp = iat + 24h is irrelevant here)
	iat := time.Now().Add(-1 * time.Hour)
	claims := Claims{
		UserID: "user-123",
		Email:  "test@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(iat),
			ExpiresAt: jwt.NewNumericDate(iat.Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(testSecret))

	got, err := svc.ValidateJWTForRefresh(signed)
	if err != nil {
		t.Fatalf("ValidateJWTForRefresh should pass for recently issued token: %v", err)
	}
	if got.UserID != "user-123" {
		t.Errorf("UserID = %q, want %q", got.UserID, "user-123")
	}
}

func TestValidateJWTForRefresh_TooOld(t *testing.T) {
	svc := &AuthService{jwtSecret: []byte(testSecret)}

	// Token issued 8 days ago — beyond the 7-day refresh window
	iat := time.Now().Add(-8 * 24 * time.Hour)
	claims := Claims{
		UserID: "user-123",
		Email:  "test@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(iat),
			ExpiresAt: jwt.NewNumericDate(iat.Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(testSecret))

	_, err := svc.ValidateJWTForRefresh(signed)
	if err == nil {
		t.Fatal("ValidateJWTForRefresh should fail for token issued 8 days ago")
	}
}

func TestValidateJWTForRefresh_ExpiredButRecent(t *testing.T) {
	svc := &AuthService{jwtSecret: []byte(testSecret)}

	// Token issued 2 days ago, expired 1 day ago — should still be refreshable
	iat := time.Now().Add(-2 * 24 * time.Hour)
	claims := Claims{
		UserID: "user-123",
		Email:  "test@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(iat),
			ExpiresAt: jwt.NewNumericDate(iat.Add(24 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(testSecret))

	got, err := svc.ValidateJWTForRefresh(signed)
	if err != nil {
		t.Fatalf("ValidateJWTForRefresh should pass for expired but recently issued token: %v", err)
	}
	if got.Email != "test@example.com" {
		t.Errorf("Email = %q, want %q", got.Email, "test@example.com")
	}
}
