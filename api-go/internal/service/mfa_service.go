package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"github.com/redis/go-redis/v9"

	"github.com/open-regime/api-go/internal/repository"
)

const (
	sessionDurationHours = 1
	issuerName           = "OpenRegimeAdmin"
	maxAttempts          = 5
	lockoutSeconds       = 900 // 15 minutes
	replayTTLSeconds     = 90
)

// MFAService handles TOTP crypto, session management, rate limiting, and replay protection.
type MFAService struct {
	encryptionKey []byte // 32 bytes from 64-char hex
	mfaRepo       *repository.MFARepository
	redis         *redis.Client
}

// NewMFAService creates a new MFAService. encryptionKeyHex must be a 64-character hex string.
func NewMFAService(encryptionKeyHex string, mfaRepo *repository.MFARepository, redisClient *redis.Client) (*MFAService, error) {
	if len(encryptionKeyHex) != 64 {
		return nil, fmt.Errorf("MFA_ENCRYPTION_KEY must be 64 hex characters, got %d", len(encryptionKeyHex))
	}
	keyBytes, err := hex.DecodeString(encryptionKeyHex)
	if err != nil {
		return nil, fmt.Errorf("MFA_ENCRYPTION_KEY invalid hex: %w", err)
	}
	return &MFAService{
		encryptionKey: keyBytes,
		mfaRepo:       mfaRepo,
		redis:         redisClient,
	}, nil
}

// ── AES-256-GCM Crypto ──

// EncryptSecret encrypts plaintext with AES-256-GCM.
// Returns "nonce_hex:ciphertext_hex" format compatible with Python and TS.
func (s *MFAService) EncryptSecret(plaintext string) (string, error) {
	block, err := aes.NewCipher(s.encryptionKey)
	if err != nil {
		return "", fmt.Errorf("aes new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm new: %w", err)
	}

	nonce := make([]byte, 12) // 96-bit nonce
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("nonce generation: %w", err)
	}

	ciphertext := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(nonce) + ":" + hex.EncodeToString(ciphertext), nil
}

// DecryptSecret decrypts "nonce_hex:ciphertext_hex" with AES-256-GCM.
func (s *MFAService) DecryptSecret(encrypted string) (string, error) {
	parts := strings.SplitN(encrypted, ":", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid encrypted format")
	}

	nonce, err := hex.DecodeString(parts[0])
	if err != nil {
		return "", fmt.Errorf("nonce decode: %w", err)
	}
	ciphertext, err := hex.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("ciphertext decode: %w", err)
	}

	block, err := aes.NewCipher(s.encryptionKey)
	if err != nil {
		return "", fmt.Errorf("aes new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm new: %w", err)
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("gcm decrypt: %w", err)
	}
	return string(plaintext), nil
}

// ── TOTP ──

// GenerateSecret generates a new TOTP secret and returns the base32 secret and provisioning URI.
func (s *MFAService) GenerateSecret(email string) (secret string, uri string, err error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuerName,
		AccountName: email,
		Period:      30,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return "", "", fmt.Errorf("totp generate: %w", err)
	}
	return key.Secret(), key.URL(), nil
}

// ValidateTOTP validates a 6-digit TOTP code against the secret with a +-1 window (+-30s).
func (s *MFAService) ValidateTOTP(secret, code string) bool {
	valid, _ := totp.ValidateCustom(code, secret, time.Now(), totp.ValidateOpts{
		Period:    30,
		Skew:     1, // +-1 window
		Digits:   otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	return valid
}

// ── Session Management ──

// CreateSession generates a 32-byte random token, stores its SHA-256 hash in DB,
// and returns the raw hex token and expiry time.
func (s *MFAService) CreateSession(ctx context.Context, userID string) (token string, expiresAt time.Time, err error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", time.Time{}, fmt.Errorf("session token generation: %w", err)
	}
	token = hex.EncodeToString(tokenBytes)
	tokenHash := sha256Hex(token)
	expiresAt = time.Now().Add(time.Duration(sessionDurationHours) * time.Hour)

	if err := s.mfaRepo.InsertSession(ctx, userID, tokenHash, expiresAt); err != nil {
		return "", time.Time{}, err
	}
	return token, expiresAt, nil
}

// ValidateSession checks if a token corresponds to a valid, non-expired session.
func (s *MFAService) ValidateSession(ctx context.Context, userID, token string) (*repository.MFASession, error) {
	tokenHash := sha256Hex(token)
	return s.mfaRepo.FindValidSession(ctx, userID, tokenHash)
}

// InvalidateSession removes a session by token.
func (s *MFAService) InvalidateSession(ctx context.Context, userID, token string) error {
	tokenHash := sha256Hex(token)
	return s.mfaRepo.DeleteSession(ctx, userID, tokenHash)
}

// ── Rate Limiting (Redis) ──

// CheckRateLimit returns an error if the user has exceeded maxAttempts in the lockout window.
func (s *MFAService) CheckRateLimit(ctx context.Context, userID string) error {
	key := "mfa_attempts:" + userID
	count, err := s.redis.Get(ctx, key).Int64()
	if err != nil && err != redis.Nil {
		return fmt.Errorf("rate limit check: %w", err)
	}
	if count >= int64(maxAttempts) {
		return fmt.Errorf("too many attempts. Try again in %d minutes", lockoutSeconds/60)
	}
	return nil
}

// RecordAttempt increments the attempt counter with a 15-minute TTL.
func (s *MFAService) RecordAttempt(ctx context.Context, userID string) {
	key := "mfa_attempts:" + userID
	pipe := s.redis.Pipeline()
	pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, time.Duration(lockoutSeconds)*time.Second)
	_, _ = pipe.Exec(ctx)
}

// ClearAttempts removes the rate limit counter on successful verification.
func (s *MFAService) ClearAttempts(ctx context.Context, userID string) {
	key := "mfa_attempts:" + userID
	s.redis.Del(ctx, key)
}

// ── Replay Protection (Redis) ──

// CheckReplay returns an error if the code has already been used within the replay window.
func (s *MFAService) CheckReplay(ctx context.Context, userID, code string) error {
	key := "mfa_used:" + userID + ":" + code
	exists, err := s.redis.Exists(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("replay check: %w", err)
	}
	if exists > 0 {
		return fmt.Errorf("code already used")
	}
	return nil
}

// MarkCodeUsed stores the code in Redis with a 90-second TTL.
func (s *MFAService) MarkCodeUsed(ctx context.Context, userID, code string) {
	key := "mfa_used:" + userID + ":" + code
	s.redis.Set(ctx, key, "1", time.Duration(replayTTLSeconds)*time.Second)
}

// ── Helpers ──

// DecryptStoredSecret handles both encrypted (nonce:ciphertext) and legacy plaintext secrets.
func (s *MFAService) DecryptStoredSecret(secretEnc string) (string, error) {
	if strings.Contains(secretEnc, ":") {
		return s.DecryptSecret(secretEnc)
	}
	return secretEnc, nil // legacy plaintext
}

func sha256Hex(input string) string {
	h := sha256.Sum256([]byte(input))
	return hex.EncodeToString(h[:])
}
