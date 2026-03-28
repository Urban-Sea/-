package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/config"
	"github.com/open-regime/api-go/internal/repository"
	"github.com/open-regime/api-go/internal/service"
)

// AdminMFAHandler handles the 6 MFA endpoints under /api/admin/mfa.
type AdminMFAHandler struct {
	cfg     *config.Config
	mfaSvc  *service.MFAService
	mfaRepo *repository.MFARepository
}

// NewAdminMFAHandler creates a new AdminMFAHandler.
func NewAdminMFAHandler(cfg *config.Config, mfaSvc *service.MFAService, mfaRepo *repository.MFARepository) *AdminMFAHandler {
	return &AdminMFAHandler{
		cfg:     cfg,
		mfaSvc:  mfaSvc,
		mfaRepo: mfaRepo,
	}
}

// mfaVerifyRequest is the JSON body for verify endpoints.
type mfaVerifyRequest struct {
	Code string `json:"code"`
}

// ── GET /api/admin/mfa/status ──

func (h *AdminMFAHandler) Status(c echo.Context) error {
	userID := h.getUserID(c)
	ctx := c.Request().Context()

	rec, err := h.mfaRepo.FindMFAByUserID(ctx, userID)
	if err != nil {
		// pgx.ErrNoRows means no MFA record
		return c.JSON(http.StatusOK, map[string]interface{}{
			"mfa_enabled": false,
			"mfa_setup":   false,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"mfa_enabled": rec.Enabled,
		"mfa_setup":   true,
	})
}

// ── POST /api/admin/mfa/setup ──

func (h *AdminMFAHandler) Setup(c echo.Context) error {
	userID := h.getUserID(c)
	ctx := c.Request().Context()

	// Check for existing MFA record.
	existing, err := h.mfaRepo.FindMFAByUserID(ctx, userID)
	if err == nil {
		if existing.Enabled {
			return c.JSON(http.StatusConflict, map[string]string{
				"detail": "MFA already enabled",
			})
		}
		return c.JSON(http.StatusConflict, map[string]string{
			"detail": "MFA setup already in progress. Complete verification or contact support.",
		})
	}

	// Validate encryption key.
	if len(h.cfg.MFAEncryptionKey) != 64 {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{
			"detail": "MFA encryption not configured",
		})
	}

	// Get user email for provisioning URI.
	email, _ := h.mfaRepo.GetUserEmail(ctx, userID)

	// Generate TOTP secret.
	secret, provisioningURI, err := h.mfaSvc.GenerateSecret(email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to generate TOTP secret",
		})
	}

	// Encrypt and store.
	encrypted, err := h.mfaSvc.EncryptSecret(secret)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to encrypt secret",
		})
	}

	if err := h.mfaRepo.InsertMFA(ctx, userID, encrypted); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to store MFA record",
		})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"secret":           secret,
		"provisioning_uri": provisioningURI,
	})
}

// ── POST /api/admin/mfa/setup/verify ──

func (h *AdminMFAHandler) SetupVerify(c echo.Context) error {
	userID := h.getUserID(c)
	ctx := c.Request().Context()

	code, err := h.parseCode(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"detail": "6-digit code required",
		})
	}

	// Rate limiting.
	if err := h.mfaSvc.CheckRateLimit(ctx, userID); err != nil {
		return c.JSON(http.StatusTooManyRequests, map[string]string{
			"detail": err.Error(),
		})
	}

	// Find MFA record.
	rec, err := h.mfaRepo.FindMFAByUserID(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"detail": "MFA setup not found. Call /setup first.",
		})
	}
	if rec.Enabled {
		return c.JSON(http.StatusConflict, map[string]string{
			"detail": "MFA already enabled",
		})
	}

	// Decrypt secret.
	secret, err := h.mfaSvc.DecryptStoredSecret(rec.SecretEnc)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to decrypt secret",
		})
	}

	// Validate TOTP code.
	if !h.mfaSvc.ValidateTOTP(secret, code) {
		h.mfaSvc.RecordAttempt(ctx, userID)
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"detail": "Invalid code",
		})
	}

	// Replay protection.
	if err := h.mfaSvc.CheckReplay(ctx, userID, code); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"detail": "Code already used",
		})
	}
	h.mfaSvc.MarkCodeUsed(ctx, userID, code)
	h.mfaSvc.ClearAttempts(ctx, userID)

	// Enable MFA.
	if err := h.mfaRepo.EnableMFA(ctx, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to enable MFA",
		})
	}

	// Create session.
	token, expiresAt, err := h.mfaSvc.CreateSession(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to create session",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":     "mfa_enabled",
		"token":      token,
		"expires_at": expiresAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	})
}

