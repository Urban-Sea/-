package handler

import (
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"

	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

var tradeTickerRE = regexp.MustCompile(`^[A-Z0-9.\-]{1,10}$`)

// TradesHandler handles /api/trades endpoints.
type TradesHandler struct {
	tradeRepo *repository.TradeRepository
}

// NewTradesHandler creates a new TradesHandler.
func NewTradesHandler(tradeRepo *repository.TradeRepository) *TradesHandler {
	return &TradesHandler{tradeRepo: tradeRepo}
}

// Register mounts all trade routes on the given Echo group.
func (h *TradesHandler) Register(g *echo.Group) {
	g.GET("", h.ListTrades)
	g.POST("", h.CreateTrade)
	g.GET("/stats", h.GetStats)
	g.POST("/sell-from-holding", h.SellFromHolding)
	g.GET("/:id", h.GetTrade)
	g.DELETE("/:id", h.DeleteTrade)
}

// ListTrades handles GET /api/trades.
func (h *TradesHandler) ListTrades(c echo.Context) error {
	userID := c.Get("user_id").(string)

	filter := repository.TradeListFilter{
		UserID: userID,
		Limit:  100,
	}

	if ticker := c.QueryParam("ticker"); ticker != "" {
		t := strings.ToUpper(ticker)
		filter.Ticker = &t
	}

	if action := c.QueryParam("action"); action != "" {
		a := strings.ToUpper(action)
		if a != "BUY" && a != "SELL" {
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "action must be BUY or SELL"})
		}
		filter.Action = &a
	}

	if limitStr := c.QueryParam("limit"); limitStr != "" {
		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit < 1 || limit > 500 {
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "limit must be between 1 and 500"})
		}
		filter.Limit = limit
	}

	trades, err := h.tradeRepo.List(c.Request().Context(), filter)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to list trades"})
	}
	if trades == nil {
		trades = []model.Trade{}
	}

	return c.JSON(http.StatusOK, trades)
}

