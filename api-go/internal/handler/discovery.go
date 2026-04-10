package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

const (
	discoveryCacheTTL    = 1 * time.Hour
	discoveryCacheKeyDay = "discovery:today"
)

// DiscoveryHandler handles /api/discovery and /api/admin/discovery endpoints.
type DiscoveryHandler struct {
	repo         *repository.DiscoveryRepository
	adminRepo    *repository.AdminRepository
	redis        *redis.Client
	publishToken string
}

// NewDiscoveryHandler creates a new DiscoveryHandler.
func NewDiscoveryHandler(
	repo *repository.DiscoveryRepository,
	adminRepo *repository.AdminRepository,
	rdb *redis.Client,
	publishToken string,
) *DiscoveryHandler {
	return &DiscoveryHandler{
		repo:         repo,
		adminRepo:    adminRepo,
		redis:        rdb,
		publishToken: publishToken,
	}
}

// Register mounts all discovery routes on a single group.
// POST is protected by X-Publish-Token (handler-level auth).
func (h *DiscoveryHandler) Register(g *echo.Group) {
	g.POST("/upsert", h.Upsert)
	g.GET("/today", h.GetToday)
	g.GET("/history", h.GetHistory)
}

// Upsert handles POST /api/admin/discovery/upsert.
// Auth: X-Publish-Token header (no cookie/MFA required).
func (h *DiscoveryHandler) Upsert(c echo.Context) error {
	// Token auth.
	token := c.Request().Header.Get("X-Publish-Token")
	if h.publishToken == "" || token != h.publishToken {
		return c.JSON(http.StatusUnauthorized, map[string]string{"detail": "Invalid publish token"})
	}

	var req model.DiscoveryUpsertRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid JSON body"})
	}

	// Validation.
	if req.ScanDate == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "scan_date is required"})
	}
	if _, err := time.Parse("2006-01-02", req.ScanDate); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "scan_date must be YYYY-MM-DD"})
	}
	if len(req.Tickers) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "tickers must not be empty"})
	}

	ctx := c.Request().Context()

	count, err := h.repo.UpsertDiscovery(ctx, req.ScanDate, req.Tickers)
	if err != nil {
		slog.Error("discovery upsert failed", "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to upsert discovery data"})
	}

	// Invalidate cache.
	h.invalidateCache(ctx)

	// Audit log (fire-and-forget).
	go h.adminRepo.AuditLog(context.Background(),
		"cli-publish", "upsert_discovery", "discovered_stocks", req.ScanDate,
		nil, map[string]any{"count": count, "scan_date": req.ScanDate},
	)

	return c.JSON(http.StatusOK, map[string]any{
		"status":    "ok",
		"count":     count,
		"scan_date": req.ScanDate,
	})
}

// GetToday handles GET /api/discovery/today.
func (h *DiscoveryHandler) GetToday(c echo.Context) error {
	ctx := c.Request().Context()

	// Try Redis cache.
	if cached, err := h.redis.Get(ctx, discoveryCacheKeyDay).Result(); err == nil {
		c.Response().Header().Set("X-Cache", "HIT")
		return c.JSONBlob(http.StatusOK, []byte(cached))
	}

	stocks, err := h.repo.GetLatestDiscovery(ctx)
	if err != nil {
		slog.Error("discovery today query failed", "error", err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to get discovery data"})
	}

	if stocks == nil {
		stocks = []model.DiscoveredStock{}
	}

	resp := h.buildResponse(stocks)

	// Cache in Redis.
	if data, err := json.Marshal(resp); err == nil {
		_ = h.redis.Set(ctx, discoveryCacheKeyDay, data, discoveryCacheTTL).Err()
	}

	c.Response().Header().Set("X-Cache", "MISS")
	return c.JSON(http.StatusOK, resp)
}

// GetHistory handles GET /api/discovery/history?days=7.
func (h *DiscoveryHandler) GetHistory(c echo.Context) error {
	days := 7
	if d := c.QueryParam("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 && parsed <= 90 {
			days = parsed
		}
	}

	cacheKey := "discovery:history:" + strconv.Itoa(days)
	ctx := c.Request().Context()

	// Try Redis cache.
	if cached, err := h.redis.Get(ctx, cacheKey).Result(); err == nil {
		c.Response().Header().Set("X-Cache", "HIT")
		return c.JSONBlob(http.StatusOK, []byte(cached))
	}

	stocks, err := h.repo.GetDiscoveryHistory(ctx, days)
	if err != nil {
		slog.Error("discovery history query failed", "error", err, "days", days)
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to get discovery history"})
	}

	if stocks == nil {
		stocks = []model.DiscoveredStock{}
	}

	resp := map[string]any{
		"days":    days,
		"tickers": stocks,
		"total":   len(stocks),
	}

	if data, err := json.Marshal(resp); err == nil {
		_ = h.redis.Set(ctx, cacheKey, data, discoveryCacheTTL).Err()
	}

	c.Response().Header().Set("X-Cache", "MISS")
	return c.JSON(http.StatusOK, resp)
}

// buildResponse builds a DiscoveryResponse from stock rows.
func (h *DiscoveryHandler) buildResponse(stocks []model.DiscoveredStock) model.DiscoveryResponse {
	scanDate := ""
	if len(stocks) > 0 {
		scanDate = stocks[0].ScanDateStr
	}

	presetCounts := map[string]int{}
	for _, s := range stocks {
		for _, p := range s.Presets {
			presetCounts[p]++
		}
	}

	return model.DiscoveryResponse{
		ScanDate:       scanDate,
		PresetCounts:   presetCounts,
		TotalUnique:    len(stocks),
		AfterThreshold: len(stocks),
		Threshold:      1.5,
		Tickers:        stocks,
	}
}

// invalidateCache deletes discovery-related Redis keys.
func (h *DiscoveryHandler) invalidateCache(ctx context.Context) {
	_ = h.redis.Del(ctx, discoveryCacheKeyDay).Err()

	// Delete history keys (discovery:history:*).
	keys, err := h.redis.Keys(ctx, "discovery:history:*").Result()
	if err == nil && len(keys) > 0 {
		_ = h.redis.Del(ctx, keys...).Err()
	}
}