// ── POST /api/admin/mfa/verify ──

func (h *AdminMFAHandler) Verify(c echo.Context) error {
	userID := h.getUserID(c)
	ctx := c.Request().Context()

	code, err := h.parseCode(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"detail": "6-digit code required",
		})
	}

	// Rate limiting.
	if err := h.mfaSvc.CheckRateLimit(ctx, userID); err != nil {
		return c.JSON(http.StatusTooManyRequests, map[string]string{
			"detail": err.Error(),
		})
	}

	// Find MFA record — must be enabled.
	rec, err := h.mfaRepo.FindMFAByUserID(ctx, userID)
	if err != nil || !rec.Enabled {
		return c.JSON(http.StatusNotFound, map[string]string{
			"detail": "MFA not enabled",
		})
	}

	// Decrypt secret.
	secret, err := h.mfaSvc.DecryptStoredSecret(rec.SecretEnc)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to decrypt secret",
		})
	}

	// Validate TOTP code.
	if !h.mfaSvc.ValidateTOTP(secret, code) {
		h.mfaSvc.RecordAttempt(ctx, userID)
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"detail": "Invalid code",
		})
	}

	// Replay protection.
	if err := h.mfaSvc.CheckReplay(ctx, userID, code); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"detail": "Code already used",
		})
	}
	h.mfaSvc.MarkCodeUsed(ctx, userID, code)
	h.mfaSvc.ClearAttempts(ctx, userID)

	// Create session.
	token, expiresAt, err := h.mfaSvc.CreateSession(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to create session",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":     "verified",
		"token":      token,
		"expires_at": expiresAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	})
}

// ── GET /api/admin/mfa/session ──

func (h *AdminMFAHandler) SessionCheck(c echo.Context) error {
	userID := h.getUserID(c)
	ctx := c.Request().Context()

	mfaToken := c.Request().Header.Get("X-MFA-Token")
	if mfaToken == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"valid":  false,
			"reason": "no_token",
		})
	}

	sess, err := h.mfaSvc.ValidateSession(ctx, userID, mfaToken)
	if err != nil {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"valid":  false,
			"reason": "expired_or_invalid",
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"valid":      true,
		"expires_at": sess.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	})
}

// ── DELETE /api/admin/mfa/session ──

func (h *AdminMFAHandler) SessionLogout(c echo.Context) error {
	userID := h.getUserID(c)
	ctx := c.Request().Context()

	mfaToken := c.Request().Header.Get("X-MFA-Token")
	if mfaToken == "" {
		return c.JSON(http.StatusOK, map[string]string{
			"status": "no_token",
		})
	}

	_ = h.mfaSvc.InvalidateSession(ctx, userID, mfaToken)

	return c.JSON(http.StatusOK, map[string]string{
		"status": "logged_out",
	})
}

// ── Helpers ──

func (h *AdminMFAHandler) getUserID(c echo.Context) string {
	userID, _ := c.Get("user_id").(string)
	return userID
}

func (h *AdminMFAHandler) parseCode(c echo.Context) (string, error) {
	var req mfaVerifyRequest
	if err := c.Bind(&req); err != nil {
		return "", err
	}
	code := strings.TrimSpace(req.Code)
	if len(code) != 6 {
		return "", fmt.Errorf("6-digit code required")
	}
	return code, nil
}