// CreateTrade handles POST /api/trades.
func (h *TradesHandler) CreateTrade(c echo.Context) error {
	userID := c.Get("user_id").(string)

	var body struct {
		HoldingID      *string  `json:"holding_id"`
		Ticker         string   `json:"ticker"`
		Action         string   `json:"action"`
		Shares         float64  `json:"shares"`
		Price          float64  `json:"price"`
		Fees           float64  `json:"fees"`
		TradeDate      string   `json:"trade_date"`
		AccountType    *string  `json:"account_type"`
		Regime         *string  `json:"regime"`
		RSTrend        *string  `json:"rs_trend"`
		Reason         *string  `json:"reason"`
		LessonsLearned *string  `json:"lessons_learned"`
		ProfitLoss     *float64 `json:"profit_loss"`
		ProfitLossPct  *float64 `json:"profit_loss_pct"`
		HoldingDays    *int     `json:"holding_days"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	// Validate required fields.
	ticker := strings.ToUpper(strings.TrimSpace(body.Ticker))
	if !tradeTickerRE.MatchString(ticker) {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid ticker format"})
	}

	action := strings.ToUpper(strings.TrimSpace(body.Action))
	if action != "BUY" && action != "SELL" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "action must be BUY or SELL"})
	}

	if body.Shares <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "shares must be positive"})
	}
	if body.Price <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "price must be positive"})
	}

	tradeDate, err := time.Parse(time.RFC3339, body.TradeDate)
	if err != nil {
		// Try date-only format.
		tradeDate, err = time.Parse("2006-01-02", body.TradeDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "trade_date must be a valid date (RFC3339 or YYYY-MM-DD)"})
		}
	}

	// If holding_id provided, verify ownership.
	if body.HoldingID != nil && *body.HoldingID != "" {
		var ownerID string
		err := h.tradeRepo.Pool().QueryRow(c.Request().Context(),
			`SELECT user_id FROM holdings WHERE id = $1`, *body.HoldingID).Scan(&ownerID)
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"detail": "Holding not found"})
		}
		if ownerID != userID {
			return c.JSON(http.StatusForbidden, map[string]string{"detail": "Holding does not belong to you"})
		}
	}

	trade := &model.Trade{
		UserID:         userID,
		HoldingID:      body.HoldingID,
		Ticker:         ticker,
		Action:         action,
		Shares:         body.Shares,
		Price:          body.Price,
		Fees:           body.Fees,
		TradeDate:      tradeDate,
		AccountType:    body.AccountType,
		Regime:         body.Regime,
		RSTrend:        body.RSTrend,
		Reason:         body.Reason,
		LessonsLearned: body.LessonsLearned,
		ProfitLoss:     body.ProfitLoss,
		ProfitLossPct:  body.ProfitLossPct,
		HoldingDays:    body.HoldingDays,
	}

	created, err := h.tradeRepo.Create(c.Request().Context(), trade)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create trade"})
	}

	return c.JSON(http.StatusCreated, created)
}

// GetStats handles GET /api/trades/stats.
func (h *TradesHandler) GetStats(c echo.Context) error {
	userID := c.Get("user_id").(string)

	trades, err := h.tradeRepo.GetAllForStats(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to fetch trades"})
	}

	stats := computeStats(trades)
	return c.JSON(http.StatusOK, stats)
}

// SellFromHolding handles POST /api/trades/sell-from-holding.
func (h *TradesHandler) SellFromHolding(c echo.Context) error {
	userID := c.Get("user_id").(string)

	holdingID := c.QueryParam("holding_id")
	if holdingID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "holding_id is required"})
	}

	sharesStr := c.QueryParam("shares")
	shares, err := strconv.ParseFloat(sharesStr, 64)
	if err != nil || shares <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "shares must be a positive number"})
	}

	priceStr := c.QueryParam("price")
	price, err := strconv.ParseFloat(priceStr, 64)
	if err != nil || price <= 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "price must be a positive number"})
	}

	tradeDateStr := c.QueryParam("trade_date")
	tradeDate, err := time.Parse(time.RFC3339, tradeDateStr)
	if err != nil {
		tradeDate, err = time.Parse("2006-01-02", tradeDateStr)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "trade_date must be a valid date"})
		}
	}

	var fees float64
	if feesStr := c.QueryParam("fees"); feesStr != "" {
		fees, err = strconv.ParseFloat(feesStr, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"detail": "fees must be a number"})
		}
	}

	reason := c.QueryParam("reason")
	lessonsLearned := c.QueryParam("lessons_learned")

	ctx := c.Request().Context()
	pool := h.tradeRepo.Pool()

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to start transaction"})
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Read holding within TX.
	var holding model.HoldingRow
	err = tx.QueryRow(ctx,
		`SELECT id, user_id, ticker, shares, avg_price, entry_date FROM holdings WHERE id = $1 FOR UPDATE`,
		holdingID,
	).Scan(&holding.ID, &holding.UserID, &holding.Ticker, &holding.Shares, &holding.AvgPrice, &holding.EntryDate)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Holding not found"})
	}

	if holding.UserID != userID {
		return c.JSON(http.StatusForbidden, map[string]string{"detail": "Holding does not belong to you"})
	}

	if shares > holding.Shares {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"detail": fmt.Sprintf("Cannot sell %.4f shares, holding only has %.4f", shares, holding.Shares),
		})
	}

	// Calculate P&L.
	profitLoss := math.Round(((price-holding.AvgPrice)*shares-fees)*100) / 100
	profitLossPct := math.Round(((price/holding.AvgPrice)-1)*10000) / 100

	var holdingDays *int
	if holding.EntryDate != nil {
		days := int(tradeDate.Sub(*holding.EntryDate).Hours() / 24)
		holdingDays = &days
	}

	// Insert SELL trade.
	var trade model.Trade
	err = tx.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO trades (user_id, holding_id, ticker, action, shares, price, fees,
			trade_date, reason, lessons_learned, profit_loss, profit_loss_pct, holding_days)
		VALUES ($1, $2, $3, 'SELL', $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING %s`, tradeColumnsForScan),
		userID, holdingID, holding.Ticker, shares, price, fees,
		tradeDate, nilIfEmpty(reason), nilIfEmpty(lessonsLearned),
		profitLoss, profitLossPct, holdingDays,
	).Scan(
		&trade.ID, &trade.UserID, &trade.HoldingID, &trade.Ticker, &trade.Action,
		&trade.Shares, &trade.Price, &trade.Fees, &trade.TradeDate,
		&trade.AccountType, &trade.Regime, &trade.RSTrend, &trade.Reason,
		&trade.LessonsLearned, &trade.ProfitLoss, &trade.ProfitLossPct,
		&trade.HoldingDays, &trade.CreatedAt,
	)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to insert sell trade"})
	}

	// Update or delete holding.
	remaining := holding.Shares - shares
	if remaining <= 0 {
		_, err = tx.Exec(ctx, `DELETE FROM holdings WHERE id = $1`, holdingID)
	} else {
		_, err = tx.Exec(ctx, `UPDATE holdings SET shares = $1, updated_at = now() WHERE id = $2`, remaining, holdingID)
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to update holding"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to commit transaction"})
	}

	return c.JSON(http.StatusCreated, trade)
}

