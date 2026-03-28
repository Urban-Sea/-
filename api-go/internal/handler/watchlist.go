package handler

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

const maxTickersPerWatchlist = 50

// WatchlistHandler handles /api/watchlist endpoints.
type WatchlistHandler struct {
	repo *repository.WatchlistRepository
}

// NewWatchlistHandler creates a new WatchlistHandler.
func NewWatchlistHandler(repo *repository.WatchlistRepository) *WatchlistHandler {
	return &WatchlistHandler{repo: repo}
}

// List handles GET /api/watchlist — list user's watchlists.
func (h *WatchlistHandler) List(c echo.Context) error {
	userID := c.Get("user_id").(string)
	ctx := c.Request().Context()

	watchlists, err := h.repo.ListByUserID(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list watchlists"})
	}
	if watchlists == nil {
		watchlists = []model.Watchlist{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"watchlists": watchlists,
		"total":      len(watchlists),
	})
}

// Create handles POST /api/watchlist — create a new watchlist.
func (h *WatchlistHandler) Create(c echo.Context) error {
	userID := c.Get("user_id").(string)
	ctx := c.Request().Context()

	var body struct {
		Name      *string  `json:"name"`
		Tickers   []string `json:"tickers"`
		IsDefault *bool    `json:"is_default"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	name := "メイン"
	if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
		name = strings.TrimSpace(*body.Name)
	}

	tickers := validateTickers(body.Tickers, maxTickersPerWatchlist)

	isDefault := false
	if body.IsDefault != nil {
		isDefault = *body.IsDefault
	}

	wl, err := h.repo.Create(ctx, userID, name, tickers, isDefault)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create watchlist"})
	}

	return c.JSON(http.StatusCreated, wl)
}

// Get handles GET /api/watchlist/:id — get a single watchlist.
func (h *WatchlistHandler) Get(c echo.Context) error {
	userID := c.Get("user_id").(string)
	watchlistID := c.Param("id")
	ctx := c.Request().Context()

	wl, err := h.repo.FindByID(ctx, userID, watchlistID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Watchlist not found"})
	}

	return c.JSON(http.StatusOK, wl)
}

// Update handles PUT /api/watchlist/:id — update a watchlist.
func (h *WatchlistHandler) Update(c echo.Context) error {
	userID := c.Get("user_id").(string)
	watchlistID := c.Param("id")
	ctx := c.Request().Context()

	var body struct {
		Name      *string  `json:"name"`
		Tickers   []string `json:"tickers"`
		IsDefault *bool    `json:"is_default"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	// Check if there's anything to update.
	if body.Name == nil && body.Tickers == nil && body.IsDefault == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "No update data"})
	}

	var validatedTickers []string
	if body.Tickers != nil {
		validatedTickers = validateTickers(body.Tickers, maxTickersPerWatchlist)
	}

	wl, err := h.repo.Update(ctx, userID, watchlistID, body.Name, validatedTickers, body.IsDefault)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Watchlist not found"})
	}

	return c.JSON(http.StatusOK, wl)
}

// Delete handles DELETE /api/watchlist/:id — delete a watchlist.
func (h *WatchlistHandler) Delete(c echo.Context) error {
	userID := c.Get("user_id").(string)
	watchlistID := c.Param("id")
	ctx := c.Request().Context()

	deleted, err := h.repo.Delete(ctx, userID, watchlistID)
	if err != nil || !deleted {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Watchlist not found"})
	}

	return c.JSON(http.StatusOK, map[string]string{
		"status": "deleted",
		"id":     watchlistID,
	})
}

// ModifyTicker handles POST /api/watchlist/:id/tickers — add or remove a ticker.
func (h *WatchlistHandler) ModifyTicker(c echo.Context) error {
	userID := c.Get("user_id").(string)
	watchlistID := c.Param("id")
	ctx := c.Request().Context()

	var body struct {
		Action string `json:"action"`
		Ticker string `json:"ticker"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	ticker := strings.ToUpper(strings.TrimSpace(body.Ticker))
	if !tickerRE.MatchString(ticker) {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid ticker"})
	}

	action := strings.ToLower(strings.TrimSpace(body.Action))
	if action != "add" && action != "remove" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "action must be \"add\" or \"remove\""})
	}

	// If watchlistID is "default", find or create the default watchlist.
	if watchlistID == "default" {
		wl, err := h.repo.FindDefault(ctx, userID)
		if err != nil {
			// Auto-create default watchlist.
			if action == "add" {
				created, createErr := h.repo.Create(ctx, userID, "メイン", []string{ticker}, true)
				if createErr != nil {
					return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create default watchlist"})
				}
				return c.JSON(http.StatusOK, map[string]any{"tickers": created.Tickers})
			}
			return c.JSON(http.StatusOK, map[string]any{"tickers": []string{}})
		}
		watchlistID = wl.ID
	}

	// Fetch current watchlist.
	wl, err := h.repo.FindByID(ctx, userID, watchlistID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Watchlist not found"})
	}

	tickers := wl.Tickers
	if tickers == nil {
		tickers = []string{}
	}

	switch action {
	case "add":
		// Check duplicate.
		for _, t := range tickers {
			if t == ticker {
				return c.JSON(http.StatusOK, map[string]any{"tickers": tickers})
			}
		}
		if len(tickers) >= maxTickersPerWatchlist {
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Maximum 50 tickers per watchlist"})
		}
		tickers = append(tickers, ticker)

	case "remove":
		filtered := make([]string, 0, len(tickers))
		for _, t := range tickers {
			if t != ticker {
				filtered = append(filtered, t)
			}
		}
		tickers = filtered
	}

	if err := h.repo.UpdateTickers(ctx, userID, watchlistID, tickers); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to update tickers"})
	}

	return c.JSON(http.StatusOK, map[string]any{"tickers": tickers})
}

// validateTickers normalises and filters a ticker list.
func validateTickers(raw []string, max int) []string {
	seen := make(map[string]bool, len(raw))
	result := make([]string, 0, len(raw))
	for _, t := range raw {
		upper := strings.ToUpper(strings.TrimSpace(t))
		if tickerRE.MatchString(upper) && !seen[upper] {
			seen[upper] = true
			result = append(result, upper)
			if len(result) >= max {
				break
			}
		}
	}
	return result
}
