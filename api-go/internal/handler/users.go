package handler

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/config"
	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

// UsersHandler handles /api/me endpoints.
type UsersHandler struct {
	cfg      *config.Config
	userRepo *repository.UserRepository
}

// NewUsersHandler creates a new UsersHandler.
func NewUsersHandler(cfg *config.Config, userRepo *repository.UserRepository) *UsersHandler {
	return &UsersHandler{cfg: cfg, userRepo: userRepo}
}

// GetMe handles GET /api/me.
func (h *UsersHandler) GetMe(c echo.Context) error {
	userID := c.Get("user_id").(string)
	email := c.Get("email").(string)

	user, err := h.userRepo.FindByID(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "User not found"})
	}

	resp := model.UserResponse{
		User:    *user,
		IsAdmin: h.cfg.IsAdmin(email),
	}
	return c.JSON(http.StatusOK, resp)
}

// UpdateMe handles PATCH /api/me.
func (h *UsersHandler) UpdateMe(c echo.Context) error {
	userID := c.Get("user_id").(string)

	var body struct {
		DisplayName *string `json:"display_name"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	if body.DisplayName == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "No fields to update"})
	}

	name := strings.TrimSpace(*body.DisplayName)
	if len(name) > 50 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "display_name must be 50 characters or less"})
	}

	if err := h.userRepo.UpdateDisplayName(c.Request().Context(), userID, name); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to update"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}
