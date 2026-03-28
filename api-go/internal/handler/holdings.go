package handler

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
	"golang.org/x/sync/errgroup"

	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

var holdingTickerRE = regexp.MustCompile(`^[A-Z0-9.\-]{1,10}$`)

// HoldingsHandler handles /api/holdings endpoints.
type HoldingsHandler struct {
	holdingRepo  *repository.HoldingRepository
	cashRepo     *repository.CashRepository
	snapshotRepo *repository.SnapshotRepository
}

// NewHoldingsHandler creates a new HoldingsHandler.
func NewHoldingsHandler(
	holdingRepo *repository.HoldingRepository,
	cashRepo *repository.CashRepository,
	snapshotRepo *repository.SnapshotRepository,
) *HoldingsHandler {
	return &HoldingsHandler{
		holdingRepo:  holdingRepo,
		cashRepo:     cashRepo,
		snapshotRepo: snapshotRepo,
	}
}

// Register mounts all holding routes on the given Echo group.
// IMPORTANT: static routes must come before parameterized routes.
func (h *HoldingsHandler) Register(g *echo.Group) {
	g.GET("", h.ListHoldings)
	g.POST("", h.CreateHolding)
	g.GET("/init", h.Init)
	g.GET("/portfolio-history", h.PortfolioHistory)

	// Cash sub-routes
	g.GET("/cash", h.ListCash)
	g.POST("/cash", h.CreateCash)
	g.PUT("/cash/:id", h.UpdateCash)
	g.DELETE("/cash/:id", h.DeleteCash)

	// Parameterized routes LAST
	g.POST("/:id/add-shares", h.AddShares)
	g.GET("/:ticker", h.GetByTicker)
	g.PUT("/:id", h.UpdateHolding)
	g.DELETE("/:id", h.DeleteHolding)
}

// ListHoldings handles GET /api/holdings.
func (h *HoldingsHandler) ListHoldings(c echo.Context) error {
	userID := c.Get("user_id").(string)
	ctx := c.Request().Context()

	holdings, err := h.holdingRepo.ListByUser(ctx, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list holdings"})
	}
	if holdings == nil {
		holdings = []model.Holding{}
	}

	totalValue := 0.0
	for _, h := range holdings {
		totalValue += h.Shares * h.AvgPrice
	}

	return c.JSON(http.StatusOK, model.HoldingListResponse{
		Holdings:   holdings,
		Total:      len(holdings),
		TotalValue: totalValue,
	})
}

// CreateHolding handles POST /api/holdings.
func (h *HoldingsHandler) CreateHolding(c echo.Context) error {
	userID := c.Get("user_id").(string)

	var req model.CreateHoldingRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	req.Ticker = strings.ToUpper(strings.TrimSpace(req.Ticker))
	if req.Ticker == "" || req.Shares == 0 || req.AvgPrice == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "ticker, shares, and avg_price are required"})
	}
	if !holdingTickerRE.MatchString(req.Ticker) {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid ticker format"})
	}

	holding, err := h.holdingRepo.Create(c.Request().Context(), userID, req)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create holding"})
	}

	return c.JSON(http.StatusCreated, holding)
}

// Init handles GET /api/holdings/init.
// Fetches holdings, cash balances, and USD/JPY rate in parallel.
func (h *HoldingsHandler) Init(c echo.Context) error {
	userID := c.Get("user_id").(string)
	ctx := c.Request().Context()

	var (
		holdings []model.Holding
		balances []model.CashBalance
		fxRate   *float64
	)

	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error {
		var err error
		holdings, err = h.holdingRepo.ListByUser(gCtx, userID)
		return err
	})

	g.Go(func() error {
		var err error
		balances, err = h.cashRepo.ListByUser(gCtx, userID)
		return err
	})

	g.Go(func() error {
		var err error
		fxRate, err = h.snapshotRepo.GetLatestUSDJPY(gCtx)
		if err != nil {
			// Non-fatal: fx_rate can be nil
			fxRate = nil
			return nil
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to load init data"})
	}

	if holdings == nil {
		holdings = []model.Holding{}
	}
	if balances == nil {
		balances = []model.CashBalance{}
	}

	totalValue := 0.0
	for _, h := range holdings {
		totalValue += h.Shares * h.AvgPrice
	}

	cashTotal := 0.0
	for _, b := range balances {
		cashTotal += b.Amount
	}

	resp := model.HoldingsInitResponse{
		Holdings:   holdings,
		Total:      len(holdings),
		TotalValue: totalValue,
		FxRate:     fxRate,
	}
	resp.Cash.Balances = balances
	resp.Cash.Total = cashTotal

	return c.JSON(http.StatusOK, resp)
}

// PortfolioHistory handles GET /api/holdings/portfolio-history.
func (h *HoldingsHandler) PortfolioHistory(c echo.Context) error {
	userID := c.Get("user_id").(string)

	months := 24
	if m := c.QueryParam("months"); m != "" {
		parsed, err := strconv.Atoi(m)
		if err != nil || parsed < 1 || parsed > 120 {
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "months must be between 1 and 120"})
		}
		months = parsed
	}

	snapshots, err := h.snapshotRepo.ListByUser(c.Request().Context(), userID, months)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to load portfolio history"})
	}
	if snapshots == nil {
		snapshots = []model.PortfolioSnapshot{}
	}

	summary := map[string]interface{}{
		"count":  len(snapshots),
		"months": months,
	}

	return c.JSON(http.StatusOK, model.PortfolioHistoryResponse{
		History: snapshots,
		Summary: summary,
	})
}

