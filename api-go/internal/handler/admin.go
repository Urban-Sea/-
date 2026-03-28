package handler

import (
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
	"golang.org/x/sync/errgroup"

	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

var validPlans = map[string]bool{
	"free":      true,
	"pro_trial": true,
	"pro":       true,
	"demo":      true,
}

// AdminHandler handles /api/admin endpoints.
type AdminHandler struct {
	repo *repository.AdminRepository
}

// NewAdminHandler creates a new AdminHandler.
func NewAdminHandler(repo *repository.AdminRepository) *AdminHandler {
	return &AdminHandler{repo: repo}
}

// Register mounts all admin routes on the given group.
func (h *AdminHandler) Register(g *echo.Group) {
	g.GET("/users", h.ListUsers)
	g.PATCH("/users/:id", h.UpdateUser)
	g.GET("/stats", h.GetStats)
	g.GET("/audit-logs", h.ListAuditLogs)
	g.GET("/batch-logs", h.ListBatchLogs)
	g.GET("/feature-flags", h.ListFeatureFlags)
	g.POST("/feature-flags", h.CreateFeatureFlag)
	g.PATCH("/feature-flags/:id", h.UpdateFeatureFlag)
}

// ListUsers handles GET /api/admin/users.
func (h *AdminHandler) ListUsers(c echo.Context) error {
	users, err := h.repo.ListUsers(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list users"})
	}
	return c.JSON(http.StatusOK, map[string]any{
		"users": users,
		"total": len(users),
	})
}

// UpdateUser handles PATCH /api/admin/users/:id.
func (h *AdminHandler) UpdateUser(c echo.Context) error {
	adminID := c.Get("user_id").(string)
	targetID := c.Param("id")

	var body map[string]any
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	allowed := map[string]bool{"plan": true, "display_name": true, "is_active": true}
	updates := map[string]any{}
	for k, v := range body {
		if allowed[k] {
			updates[k] = v
		}
	}
	if len(updates) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "No valid fields to update"})
	}

	// Validate plan
	if p, ok := updates["plan"]; ok {
		ps, isStr := p.(string)
		if !isStr || !validPlans[ps] {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"detail": "Invalid plan. Must be one of: demo, free, pro, pro_trial",
			})
		}
	}

	// Validate is_active
	if v, ok := updates["is_active"]; ok {
		if _, isBool := v.(bool); !isBool {
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "is_active must be boolean"})
		}
	}

	ctx := c.Request().Context()

	// Get old values for audit
	oldValue, err := h.repo.GetUserForAudit(ctx, targetID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "User not found"})
	}

	if err := h.repo.UpdateUser(ctx, targetID, updates); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to update user"})
	}

	// Fire-and-forget audit log
	go h.repo.AuditLog(ctx, adminID, "update_user", "user", targetID, oldValue, updates)

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}

// GetStats handles GET /api/admin/stats.
func (h *AdminHandler) GetStats(c echo.Context) error {
	ctx := c.Request().Context()
	now := time.Now().UTC()
	day7 := now.Add(-7 * 24 * time.Hour)
	day30 := now.Add(-30 * 24 * time.Hour)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	var stats model.AdminStats
	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		count, err := h.repo.CountAllUsers(gctx)
		if err != nil {
			return err
		}
		stats.TotalUsers = count
		return nil
	})

	g.Go(func() error {
		count, err := h.repo.CountActiveUsers(gctx, day7)
		if err != nil {
			return err
		}
		stats.Active7D = count
		return nil
	})

	g.Go(func() error {
		count, err := h.repo.CountActiveUsers(gctx, day30)
		if err != nil {
			return err
		}
		stats.Active30D = count
		return nil
	})

	g.Go(func() error {
		count, err := h.repo.CountNewUsers(gctx, monthStart)
		if err != nil {
			return err
		}
		stats.NewThisMonth = count
		return nil
	})

	g.Go(func() error {
		signups, err := h.repo.DailySignups(gctx, day30)
		if err != nil {
			return err
		}
		stats.DailySignups = signups
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to fetch stats"})
	}

	if stats.DailySignups == nil {
		stats.DailySignups = []model.DailySignup{}
	}

	return c.JSON(http.StatusOK, stats)
}

