package handler

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

var tickerRE = regexp.MustCompile(`^[A-Z0-9.\-]{1,10}$`)

// StocksHandler handles /api/stocks endpoints.
type StocksHandler struct {
	stockRepo *repository.StockRepository
}

// NewStocksHandler creates a new StocksHandler.
func NewStocksHandler(stockRepo *repository.StockRepository) *StocksHandler {
	return &StocksHandler{stockRepo: stockRepo}
}

// Register mounts all stock routes on the given Echo group.
func (h *StocksHandler) Register(g *echo.Group) {
	g.GET("", h.ListStocks)
	g.GET("/categories/list", h.ListCategories)
	g.GET("/:ticker", h.GetByTicker)
}

// ListStocks handles GET /api/stocks.
func (h *StocksHandler) ListStocks(c echo.Context) error {
	filter := repository.StockListFilter{
		// Default: active_only=true unless explicitly set to "false"
		ActiveOnly: c.QueryParam("active_only") != "false",
	}

	if cat := c.QueryParam("category"); cat != "" {
		filter.Category = &cat
	}
	if wl := c.QueryParam("watchlist"); wl != "" {
		filter.WatchlistCategory = &wl
	}

	stocks, err := h.stockRepo.List(c.Request().Context(), filter)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list stocks"})
	}
	if stocks == nil {
		stocks = []model.Stock{}
	}

	return c.JSON(http.StatusOK, model.StockListResponse{
		Stocks: stocks,
		Total:  len(stocks),
	})
}

// GetByTicker handles GET /api/stocks/:ticker.
func (h *StocksHandler) GetByTicker(c echo.Context) error {
	ticker := strings.ToUpper(c.Param("ticker"))

	if !tickerRE.MatchString(ticker) {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid ticker format"})
	}

	stock, err := h.stockRepo.FindByTicker(c.Request().Context(), ticker)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"detail": "Stock " + ticker + " not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to get stock"})
	}

	return c.JSON(http.StatusOK, stock)
}

// ListCategories handles GET /api/stocks/categories/list.
func (h *StocksHandler) ListCategories(c echo.Context) error {
	cats, err := h.stockRepo.GetCategories(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list categories"})
	}

	return c.JSON(http.StatusOK, cats)
}