// ListCash handles GET /api/holdings/cash.
func (h *HoldingsHandler) ListCash(c echo.Context) error {
	userID := c.Get("user_id").(string)

	balances, err := h.cashRepo.ListByUser(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list cash balances"})
	}
	if balances == nil {
		balances = []model.CashBalance{}
	}

	total := 0.0
	for _, b := range balances {
		total += b.Amount
	}

	return c.JSON(http.StatusOK, model.CashListResponse{
		Balances: balances,
		Total:    total,
	})
}

// CreateCash handles POST /api/holdings/cash.
func (h *HoldingsHandler) CreateCash(c echo.Context) error {
	userID := c.Get("user_id").(string)

	var req model.CreateCashBalanceRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	req.Label = strings.TrimSpace(req.Label)
	if req.Label == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "label is required"})
	}

	cb, err := h.cashRepo.Create(c.Request().Context(), userID, req)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create cash balance"})
	}

	return c.JSON(http.StatusCreated, cb)
}

// UpdateCash handles PUT /api/holdings/cash/:id.
func (h *HoldingsHandler) UpdateCash(c echo.Context) error {
	userID := c.Get("user_id").(string)
	cashID := c.Param("id")

	var req model.UpdateCashBalanceRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	cb, err := h.cashRepo.Update(c.Request().Context(), userID, cashID, req)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"detail": "Cash balance not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to update cash balance"})
	}

	return c.JSON(http.StatusOK, cb)
}

// DeleteCash handles DELETE /api/holdings/cash/:id.
func (h *HoldingsHandler) DeleteCash(c echo.Context) error {
	userID := c.Get("user_id").(string)
	cashID := c.Param("id")

	if err := h.cashRepo.Delete(c.Request().Context(), userID, cashID); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Cash balance not found"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "deleted"})
}

// AddShares handles POST /api/holdings/:id/add-shares.
func (h *HoldingsHandler) AddShares(c echo.Context) error {
	userID := c.Get("user_id").(string)
	holdingID := c.Param("id")

	sharesStr := c.QueryParam("shares")
	priceStr := c.QueryParam("price")

	if sharesStr == "" || priceStr == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "shares and price query params are required"})
	}

	shares, err := strconv.ParseFloat(sharesStr, 64)
	if err != nil || shares <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "shares must be a positive number"})
	}
	price, err := strconv.ParseFloat(priceStr, 64)
	if err != nil || price <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "price must be a positive number"})
	}

	holding, err := h.holdingRepo.AddShares(c.Request().Context(), userID, holdingID, shares, price)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"detail": "Holding not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to add shares"})
	}

	return c.JSON(http.StatusOK, holding)
}

// GetByTicker handles GET /api/holdings/:ticker.
func (h *HoldingsHandler) GetByTicker(c echo.Context) error {
	userID := c.Get("user_id").(string)
	ticker := strings.ToUpper(c.Param("ticker"))

	if !holdingTickerRE.MatchString(ticker) {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid ticker format"})
	}

	holding, err := h.holdingRepo.FindByTicker(c.Request().Context(), userID, ticker)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"detail": "Holding " + ticker + " not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to get holding"})
	}

	return c.JSON(http.StatusOK, holding)
}

// UpdateHolding handles PUT /api/holdings/:id.
func (h *HoldingsHandler) UpdateHolding(c echo.Context) error {
	userID := c.Get("user_id").(string)
	holdingID := c.Param("id")

	var req model.UpdateHoldingRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	holding, err := h.holdingRepo.Update(c.Request().Context(), userID, holdingID, req)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"detail": "Holding not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to update holding"})
	}

	return c.JSON(http.StatusOK, holding)
}

// DeleteHolding handles DELETE /api/holdings/:id.
func (h *HoldingsHandler) DeleteHolding(c echo.Context) error {
	userID := c.Get("user_id").(string)
	holdingID := c.Param("id")

	if err := h.holdingRepo.Delete(c.Request().Context(), userID, holdingID); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Holding not found"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "deleted"})
}