// ListAuditLogs handles GET /api/admin/audit-logs.
func (h *AdminHandler) ListAuditLogs(c echo.Context) error {
	limit := parseLimit(c.QueryParam("limit"), 50, 200)
	ctx := c.Request().Context()

	logs, err := h.repo.ListAuditLogs(ctx, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list audit logs"})
	}

	// Collect unique admin IDs for email mapping
	idSet := map[string]struct{}{}
	for _, l := range logs {
		idSet[l.AdminUserID] = struct{}{}
	}
	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}

	emailMap, err := h.repo.GetEmailsByIDs(ctx, ids)
	if err != nil {
		emailMap = map[string]string{} // degrade gracefully
	}

	result := make([]model.AuditLogWithEmail, len(logs))
	for i, l := range logs {
		email := emailMap[l.AdminUserID]
		if email == "" {
			email = "unknown"
		}
		result[i] = model.AuditLogWithEmail{
			AuditLog:   l,
			AdminEmail: email,
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"logs":  result,
		"total": len(result),
	})
}

// ListBatchLogs handles GET /api/admin/batch-logs.
func (h *AdminHandler) ListBatchLogs(c echo.Context) error {
	limit := parseLimit(c.QueryParam("limit"), 50, 200)

	logs, err := h.repo.ListBatchLogs(c.Request().Context(), limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list batch logs"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"logs":  logs,
		"total": len(logs),
	})
}

// ListFeatureFlags handles GET /api/admin/feature-flags.
func (h *AdminHandler) ListFeatureFlags(c echo.Context) error {
	flags, err := h.repo.ListFeatureFlags(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list feature flags"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"flags": flags,
		"total": len(flags),
	})
}

// CreateFeatureFlag handles POST /api/admin/feature-flags.
func (h *AdminHandler) CreateFeatureFlag(c echo.Context) error {
	adminID := c.Get("user_id").(string)

	var body struct {
		FlagKey     string `json:"flag_key"`
		Description string `json:"description"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	flagKey := strings.TrimSpace(body.FlagKey)
	if flagKey == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "flag_key is required"})
	}
	description := strings.TrimSpace(body.Description)

	ctx := c.Request().Context()
	flag, err := h.repo.CreateFeatureFlag(ctx, flagKey, description)
	if err != nil {
		// Unique constraint violation
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			return c.JSON(http.StatusConflict, map[string]string{"detail": "Flag key already exists"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create feature flag"})
	}

	go h.repo.AuditLog(ctx, adminID, "create_feature_flag", "feature_flag", flagKey,
		nil, map[string]any{"flag_key": flagKey, "enabled": false})

	return c.JSON(http.StatusCreated, map[string]any{"flag": flag})
}

// UpdateFeatureFlag handles PATCH /api/admin/feature-flags/:id.
func (h *AdminHandler) UpdateFeatureFlag(c echo.Context) error {
	adminID := c.Get("user_id").(string)

	flagID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid flag ID"})
	}

	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if err := c.Bind(&body); err != nil || body.Enabled == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "enabled must be boolean"})
	}

	ctx := c.Request().Context()

	flagKey, oldEnabled, err := h.repo.GetFeatureFlagByID(ctx, flagID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"detail": "Flag not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to fetch flag"})
	}

	if err := h.repo.UpdateFeatureFlagEnabled(ctx, flagID, *body.Enabled); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to update feature flag"})
	}

	go h.repo.AuditLog(ctx, adminID, "update_feature_flag", "feature_flag", flagKey,
		map[string]any{"enabled": oldEnabled}, map[string]any{"enabled": *body.Enabled})

	return c.JSON(http.StatusOK, map[string]string{"status": "updated"})
}

// parseLimit clamps a query param to [1, max] with a given default.
func parseLimit(raw string, defaultVal, maxVal int) int {
	if raw == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return defaultVal
	}
	n = int(math.Max(1, math.Min(float64(n), float64(maxVal))))
	return n
}
