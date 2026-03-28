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
