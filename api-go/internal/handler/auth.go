package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"github.com/open-regime/api-go/internal/config"
	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
	"github.com/open-regime/api-go/internal/service"
)

// AuthHandler handles Google OAuth login, token refresh, logout, and user info.
type AuthHandler struct {
	cfg      *config.Config
	authSvc  *service.AuthService
	userRepo *repository.UserRepository
	redis    *redis.Client
	oauthCfg *oauth2.Config
}

// NewAuthHandler creates a new AuthHandler with the Google OAuth config wired up.
func NewAuthHandler(
	cfg *config.Config,
	authSvc *service.AuthService,
	userRepo *repository.UserRepository,
	redisClient *redis.Client,
) *AuthHandler {
	oauthCfg := &oauth2.Config{
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		RedirectURL:  cfg.GoogleRedirectURL,
		Scopes:       []string{"openid", "email", "profile"},
		Endpoint:     google.Endpoint,
	}
	return &AuthHandler{
		cfg:      cfg,
		authSvc:  authSvc,
		userRepo: userRepo,
		redis:    redisClient,
		oauthCfg: oauthCfg,
	}
}

// googleUserInfo represents the response from Google's userinfo endpoint.
type googleUserInfo struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

// GoogleLogin initiates the OAuth flow by redirecting the user to Google.
func (h *AuthHandler) GoogleLogin(c echo.Context) error {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to generate state",
		})
	}
	state := hex.EncodeToString(b)

	// 元の Host を state に紐付けて、コールバック後に正しいオリジン (apex or admin) に戻す
	origin := "main"
	if c.Request().Host == "admin.open-regime.com" {
		origin = "admin"
	}

	ctx := c.Request().Context()
	h.redis.Set(ctx, "oauth_state:"+state, origin, 10*time.Minute)

	url := h.oauthCfg.AuthCodeURL(state)
	return c.Redirect(http.StatusTemporaryRedirect, url)
}

// GoogleCallback handles the OAuth callback from Google.
func (h *AuthHandler) GoogleCallback(c echo.Context) error {
	ctx := c.Request().Context()

	state := c.QueryParam("state")
	code := c.QueryParam("code")

	if state == "" || code == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"detail": "Missing state or code",
		})
	}

	// Verify and consume the state token, and recover the origin.
	stateKey := "oauth_state:" + state
	origin, err := h.redis.GetDel(ctx, stateKey).Result()
	if err != nil || origin == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"detail": "Invalid or expired state",
		})
	}

	// Exchange the authorization code for tokens.
	token, err := h.oauthCfg.Exchange(ctx, code)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"detail": "Failed to exchange code",
		})
	}

	// Fetch user info from Google.
	userInfo, err := h.fetchGoogleUserInfo(token.AccessToken)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to fetch user info from Google",
		})
	}

	// Find or create the user.
	user, err := h.findOrCreateUser(ctx, userInfo)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to find or create user",
		})
	}

	// Update last login timestamp.
	_ = h.userRepo.UpdateLastLogin(ctx, user.ID)

	// Issue JWT.
	jwt, err := h.authSvc.IssueJWT(user.ID, user.Email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to issue token",
		})
	}

	// Set HttpOnly cookie.
	h.setTokenCookie(c, jwt, 86400)

	redirectURL := h.cfg.FrontendURL + "/auth/callback/"
	if origin == "admin" {
		redirectURL = "https://admin.open-regime.com/"
	}
	return c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}

// RefreshToken validates the existing JWT cookie and issues a fresh one.
func (h *AuthHandler) RefreshToken(c echo.Context) error {
	cookie, err := c.Cookie("token")
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"detail": "No token cookie",
		})
	}

	claims, err := h.authSvc.ValidateJWTForRefresh(cookie.Value)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"detail": "Invalid token",
		})
	}

	newToken, err := h.authSvc.IssueJWT(claims.UserID, claims.Email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"detail": "Failed to issue token",
		})
	}

	h.setTokenCookie(c, newToken, 86400)

	return c.JSON(http.StatusOK, map[string]string{
		"status": "refreshed",
	})
}

// Logout deletes the token cookie.
func (h *AuthHandler) Logout(c echo.Context) error {
	h.setTokenCookie(c, "", -1)
	return c.JSON(http.StatusOK, map[string]string{
		"status": "logged_out",
	})
}

// Me returns the current authenticated user's information.
// Requires auth middleware to have set "user_id" in the context.
func (h *AuthHandler) Me(c echo.Context) error {
	userID, ok := c.Get("user_id").(string)
	if !ok || userID == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"detail": "Not authenticated",
		})
	}

	ctx := c.Request().Context()
	user, err := h.userRepo.FindByID(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"detail": "User not found",
		})
	}

	resp := model.UserResponse{
		User:    *user,
		IsAdmin: h.cfg.IsAdmin(user.Email),
	}
	return c.JSON(http.StatusOK, resp)
}

// fetchGoogleUserInfo calls Google's userinfo endpoint with the given access token.
func (h *AuthHandler) fetchGoogleUserInfo(accessToken string) (*googleUserInfo, error) {
	req, err := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("google userinfo returned %d: %s", resp.StatusCode, body)
	}

	var info googleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, err
	}
	return &info, nil
}

// findOrCreateUser looks up an existing user by provider ID or email, or creates a new one.
func (h *AuthHandler) findOrCreateUser(ctx context.Context, info *googleUserInfo) (*model.User, error) {
	// 1. Try to find by auth_provider_id (Google's id).
	user, err := h.userRepo.FindByAuthProviderID(ctx, info.ID)
	if err == nil {
		return user, nil
	}

	// 2. Try to find by email (migration path for users who signed up before OAuth).
	user, err = h.userRepo.FindByEmail(ctx, info.Email)
	if err == nil {
		// Bind if not yet bound, or if migrating from another provider (e.g. supabase → google).
		if user.AuthProviderID == nil || user.AuthProvider != "google" {
			if bindErr := h.userRepo.UpdateAuthProvider(ctx, user.ID, "google", info.ID); bindErr != nil {
				return nil, fmt.Errorf("bind auth provider: %w", bindErr)
			}
		}
		return user, nil
	}

	// If the error is anything other than "not found", propagate it.
	if err != nil && err.Error() != pgx.ErrNoRows.Error() {
		// Treat any lookup error as not-found and proceed to create.
	}

	// 3. Create a new user.
	user, err = h.userRepo.Create(ctx, info.Email, "google", info.ID)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	// Update display name if provided by Google.
	if info.Name != "" {
		_ = h.userRepo.UpdateDisplayName(ctx, user.ID, info.Name)
	}

	return user, nil
}

// setTokenCookie sets the token cookie with the appropriate flags.
func (h *AuthHandler) setTokenCookie(c echo.Context, token string, maxAge int) {
	// Domain 付き Cookie に移行する場合、旧 Cookie (Domain なし) を削除して二重残留を防止
	if h.cfg.CookieDomain != "" {
		c.SetCookie(&http.Cookie{
			Name:     "token",
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   h.cfg.IsProduction(),
		})
	}

	cookie := &http.Cookie{
		Name:     "token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.cfg.IsProduction(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	}
	if h.cfg.CookieDomain != "" {
		cookie.Domain = h.cfg.CookieDomain
	}
	c.SetCookie(cookie)
}