// GetTrade handles GET /api/trades/:id.
func (h *TradesHandler) GetTrade(c echo.Context) error {
	userID := c.Get("user_id").(string)
	tradeID := c.Param("id")

	trade, err := h.tradeRepo.GetByID(c.Request().Context(), tradeID, userID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Trade not found"})
	}

	return c.JSON(http.StatusOK, trade)
}

// DeleteTrade handles DELETE /api/trades/:id.
func (h *TradesHandler) DeleteTrade(c echo.Context) error {
	userID := c.Get("user_id").(string)
	tradeID := c.Param("id")

	deleted, err := h.tradeRepo.Delete(c.Request().Context(), tradeID, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to delete trade"})
	}
	if !deleted {
		return c.JSON(http.StatusNotFound, map[string]string{"detail": "Trade not found"})
	}

	return c.JSON(http.StatusOK, map[string]string{"status": "deleted"})
}

// ── Helpers ──

const tradeColumnsForScan = `id, user_id, holding_id, ticker, action, shares, price, fees,
	trade_date, account_type, regime, rs_trend, reason, lessons_learned,
	profit_loss, profit_loss_pct, holding_days, created_at`

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func computeStats(trades []model.Trade) model.TradeStats {
	stats := model.TradeStats{}
	stats.TotalTrades = len(trades)

	var totalProfit, totalLossAbs float64
	var profitCount, lossCount int

	for _, t := range trades {
		switch t.Action {
		case "BUY":
			stats.BuyCount++
		case "SELL":
			stats.SellCount++
		}

		if t.ProfitLoss != nil {
			pl := *t.ProfitLoss
			stats.TotalProfitLoss += pl
			if pl > 0 {
				stats.WinCount++
				totalProfit += pl
				profitCount++
			} else if pl < 0 {
				stats.LossCount++
				totalLossAbs += math.Abs(pl)
				lossCount++
			}
		}
	}

	sellsWithPL := stats.WinCount + stats.LossCount
	if sellsWithPL > 0 {
		stats.WinRate = math.Round(float64(stats.WinCount)/float64(sellsWithPL)*10000) / 100
	}
	if profitCount > 0 {
		stats.AvgProfit = math.Round(totalProfit/float64(profitCount)*100) / 100
	}
	if lossCount > 0 {
		stats.AvgLoss = math.Round(totalLossAbs/float64(lossCount)*100) / 100
	}
	if totalLossAbs > 0 {
		stats.ProfitFactor = math.Round(totalProfit/totalLossAbs*100) / 100
	}

	return stats
}
