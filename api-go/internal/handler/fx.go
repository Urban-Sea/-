package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
)

const (
	fxCacheTTL = 5 * time.Minute
	fxCacheKey = "fx:usdjpy"
	yfChartURL = "https://query1.finance.yahoo.com/v8/finance/chart/JPY=X?range=1d&interval=1d"
)

// fxCacheEntry is the structure stored in Redis.
type fxCacheEntry struct {
	Rate      float64 `json:"rate"`
	UpdatedAt string  `json:"updated_at"`
}

// fxResponse is the JSON response for GET /api/fx/usdjpy.
type fxResponse struct {
	Rate      float64 `json:"rate"`
	Cached    bool    `json:"cached"`
	UpdatedAt string  `json:"updated_at"`
}

// yfChartResponse represents the Yahoo Finance chart API response (minimal).
type yfChartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				RegularMarketPrice float64 `json:"regularMarketPrice"`
			} `json:"meta"`
		} `json:"result"`
	} `json:"chart"`
}

// FXHandler handles /api/fx endpoints.
type FXHandler struct {
	redis      *redis.Client
	httpClient *http.Client
}

// NewFXHandler creates a new FXHandler.
func NewFXHandler(redisClient *redis.Client) *FXHandler {
	return &FXHandler{
		redis: redisClient,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// GetUSDJPY handles GET /api/fx/usdjpy.
func (h *FXHandler) GetUSDJPY(c echo.Context) error {
	ctx := c.Request().Context()

	// 1. Try Redis cache.
	cached, err := h.getCache(ctx)
	if err == nil {
		return c.JSON(http.StatusOK, fxResponse{
			Rate:      cached.Rate,
			Cached:    true,
			UpdatedAt: cached.UpdatedAt,
		})
	}

	// 2. Fetch from Yahoo Finance.
	rate, err := h.fetchRate()
	if err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{
			"detail": "Failed to fetch USD/JPY rate",
		})
	}

	// 3. Store in Redis (best-effort).
	now := time.Now().UTC().Format(time.RFC3339)
	entry := fxCacheEntry{Rate: rate, UpdatedAt: now}
	_ = h.setCache(ctx, &entry)

	return c.JSON(http.StatusOK, fxResponse{
		Rate:      rate,
		Cached:    false,
		UpdatedAt: now,
	})
}

// getCache retrieves the cached FX entry from Redis.
func (h *FXHandler) getCache(ctx context.Context) (*fxCacheEntry, error) {
	val, err := h.redis.Get(ctx, fxCacheKey).Result()
	if err != nil {
		return nil, err
	}
	var entry fxCacheEntry
	if err := json.Unmarshal([]byte(val), &entry); err != nil {
		return nil, err
	}
	return &entry, nil
}

// setCache stores the FX entry in Redis with TTL.
func (h *FXHandler) setCache(ctx context.Context, entry *fxCacheEntry) error {
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	return h.redis.Set(ctx, fxCacheKey, data, fxCacheTTL).Err()
}

// fetchRate calls the Yahoo Finance chart API and returns the USD/JPY rate.
func (h *FXHandler) fetchRate() (float64, error) {
	req, err := http.NewRequest(http.MethodGet, yfChartURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("yahoo finance returned %d: %s", resp.StatusCode, body)
	}

	var chart yfChartResponse
	if err := json.NewDecoder(resp.Body).Decode(&chart); err != nil {
		return 0, fmt.Errorf("decode yahoo finance response: %w", err)
	}

	if len(chart.Chart.Result) == 0 {
		return 0, fmt.Errorf("no results in yahoo finance response")
	}

	price := chart.Chart.Result[0].Meta.RegularMarketPrice
	// Round to 2 decimal places (same as TS: Math.round(price * 100) / 100).
	rate := math.Round(price*100) / 100
	return rate, nil
}
