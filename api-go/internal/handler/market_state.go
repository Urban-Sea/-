package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

// MarketStateHandler handles /api/market-state endpoints.
type MarketStateHandler struct {
	repo *repository.MarketStateRepository
}

// NewMarketStateHandler creates a new MarketStateHandler.
func NewMarketStateHandler(repo *repository.MarketStateRepository) *MarketStateHandler {
	return &MarketStateHandler{repo: repo}
}

// List handles GET /api/market-state.
func (h *MarketStateHandler) List(c echo.Context) error {
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 {
		limit = 30
	}
	if limit > 365 {
		limit = 365
	}

	offset, _ := strconv.Atoi(c.QueryParam("offset"))
	if offset < 0 {
		offset = 0
	}

	records, total, err := h.repo.List(c.Request().Context(), limit, offset)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to fetch market state"})
	}

	return c.JSON(http.StatusOK, model.MarketStateListResponse{
		Records: records,
		Total:   total,
	})
}

// GetLatest handles GET /api/market-state/latest.
func (h *MarketStateHandler) GetLatest(c echo.Context) error {
	state, err := h.repo.GetLatest(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "No market state data found"})
	}
	return c.JSON(http.StatusOK, state)
}

// Create handles POST /api/market-state.
func (h *MarketStateHandler) Create(c echo.Context) error {
	var body model.CreateMarketStateRequest
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	if body.Date == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "date is required"})
	}
	if body.State == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "state is required"})
	}

	state, err := h.repo.Create(c.Request().Context(), body)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create market state"})
	}

	return c.JSON(http.StatusCreated, map[string]any{"status": "success", "id": state.ID})
}
