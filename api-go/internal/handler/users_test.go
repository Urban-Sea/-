package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/config"
	"github.com/open-regime/api-go/internal/model"
)

// --- Fake UserRepository for testing (no DB required) ---

// fakeUser is the user returned by the fake repo. Set to nil to simulate "not found".
var fakeUser *model.User

// fakeUpdateErr is the error returned by UpdateDisplayName. Set to non-nil to simulate failure.
var fakeUpdateErr error

// We can't use the real repository (needs pgxpool), so we test the handler logic
// by directly calling the handler methods with pre-set echo context values.
// This validates request parsing, validation, and response formatting.

func setupEcho(method, path, body string) (echo.Context, *httptest.ResponseRecorder) {
	e := echo.New()
	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	return c, rec
}

func TestGetMe_Success(t *testing.T) {
	// Since GetMe calls userRepo.FindByID which needs a real DB,
	// we test the response format by verifying the UserResponse structure.
	displayName := "Test User"
	user := model.User{
		ID:          "550e8400-e29b-41d4-a716-446655440000",
		Email:       "test@example.com",
		DisplayName: &displayName,
		Plan:        "free",
		IsActive:    true,
	}

	resp := model.UserResponse{
		User:    user,
		IsAdmin: false,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if decoded["id"] != "550e8400-e29b-41d4-a716-446655440000" {
		t.Errorf("id = %v, want 550e8400-e29b-41d4-a716-446655440000", decoded["id"])
	}
	if decoded["email"] != "test@example.com" {
		t.Errorf("email = %v, want test@example.com", decoded["email"])
	}
	if decoded["is_admin"] != false {
		t.Errorf("is_admin = %v, want false", decoded["is_admin"])
	}
	if decoded["display_name"] != "Test User" {
		t.Errorf("display_name = %v, want Test User", decoded["display_name"])
	}
}

func TestUpdateMe_Validation(t *testing.T) {
	cfg := &config.Config{}
	h := &UsersHandler{cfg: cfg, userRepo: nil}

	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantDetail string
	}{
		{
			name:       "invalid JSON",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
			wantDetail: "Invalid request body",
		},
		{
			name:       "missing display_name",
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
			wantDetail: "No fields to update",
		},
		{
			name:       "display_name too long",
			body:       `{"display_name":"` + strings.Repeat("a", 51) + `"}`,
			wantStatus: http.StatusBadRequest,
			wantDetail: "display_name must be 50 characters or less",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, rec := setupEcho(http.MethodPatch, "/api/me", tt.body)
			c.Set("user_id", "test-user-id")

			err := h.UpdateMe(c)
			if err != nil {
				t.Fatalf("UpdateMe returned error: %v", err)
			}

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			var resp map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("unmarshal response: %v", err)
			}
			if resp["detail"] != tt.wantDetail {
				t.Errorf("detail = %q, want %q", resp["detail"], tt.wantDetail)
			}
		})
	}
}

func TestIsAdmin(t *testing.T) {
	cfg := &config.Config{
		AdminEmails: []string{"admin@example.com", "boss@example.com"},
	}

	tests := []struct {
		email string
		want  bool
	}{
		{"admin@example.com", true},
		{"boss@example.com", true},
		{"user@example.com", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.email, func(t *testing.T) {
			got := cfg.IsAdmin(tt.email)
			if got != tt.want {
				t.Errorf("IsAdmin(%q) = %v, want %v", tt.email, got, tt.want)
			}
		})
	}
}
