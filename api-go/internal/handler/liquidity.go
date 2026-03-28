package handler

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/sync/errgroup"

	"github.com/open-regime/api-go/internal/analysis"
	"github.com/open-regime/api-go/internal/repository"
)

// LiquidityHandler handles /api/liquidity/* endpoints.
type LiquidityHandler struct {
	repo *repository.LiquidityRepository
}

// NewLiquidityHandler creates a new LiquidityHandler.
func NewLiquidityHandler(repo *repository.LiquidityRepository) *LiquidityHandler {
	return &LiquidityHandler{repo: repo}
}

// Register mounts all liquidity routes on the given Echo groups.
// publicGroup has no auth; authGroup requires auth.
func (h *LiquidityHandler) Register(publicGroup, authGroup *echo.Group) {
	// CRUD (public)
	publicGroup.GET("/fed-balance-sheet", h.GetFedBalanceSheet)
	publicGroup.GET("/interest-rates", h.GetInterestRates)
	publicGroup.GET("/credit-spreads", h.GetCreditSpreads)
	publicGroup.GET("/market-indicators", h.GetMarketIndicators)

	// CRUD (auth required)
	authGroup.POST("/margin-debt", h.UpsertMarginDebt)

	// Calculation endpoints (public)
	publicGroup.GET("/overview", h.GetOverview)
	publicGroup.GET("/plumbing-summary", h.GetPlumbingSummary)
	publicGroup.GET("/events", h.GetEvents)
	publicGroup.GET("/policy-regime", h.GetPolicyRegime)
	publicGroup.GET("/history-charts", h.GetHistoryCharts)
	publicGroup.GET("/backtest-states", h.GetBacktestStates)
}

// ============================================================
// CRUD Endpoints
// ============================================================

func parseLimitFromCtx(c echo.Context, defaultVal, maxVal int) int {
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit <= 0 {
		limit = defaultVal
	}
	if limit > maxVal {
		limit = maxVal
	}
	return limit
}

// GetFedBalanceSheet handles GET /api/liquidity/fed-balance-sheet.
func (h *LiquidityHandler) GetFedBalanceSheet(c echo.Context) error {
	limit := parseLimitFromCtx(c, 30, 500)
	rows, err := h.repo.ListFedBalanceSheet(c.Request().Context(), limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Failed to fetch fed balance sheet"))
	}
	return c.JSON(http.StatusOK, map[string]any{"data": rows, "count": len(rows)})
}

// GetInterestRates handles GET /api/liquidity/interest-rates.
func (h *LiquidityHandler) GetInterestRates(c echo.Context) error {
	limit := parseLimitFromCtx(c, 30, 500)
	rows, err := h.repo.ListInterestRates(c.Request().Context(), limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Failed to fetch interest rates"))
	}
	return c.JSON(http.StatusOK, map[string]any{"data": rows, "count": len(rows)})
}

// GetCreditSpreads handles GET /api/liquidity/credit-spreads.
func (h *LiquidityHandler) GetCreditSpreads(c echo.Context) error {
	limit := parseLimitFromCtx(c, 30, 500)
	rows, err := h.repo.ListCreditSpreads(c.Request().Context(), limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Failed to fetch credit spreads"))
	}
	return c.JSON(http.StatusOK, map[string]any{"data": rows, "count": len(rows)})
}

// GetMarketIndicators handles GET /api/liquidity/market-indicators.
func (h *LiquidityHandler) GetMarketIndicators(c echo.Context) error {
	limit := parseLimitFromCtx(c, 30, 500)
	rows, err := h.repo.ListMarketIndicators(c.Request().Context(), limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Failed to fetch market indicators"))
	}
	return c.JSON(http.StatusOK, map[string]any{"data": rows, "count": len(rows)})
}

// UpsertMarginDebt handles POST /api/liquidity/margin-debt.
func (h *LiquidityHandler) UpsertMarginDebt(c echo.Context) error {
	var body struct {
		Date         string   `json:"date"`
		DebitBalance float64  `json:"debit_balance"`
		FreeCredit   *float64 `json:"free_credit"`
	}
	if err := c.Bind(&body); err != nil {
		return c.JSON(http.StatusBadRequest, errDetail("Invalid request body"))
	}
	if body.Date == "" {
		return c.JSON(http.StatusBadRequest, errDetail("date is required"))
	}

	ctx := c.Request().Context()

	// Convert from millions to dollars.
	debitDollars := body.DebitBalance * 1_000_000

	// Calculate 2-year change.
	twoYearsAgo := body.Date[:4]
	twoYearInt, _ := strconv.Atoi(twoYearsAgo)
	twoYearsAgoDate := fmt.Sprintf("%d%s", twoYearInt-2, body.Date[4:])

	var change2y *float64
	prev, err := h.repo.GetMarginDebtBefore(ctx, twoYearsAgoDate)
	if err == nil && prev != nil && prev.DebitBalance != nil && *prev.DebitBalance != 0 {
		v := ((debitDollars - *prev.DebitBalance) / *prev.DebitBalance) * 100
		change2y = &v
	}

	// Convert free_credit to dollars too.
	var freeCreditDollars *float64
	if body.FreeCredit != nil {
		v := *body.FreeCredit * 1_000_000
		freeCreditDollars = &v
	}

	if err := h.repo.UpsertMarginDebt(ctx, body.Date, debitDollars, freeCreditDollars, change2y); err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Failed to upsert margin debt"))
	}

	var roundedChange *float64
	if change2y != nil {
		v := math.Round(*change2y*100) / 100
		roundedChange = &v
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":        "ok",
		"date":          body.Date,
		"debit_balance": debitDollars,
		"change_2y":     roundedChange,
	})
}

// ============================================================
// Calculation Endpoints
// ============================================================

// GetOverview handles GET /api/liquidity/overview.
func (h *LiquidityHandler) GetOverview(c echo.Context) error {
	ctx := c.Request().Context()
	g, gctx := errgroup.WithContext(ctx)

	var fedRows []struct {
		Date       string   `json:"date" db:"date"`
		Reserves   *float64 `json:"reserves" db:"reserves"`
		RRP        *float64 `json:"rrp" db:"rrp"`
		TGA        *float64 `json:"tga" db:"tga"`
		SOMAAssets *float64 `json:"soma_assets" db:"soma_assets"`
	}
	var ratesRows []struct {
		Date           string   `json:"date" db:"date"`
		FedFunds       *float64 `json:"fed_funds" db:"fed_funds"`
		Treasury2Y     *float64 `json:"treasury_2y" db:"treasury_2y"`
		Treasury10Y    *float64 `json:"treasury_10y" db:"treasury_10y"`
		TreasurySpread *float64 `json:"treasury_spread" db:"treasury_spread"`
	}
	var spreadsRows []struct {
		Date     string   `json:"date" db:"date"`
		HYSpread *float64 `json:"hy_spread" db:"hy_spread"`
		IGSpread *float64 `json:"ig_spread" db:"ig_spread"`
		TEDSpread *float64 `json:"ted_spread" db:"ted_spread"`
	}
	var indicatorRows []struct {
		Date  string   `json:"date" db:"date"`
		VIX   *float64 `json:"vix" db:"vix"`
		DXY   *float64 `json:"dxy" db:"dxy"`
		SP500 *float64 `json:"sp500" db:"sp500"`
		NASDAQ *float64 `json:"nasdaq" db:"nasdaq"`
	}

	// Use the generic model types via repo calls — but for overview we only need 1 row.
	// Re-use repo methods.
	g.Go(func() error {
		rows, err := h.repo.ListFedBalanceSheet(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			fedRows = append(fedRows, struct {
				Date       string   `json:"date" db:"date"`
				Reserves   *float64 `json:"reserves" db:"reserves"`
				RRP        *float64 `json:"rrp" db:"rrp"`
				TGA        *float64 `json:"tga" db:"tga"`
				SOMAAssets *float64 `json:"soma_assets" db:"soma_assets"`
			}{r.Date.String(), r.Reserves, r.RRP, r.TGA, r.SOMAAssets})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListInterestRates(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			ratesRows = append(ratesRows, struct {
				Date           string   `json:"date" db:"date"`
				FedFunds       *float64 `json:"fed_funds" db:"fed_funds"`
				Treasury2Y     *float64 `json:"treasury_2y" db:"treasury_2y"`
				Treasury10Y    *float64 `json:"treasury_10y" db:"treasury_10y"`
				TreasurySpread *float64 `json:"treasury_spread" db:"treasury_spread"`
			}{r.Date.String(), r.FedFunds, r.Treasury2Y, r.Treasury10Y, r.TreasurySpread})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListCreditSpreads(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			spreadsRows = append(spreadsRows, struct {
				Date     string   `json:"date" db:"date"`
				HYSpread *float64 `json:"hy_spread" db:"hy_spread"`
				IGSpread *float64 `json:"ig_spread" db:"ig_spread"`
				TEDSpread *float64 `json:"ted_spread" db:"ted_spread"`
			}{r.Date.String(), r.HYSpread, r.IGSpread, r.TEDSpread})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMarketIndicators(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			indicatorRows = append(indicatorRows, struct {
				Date  string   `json:"date" db:"date"`
				VIX   *float64 `json:"vix" db:"vix"`
				DXY   *float64 `json:"dxy" db:"dxy"`
				SP500 *float64 `json:"sp500" db:"sp500"`
				NASDAQ *float64 `json:"nasdaq" db:"nasdaq"`
			}{r.Date.String(), r.VIX, r.DXY, r.SP500, r.NASDAQ})
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Internal server error"))
	}

	// Stress determination
	var stressFactors []string
	stressLevel := 0

	if len(indicatorRows) > 0 && indicatorRows[0].VIX != nil {
		vix := *indicatorRows[0].VIX
		if vix > 30 {
			stressFactors = append(stressFactors, fmt.Sprintf("VIX高水準: %.2f", vix))
			stressLevel += 2
		} else if vix > 20 {
			stressFactors = append(stressFactors, fmt.Sprintf("VIX警戒水準: %.2f", vix))
			stressLevel += 1
		}
	}
	if len(spreadsRows) > 0 && spreadsRows[0].HYSpread != nil {
		hy := *spreadsRows[0].HYSpread
		if hy > 5 {
			stressFactors = append(stressFactors, fmt.Sprintf("HYスプレッド拡大: %.2f%%", hy))
			stressLevel += 2
		} else if hy > 4 {
			stressFactors = append(stressFactors, fmt.Sprintf("HYスプレッド警戒: %.2f%%", hy))
			stressLevel += 1
		}
	}
	if len(ratesRows) > 0 && ratesRows[0].TreasurySpread != nil {
		spread := *ratesRows[0].TreasurySpread
		if spread < 0 {
			stressFactors = append(stressFactors, fmt.Sprintf("イールドカーブ逆転: %.2f%%", spread))
			stressLevel += 2
		}
	}

	liquidityStress := "Low"
	if stressLevel >= 4 {
		liquidityStress = "High"
	} else if stressLevel >= 2 {
		liquidityStress = "Medium"
	}

	if stressFactors == nil {
		stressFactors = []string{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"fed_balance_sheet":  firstOrNil(fedRows),
		"interest_rates":     firstOrNil(ratesRows),
		"credit_spreads":     firstOrNil(spreadsRows),
		"market_indicators":  firstOrNil(indicatorRows),
		"liquidity_stress":   liquidityStress,
		"stress_factors":     stressFactors,
	})
}

// GetPlumbingSummary handles GET /api/liquidity/plumbing-summary.
func (h *LiquidityHandler) GetPlumbingSummary(c echo.Context) error {
	ctx := c.Request().Context()
	g, gctx := errgroup.WithContext(ctx)

	type fedRow = struct {
		Date       string
		Reserves   *float64
		RRP        *float64
		TGA        *float64
		SOMAAssets *float64
	}

	var (
		fedAll     []fedRow
		fedLatest  []fedRow
		indicators []struct {
			Date  string
			VIX   *float64
			DXY   *float64
			SP500 *float64
		}
		kreRows    []struct{ KRE52WChange *float64 }
		srfRows    []struct{ Date string; Amount *float64 }
		spreadsRow []struct{ HYSpread *float64; IGSpread *float64 }
		ratesRow   []struct {
			Date           string
			FedFunds       *float64
			TreasurySpread *float64
		}
		marginRows []struct {
			Date         string
			DebitBalance *float64
			Change2Y     *float64
		}
		mmfRows []struct{ Change3M *float64 }
	)

	// 9 parallel queries
	g.Go(func() error {
		rows, err := h.repo.ListFedBalanceSheetAsc(gctx)
		if err != nil {
			return err
		}
		for _, r := range rows {
			fedAll = append(fedAll, fedRow{r.Date.String(), r.Reserves, r.RRP, r.TGA, r.SOMAAssets})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListFedBalanceSheet(gctx, 30)
		if err != nil {
			return err
		}
		for _, r := range rows {
			fedLatest = append(fedLatest, fedRow{r.Date.String(), r.Reserves, r.RRP, r.TGA, r.SOMAAssets})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMarketIndicators(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			indicators = append(indicators, struct {
				Date  string
				VIX   *float64
				DXY   *float64
				SP500 *float64
			}{r.Date.String(), r.VIX, r.DXY, r.SP500})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListBankSectorDesc(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			kreRows = append(kreRows, struct{ KRE52WChange *float64 }{r.KRE52WChange})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListSRFUsageDesc(gctx, 90)
		if err != nil {
			return err
		}
		for _, r := range rows {
			amt := r.Amount
			srfRows = append(srfRows, struct{ Date string; Amount *float64 }{r.Date.String(), amt})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListCreditSpreads(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			spreadsRow = append(spreadsRow, struct{ HYSpread *float64; IGSpread *float64 }{r.HYSpread, r.IGSpread})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListInterestRates(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			ratesRow = append(ratesRow, struct {
				Date           string
				FedFunds       *float64
				TreasurySpread *float64
			}{r.Date.String(), r.FedFunds, r.TreasurySpread})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMarginDebt(gctx, 2)
		if err != nil {
			return err
		}
		for _, r := range rows {
			marginRows = append(marginRows, struct {
				Date         string
				DebitBalance *float64
				Change2Y     *float64
			}{r.Date.String(), r.DebitBalance, r.Change2Y})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMMFAssetsDesc(gctx, 1)
		if err != nil {
			return err
		}
		for _, r := range rows {
			mmfRows = append(mmfRows, struct{ Change3M *float64 }{r.Change3M})
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Internal server error"))
	}

	result := map[string]any{
		"timestamp": time.Now().Format(time.RFC3339),
		"layers": map[string]any{
			"layer1":  nil,
			"layer2a": nil,
			"layer2b": nil,
		},
		"credit_pressure":  nil,
		"market_state":     nil,
		"market_indicators": nil,
	}

	if len(indicators) > 0 {
		result["market_indicators"] = indicators[0]
	}

	// Margin 1Y lookup (separate query after initial parallel batch)
	var margin1yBalance *float64
	if len(marginRows) > 0 {
		latestDate := marginRows[0].Date
		oneYearAgoDate := subtractYears(latestDate, 1)
		prev, err := h.repo.GetMarginDebtBefore(ctx, oneYearAgoDate)
		if err == nil && prev != nil {
			margin1yBalance = prev.DebitBalance
		}
	}

	// Layer 1: Policy Liquidity
	var l1Result *analysis.Layer1Result
	if len(fedAll) > 0 {
		var historicalValues []float64
		for _, row := range fedAll {
			if row.SOMAAssets != nil && row.RRP != nil && row.TGA != nil {
				historicalValues = append(historicalValues, *row.SOMAAssets-*row.RRP-*row.TGA)
			}
		}
		if len(historicalValues) > 0 {
			currentNL := historicalValues[len(historicalValues)-1]
			l1 := analysis.CalculateLayer1Stress(currentNL, historicalValues, 520)
			l1Result = &l1

			// Add fed_data with forward-fill
			if len(fedLatest) > 0 {
				fedData := map[string]any{
					"date":        fedLatest[0].Date,
					"soma_assets": forwardFill(fedLatest, func(r fedRow) *float64 { return r.SOMAAssets }),
					"reserves":    forwardFill(fedLatest, func(r fedRow) *float64 { return r.Reserves }),
					"rrp":         forwardFill(fedLatest, func(r fedRow) *float64 { return r.RRP }),
					"tga":         forwardFill(fedLatest, func(r fedRow) *float64 { return r.TGA }),
				}
				l1Map := map[string]any{
					"stress_score":    l1.StressScore,
					"z_score":         l1.ZScore,
					"net_liquidity":   l1.NetLiquidity,
					"interpretation":  l1.Interpretation,
					"fed_data":        fedData,
				}
				layers := result["layers"].(map[string]any)
				layers["layer1"] = l1Map
			}
		}
	}

	// Layer 2A: Banking System
	var reservesChangeMoM *float64
	var reservesValue *float64
	if len(fedLatest) > 0 {
		current := findNthNonNull(fedLatest, func(r fedRow) *float64 { return r.Reserves }, 0)
		previous := findNthNonNull(fedLatest, func(r fedRow) *float64 { return r.Reserves }, 1)
		reservesValue = current
		if current != nil && previous != nil && *previous != 0 {
			v := ((*current - *previous) / *previous) * 100
			reservesChangeMoM = &v
		}
	}

	var kre52wChange *float64
	if len(kreRows) > 0 {
		kre52wChange = kreRows[0].KRE52WChange
	}

	// SRF aggregation
	srfUsage30d := 0.0
	srfDays30d := 0
	srfDays90d := 0
	today := time.Now()
	for _, row := range srfRows {
		amount := 0.0
		if row.Amount != nil {
			amount = *row.Amount
		}
		rowDate, err := time.Parse("2006-01-02", row.Date)
		if err != nil {
			continue
		}
		daysDiff := int(today.Sub(rowDate).Hours() / 24)
		if daysDiff <= 30 {
			srfUsage30d += amount
			if amount > 0 {
				srfDays30d++
			}
		}
		if amount > 0 {
			srfDays90d++
		}
	}

	var igSpread *float64
	if len(spreadsRow) > 0 {
		igSpread = spreadsRow[0].IGSpread
	}

	l2a := analysis.CalculateLayer2AStress(
		reservesChangeMoM,
		kre52wChange,
		&srfUsage30d,
		igSpread,
		&srfDays30d,
		&srfDays90d,
	)
	l2a.Components["reserves_value"] = reservesValue
	layers := result["layers"].(map[string]any)
	layers["layer2a"] = l2a

	// Layer 2B: Risk Appetite
	var l2bResult *analysis.Layer2BResult
	if len(marginRows) > 0 && marginRows[0].Change2Y != nil {
		change2y := *marginRows[0].Change2Y

		// 1Y change calculation
		var change1y *float64
		if margin1yBalance != nil && marginRows[0].DebitBalance != nil && *margin1yBalance != 0 {
			v := ((*marginRows[0].DebitBalance - *margin1yBalance) / *margin1yBalance) * 100
			change1y = &v
		}

		var mmfChange *float64
		if len(mmfRows) > 0 {
			mmfChange = mmfRows[0].Change3M
		}

		var vix *float64
		if len(indicators) > 0 {
			vix = indicators[0].VIX
		}

		l2b := analysis.CalculateLayer2BStress(change2y, change1y, mmfChange, vix)
		l2b.Components["data_date"] = marginRows[0].Date
		l2bResult = &l2b
		layers["layer2b"] = l2b
	}

	// Credit Pressure
	var hySpread *float64
	var yieldCurve *float64
	var dxy *float64
	if len(spreadsRow) > 0 {
		hySpread = spreadsRow[0].HYSpread
	}
	if len(ratesRow) > 0 {
		yieldCurve = ratesRow[0].TreasurySpread
	}
	if len(indicators) > 0 {
		dxy = indicators[0].DXY
	}
	credit := analysis.CalculateCreditPressure(hySpread, igSpread, yieldCurve, dxy)
	result["credit_pressure"] = credit

	// Market State
	if l1Result != nil && l2bResult != nil {
		interpType := l2a.InterpretationType
		ms := analysis.DetermineMarketState(
			l1Result.StressScore,
			l2a.StressScore,
			l2bResult.StressScore,
			&interpType,
		)
		result["market_state"] = ms
	}

	// Extra data for frontend
	if len(ratesRow) > 0 {
		result["interest_rates"] = ratesRow[0]
	}
	if len(spreadsRow) > 0 {
		result["credit_spreads"] = spreadsRow[0]
	}

	return c.JSON(http.StatusOK, result)
}

// GetEvents handles GET /api/liquidity/events.
func (h *LiquidityHandler) GetEvents(c echo.Context) error {
	ctx := c.Request().Context()
	g, gctx := errgroup.WithContext(ctx)

	type fedR struct {
		Date       string
		Reserves   *float64
		RRP        *float64
		TGA        *float64
		SOMAAssets *float64
	}
	type bankR struct {
		Date     string
		KREClose *float64
	}
	type mktR struct {
		Date string
		VIX  *float64
	}
	type sprdR struct {
		Date     string
		HYSpread *float64
		IGSpread *float64
	}

	var fed []fedR
	var bank []bankR
	var mkt []mktR
	var sprd []sprdR

	g.Go(func() error {
		rows, err := h.repo.ListFedBalanceSheet(gctx, 100)
		if err != nil {
			return err
		}
		for _, r := range rows {
			fed = append(fed, fedR{r.Date.String(), r.Reserves, r.RRP, r.TGA, r.SOMAAssets})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListBankSectorDesc(gctx, 45)
		if err != nil {
			return err
		}
		for _, r := range rows {
			bank = append(bank, bankR{r.Date.String(), r.KREClose})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMarketIndicators(gctx, 23)
		if err != nil {
			return err
		}
		for _, r := range rows {
			mkt = append(mkt, mktR{r.Date.String(), r.VIX})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListCreditSpreads(gctx, 23)
		if err != nil {
			return err
		}
		for _, r := range rows {
			sprd = append(sprd, sprdR{r.Date.String(), r.HYSpread, r.IGSpread})
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Internal server error"))
	}

	// Filter weekly rows (SOMA non-null) for net liquidity
	var fedSomaRows []fedR
	for _, r := range fed {
		if r.SOMAAssets != nil {
			fedSomaRows = append(fedSomaRows, r)
		}
	}

	// Reserves change
	reservesChange1m := analysis.PctChange(
		findNthNonNull(fed, func(r fedR) *float64 { return r.Reserves }, 0),
		findNthNonNull(fed, func(r fedR) *float64 { return r.Reserves }, 1),
	)
	reservesChange1w := reservesChange1m // reserves are weekly

	// Net Liquidity change
	netLiqVal := func(rows []fedR, idx int) *float64 {
		if idx >= len(rows) {
			return nil
		}
		s := rows[idx].SOMAAssets
		r := rows[idx].RRP
		t := rows[idx].TGA
		if s == nil || t == nil {
			return nil
		}
		rrp := 0.0
		if r != nil {
			rrp = *r
		}
		v := *s - rrp - *t
		return &v
	}
	nlNow := netLiqVal(fedSomaRows, 0)
	nl1m := netLiqVal(fedSomaRows, 4)
	nl3m := netLiqVal(fedSomaRows, 12)
	nlChange1m := analysis.PctChange(nlNow, nl1m)
	nlChange3m := analysis.PctChange(nlNow, nl3m)

	// RRP change
	var rrpNow, rrp1w *float64
	if len(fed) > 0 {
		rrpNow = fed[0].RRP
	}
	if len(fed) > 4 {
		rrp1w = fed[4].RRP
	}
	rrpChange1w := analysis.PctChange(rrpNow, rrp1w)

	// KRE changes
	var kreNow, kre1m, kre2m *float64
	if len(bank) > 0 {
		kreNow = bank[0].KREClose
	}
	if len(bank) > 21 {
		kre1m = bank[21].KREClose
	}
	if len(bank) > 43 {
		kre2m = bank[43].KREClose
	}
	kreChange1m := analysis.PctChange(kreNow, kre1m)
	kreChange2m := analysis.PctChange(kreNow, kre2m)

	// VIX
	var vixCurrent, vix1wAgo, vix1mAgo *float64
	if len(mkt) > 0 {
		vixCurrent = mkt[0].VIX
	}
	if len(mkt) > 4 {
		vix1wAgo = mkt[4].VIX
	}
	if len(mkt) > 21 {
		vix1mAgo = mkt[21].VIX
	}

	// Spreads
	var hySpreadCurrent, hySpread1mAgo, igSpreadCurrent, igSpread1mAgo *float64
	if len(sprd) > 0 {
		hySpreadCurrent = sprd[0].HYSpread
		igSpreadCurrent = sprd[0].IGSpread
	}
	if len(sprd) > 21 {
		hySpread1mAgo = sprd[21].HYSpread
		igSpread1mAgo = sprd[21].IGSpread
	}

	events := analysis.DetectMarketEvents(analysis.DetectMarketEventsInput{
		ReservesChange1m: reservesChange1m,
		ReservesChange1w: reservesChange1w,
		NLChange3m:       nlChange3m,
		NLChange1m:       nlChange1m,
		KREChange2m:      kreChange2m,
		KREChange1m:      kreChange1m,
		VIXCurrent:       vixCurrent,
		VIX1mAgo:         vix1mAgo,
		VIX1wAgo:         vix1wAgo,
		HYSpreadCurrent:  hySpreadCurrent,
		HYSpread1mAgo:    hySpread1mAgo,
		IGSpreadCurrent:  igSpreadCurrent,
		IGSpread1mAgo:    igSpread1mAgo,
		SOFRFFSpread:     nil,
		RRPChange1w:      rrpChange1w,
	})

	var highestSeverity *string
	if len(events) > 0 {
		severityOrder := map[string]int{"CRITICAL": 0, "ALERT": 1, "WARNING": 2}
		best := events[0].Severity
		for _, e := range events {
			if severityOrder[e.Severity] < severityOrder[best] {
				best = e.Severity
			}
		}
		highestSeverity = &best
	}

	if events == nil {
		events = []analysis.MarketEvent{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"events":           events,
		"event_count":      len(events),
		"highest_severity": highestSeverity,
		"timestamp":        time.Now().Format(time.RFC3339),
	})
}

// GetPolicyRegime handles GET /api/liquidity/policy-regime.
func (h *LiquidityHandler) GetPolicyRegime(c echo.Context) error {
	ctx := c.Request().Context()
	g, gctx := errgroup.WithContext(ctx)

	type fedR struct {
		Date       string
		SOMAAssets *float64
		RRP        *float64
		TGA        *float64
	}
	type ratesR struct {
		Date           string
		FedFunds       *float64
		TreasurySpread *float64
	}

	var fed []fedR
	var rates []ratesR
	var inflationRate *float64

	g.Go(func() error {
		rows, err := h.repo.ListFedBalanceSheet(gctx, 200)
		if err != nil {
			return err
		}
		for _, r := range rows {
			fed = append(fed, fedR{r.Date.String(), r.SOMAAssets, r.RRP, r.TGA})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListInterestRates(gctx, 200)
		if err != nil {
			return err
		}
		for _, r := range rows {
			rates = append(rates, ratesR{r.Date.String(), r.FedFunds, r.TreasurySpread})
		}
		return nil
	})
	g.Go(func() error {
		val, err := h.repo.GetLatestCPI(gctx)
		if err == nil {
			inflationRate = val
		}
		return nil // non-critical
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Internal server error"))
	}

	now := time.Now()
	sixMonthsAgo := now.AddDate(0, -6, 0).Format("2006-01-02")

	// SOMA weekly rows
	var fedSoma []fedR
	for _, r := range fed {
		if r.SOMAAssets != nil {
			fedSoma = append(fedSoma, r)
		}
	}

	var somaNow, soma3m, soma6m *float64
	if len(fedSoma) > 0 {
		somaNow = fedSoma[0].SOMAAssets
	}
	if len(fedSoma) > 12 {
		soma3m = fedSoma[12].SOMAAssets
	}
	if len(fedSoma) > 25 {
		soma6m = fedSoma[25].SOMAAssets
	}
	somaChange3m := analysis.PctChange(somaNow, soma3m)
	somaChange6m := analysis.PctChange(somaNow, soma6m)

	var rrpLevel *float64
	if len(fed) > 0 {
		rrpLevel = fed[0].RRP
	}
	var rrp3m *float64
	if len(fed) > 60 {
		rrp3m = fed[60].RRP
	}
	rrpChange3m := analysis.PctChange(rrpLevel, rrp3m)

	tgaLevel := findNthNonNull(fed, func(r fedR) *float64 { return r.TGA }, 0)

	ffRate := findNthNonNull(rates, func(r ratesR) *float64 { return r.FedFunds }, 0)
	yieldCurve := findNthNonNull(rates, func(r ratesR) *float64 { return r.TreasurySpread }, 0)

	var ffRateChange6m *float64
	if ffRate != nil && len(rates) > 0 {
		var rates6m []ratesR
		for _, r := range rates {
			if r.Date <= sixMonthsAgo {
				rates6m = append(rates6m, r)
			}
		}
		ff6m := findNthNonNull(rates6m, func(r ratesR) *float64 { return r.FedFunds }, 0)
		if ff6m != nil {
			v := *ffRate - *ff6m
			ffRateChange6m = &v
		}
	}

	regime := analysis.DetectPolicyRegime(analysis.DetectPolicyRegimeInput{
		SOMAChange3m:   somaChange3m,
		SOMAChange6m:   somaChange6m,
		RRPLevel:       rrpLevel,
		RRPChange3m:    rrpChange3m,
		TGALevel:       tgaLevel,
		FFRate:         ffRate,
		FFRateChange6m: ffRateChange6m,
		YieldCurve:     yieldCurve,
		InflationRate:  inflationRate,
	})

	fedComment := analysis.GenerateFedActionComment(regime)

	return c.JSON(http.StatusOK, map[string]any{
		"regime":          regime.Regime,
		"regime_label":    regime.RegimeLabel,
		"description":     regime.Description,
		"fed_action_room": regime.FedActionRoom,
		"signals":         regime.Signals,
		"fed_comment":     fedComment,
		"timestamp":       time.Now().Format(time.RFC3339),
	})
}

// GetHistoryCharts handles GET /api/liquidity/history-charts.
func (h *LiquidityHandler) GetHistoryCharts(c echo.Context) error {
	ctx := c.Request().Context()

	period := c.QueryParam("period")
	if period == "" {
		period = "2y"
	}
	startDate := c.QueryParam("start_date")
	endDate := c.QueryParam("end_date")

	if startDate == "" || endDate == "" {
		periodDays := map[string]int{
			"1y": 365, "2y": 730, "5y": 1825, "10y": 3650, "all": 36500,
		}
		days := periodDays[period]
		if days == 0 {
			days = 730
		}
		now := time.Now()
		endDate = now.Format("2006-01-02")
		startDate = now.AddDate(0, 0, -days).Format("2006-01-02")
	}

	g, gctx := errgroup.WithContext(ctx)

	var (
		fedRows       []map[string]any
		marginRows    []map[string]any
		bankRows      []map[string]any
		spreadsRows   []map[string]any
		indicatorRows []map[string]any
		ratesRows     []map[string]any
		layerStress   []struct {
			Date        string
			Layer       string
			StressScore *float64
		}
	)

	g.Go(func() error {
		rows, err := h.repo.ListFedBalanceSheetRange(gctx, startDate, endDate, 2000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			fedRows = append(fedRows, map[string]any{
				"date": r.Date, "soma_assets": r.SOMAAssets, "rrp": r.RRP, "tga": r.TGA,
			})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMarginDebtRange(gctx, startDate, endDate, 500)
		if err != nil {
			return err
		}
		for _, r := range rows {
			marginRows = append(marginRows, map[string]any{
				"date": r.Date, "debit_balance": r.DebitBalance, "change_2y": r.Change2Y,
			})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListBankSectorRange(gctx, startDate, endDate, 2000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			bankRows = append(bankRows, map[string]any{
				"date": r.Date, "kre_close": r.KREClose, "kre_52w_change": r.KRE52WChange,
			})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListCreditSpreadsRange(gctx, startDate, endDate, 2000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			spreadsRows = append(spreadsRows, map[string]any{
				"date": r.Date, "hy_spread": r.HYSpread, "ig_spread": r.IGSpread,
			})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMarketIndicatorsRange(gctx, startDate, endDate, 2000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			indicatorRows = append(indicatorRows, map[string]any{
				"date": r.Date, "vix": r.VIX, "sp500": r.SP500, "nasdaq": r.NASDAQ, "dxy": r.DXY,
			})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListInterestRatesRange(gctx, startDate, endDate, 2000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			ratesRows = append(ratesRows, map[string]any{
				"date": r.Date, "fed_funds": r.FedFunds, "treasury_2y": r.Treasury2Y,
				"treasury_10y": r.Treasury10Y, "treasury_spread": r.TreasurySpread,
			})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListLayerStressRange(gctx, startDate, endDate, 3000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			layerStress = append(layerStress, struct {
				Date        string
				Layer       string
				StressScore *float64
			}{r.Date.String(), r.Layer, r.StressScore})
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Internal server error"))
	}

	// Net Liquidity calculation
	var netLiqData []map[string]any
	for _, row := range fedRows {
		soma, _ := row["soma_assets"].(*float64)
		rrp, _ := row["rrp"].(*float64)
		tga, _ := row["tga"].(*float64)
		var nl *float64
		if soma != nil && rrp != nil && tga != nil {
			v := *soma - *rrp - *tga
			nl = &v
		}
		netLiqData = append(netLiqData, map[string]any{
			"date": row["date"], "net_liquidity": nl,
			"soma_assets": soma, "rrp": rrp, "tga": tga,
		})
	}

	// Layer stress by date
	layerByDate := map[string]map[string]*float64{}
	for _, r := range layerStress {
		if _, ok := layerByDate[r.Date]; !ok {
			layerByDate[r.Date] = map[string]*float64{}
		}
		layerByDate[r.Date][r.Layer] = r.StressScore
	}
	var dates []string
	for d := range layerByDate {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	var layerScoresData []map[string]any
	for _, d := range dates {
		vals := layerByDate[d]
		layerScoresData = append(layerScoresData, map[string]any{
			"date": d, "layer1": vals["layer1"], "layer2a": vals["layer2a"], "layer2b": vals["layer2b"],
		})
	}

	// Divergence analysis: z(L2B) - z(S&P500)
	sp500Monthly := map[string]float64{}
	for _, row := range indicatorRows {
		d, _ := row["date"].(string)
		if sp, ok := row["sp500"].(*float64); ok && sp != nil && len(d) >= 7 {
			sp500Monthly[d[:7]] = *sp
		}
	}
	l2bMonthly := map[string]float64{}
	for _, r := range layerStress {
		if r.Layer == "layer2b" && r.StressScore != nil && len(r.Date) >= 7 {
			l2bMonthly[r.Date[:7]] = *r.StressScore
		}
	}

	commonMonths := intersectSortedKeys(l2bMonthly, sp500Monthly)
	var divergenceData []map[string]any
	if len(commonMonths) >= 3 {
		l2bVals := make([]float64, len(commonMonths))
		spVals := make([]float64, len(commonMonths))
		for i, m := range commonMonths {
			l2bVals[i] = l2bMonthly[m]
			spVals[i] = sp500Monthly[m]
		}
		zL2b := analysis.RollingZScore(l2bVals, 24)
		zSP := analysis.RollingZScore(spVals, 24)
		for i, m := range commonMonths {
			var div *float64
			if zL2b[i] != nil && zSP[i] != nil {
				v := math.Round((*zL2b[i]-*zSP[i])*1000) / 1000
				div = &v
			}
			divergenceData = append(divergenceData, map[string]any{
				"date": m + "-01", "divergence": div, "z_l2b": zL2b[i], "z_sp500": zSP[i],
			})
		}
	}

	// Ensure non-nil slices
	if netLiqData == nil {
		netLiqData = []map[string]any{}
	}
	if marginRows == nil {
		marginRows = []map[string]any{}
	}
	if bankRows == nil {
		bankRows = []map[string]any{}
	}
	if spreadsRows == nil {
		spreadsRows = []map[string]any{}
	}
	if indicatorRows == nil {
		indicatorRows = []map[string]any{}
	}
	if ratesRows == nil {
		ratesRows = []map[string]any{}
	}
	if layerScoresData == nil {
		layerScoresData = []map[string]any{}
	}
	if divergenceData == nil {
		divergenceData = []map[string]any{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"period":     period,
		"start_date": startDate,
		"end_date":   endDate,
		"data": map[string]any{
			"net_liquidity":     netLiqData,
			"margin_debt":       marginRows,
			"bank_sector":       bankRows,
			"credit_spreads":    spreadsRows,
			"market_indicators": indicatorRows,
			"interest_rates":    ratesRows,
			"layer_scores":      layerScoresData,
			"layer_divergence":  divergenceData,
		},
	})
}

// Historical crisis events for backtest timeline.
var crisisEvents = []struct {
	Date        string
	Name        string
	Description string
}{
	{"2011-08-31", "2011年欧州債務危機", "S&P格下げ、欧州危機深刻化"},
	{"2018-12-31", "2018年12月急落", "FRB利上げ + QT"},
	{"2019-09-30", "2019年9月レポ危機", "レポ金利急騰"},
	{"2020-03-31", "コロナショック", "パンデミック"},
	{"2022-10-31", "2022年ベア相場", "インフレ対応利上げ"},
	{"2023-03-31", "2023年銀行危機", "SVB破綻"},
}

// GetBacktestStates handles GET /api/liquidity/backtest-states.
func (h *LiquidityHandler) GetBacktestStates(c echo.Context) error {
	ctx := c.Request().Context()
	limitParam := parseLimitFromCtx(c, 120, 600)
	g, gctx := errgroup.WithContext(ctx)

	type fedR struct {
		Date       string
		SOMAAssets *float64
		RRP        *float64
		TGA        *float64
		Reserves   *float64
	}
	type sp500R struct {
		Date  string
		SP500 *float64
		VIX   *float64
	}
	type marginR struct {
		Date         string
		DebitBalance *float64
		Change2Y     *float64
	}
	type bankR struct {
		Date         string
		KRE52WChange *float64
	}
	type spreadR struct {
		Date     string
		IGSpread *float64
		HYSpread *float64
	}
	type srfR struct {
		Date   string
		Amount *float64
	}
	type mmfR struct {
		Date     string
		Change3M *float64
	}

	var fedData []fedR
	var sp500Data []sp500R
	var marginData []marginR
	var bankData []bankR
	var spreadData []spreadR
	var srfData []srfR
	var mmfData []mmfR

	g.Go(func() error {
		rows, err := h.repo.ListFedBalanceSheetAscLimit(gctx, 5000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			fedData = append(fedData, fedR{r.Date.String(), r.SOMAAssets, r.RRP, r.TGA, r.Reserves})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMarketIndicatorsRange(gctx, "1900-01-01", "2099-12-31", 5000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			sp500Data = append(sp500Data, sp500R{r.Date.String(), r.SP500, r.VIX})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMarginDebtAsc(gctx, 500)
		if err != nil {
			return err
		}
		for _, r := range rows {
			marginData = append(marginData, marginR{r.Date.String(), r.DebitBalance, r.Change2Y})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListBankSectorAsc(gctx, 500)
		if err != nil {
			return err
		}
		for _, r := range rows {
			bankData = append(bankData, bankR{r.Date.String(), r.KRE52WChange})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListCreditSpreadsRange(gctx, "1900-01-01", "2099-12-31", 5000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			spreadData = append(spreadData, spreadR{r.Date.String(), r.IGSpread, r.HYSpread})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListSRFUsageAsc(gctx, 5000)
		if err != nil {
			return err
		}
		for _, r := range rows {
			var amt *float64
			amt = r.Amount
			srfData = append(srfData, srfR{r.Date.String(), amt})
		}
		return nil
	})
	g.Go(func() error {
		rows, err := h.repo.ListMMFAssetsAsc(gctx, 500)
		if err != nil {
			return err
		}
		for _, r := range rows {
			mmfData = append(mmfData, mmfR{r.Date.String(), r.Change3M})
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, errDetail("Internal server error"))
	}

	// Build monthly maps (last record per month)
	toMonthMap := func(dates []string, getter func(int) map[string]any) map[string]map[string]any {
		m := map[string]map[string]any{}
		for i, d := range dates {
			if len(d) < 7 {
				continue
			}
			mk := d[:7]
			m[mk] = getter(i)
			m[mk]["date"] = d
		}
		return m
	}

	// Fed monthly map
	fedDates := make([]string, len(fedData))
	for i, r := range fedData {
		fedDates[i] = r.Date
	}
	fedMap := toMonthMap(fedDates, func(i int) map[string]any {
		return map[string]any{
			"soma_assets": fedData[i].SOMAAssets,
			"rrp":         fedData[i].RRP,
			"tga":         fedData[i].TGA,
			"reserves":    fedData[i].Reserves,
		}
	})

	sp500Dates := make([]string, len(sp500Data))
	for i, r := range sp500Data {
		sp500Dates[i] = r.Date
	}
	sp500Map := toMonthMap(sp500Dates, func(i int) map[string]any {
		return map[string]any{"sp500": sp500Data[i].SP500, "vix": sp500Data[i].VIX}
	})

	marginDates := make([]string, len(marginData))
	for i, r := range marginData {
		marginDates[i] = r.Date
	}
	marginMap := toMonthMap(marginDates, func(i int) map[string]any {
		return map[string]any{"debit_balance": marginData[i].DebitBalance, "change_2y": marginData[i].Change2Y}
	})

	bankDates := make([]string, len(bankData))
	for i, r := range bankData {
		bankDates[i] = r.Date
	}
	bankMap := toMonthMap(bankDates, func(i int) map[string]any {
		return map[string]any{"kre_52w_change": bankData[i].KRE52WChange}
	})

	spreadDates := make([]string, len(spreadData))
	for i, r := range spreadData {
		spreadDates[i] = r.Date
	}
	spreadsMap := toMonthMap(spreadDates, func(i int) map[string]any {
		return map[string]any{"ig_spread": spreadData[i].IGSpread, "hy_spread": spreadData[i].HYSpread}
	})

	mmfDates := make([]string, len(mmfData))
	for i, r := range mmfData {
		mmfDates[i] = r.Date
	}
	mmfMap := toMonthMap(mmfDates, func(i int) map[string]any {
		return map[string]any{"change_3m": mmfData[i].Change3M}
	})

	// SRF monthly aggregation
	srfMonthly := map[string]struct{ Usage float64; Days int }{}
	for _, r := range srfData {
		if len(r.Date) < 7 {
			continue
		}
		mk := r.Date[:7]
		entry := srfMonthly[mk]
		amt := 0.0
		if r.Amount != nil {
			amt = *r.Amount
		}
		entry.Usage += amt
		if amt > 0 {
			entry.Days++
		}
		srfMonthly[mk] = entry
	}

	// Net Liquidity history for Z-score
	var nlHistory []float64
	for _, row := range fedData {
		if row.SOMAAssets != nil && row.RRP != nil && row.TGA != nil {
			nlHistory = append(nlHistory, *row.SOMAAssets-*row.RRP-*row.TGA)
		}
	}

	// SP500 months sorted for 6M return lookup
	var sp500MonthsSorted []string
	for k := range sp500Map {
		sp500MonthsSorted = append(sp500MonthsSorted, k)
	}
	sort.Strings(sp500MonthsSorted)

	// Target months
	allMonths := sortedKeys(fedMap)
	targetMonths := allMonths
	if len(targetMonths) > limitParam {
		targetMonths = targetMonths[len(targetMonths)-limitParam:]
	}

	// Calculate each month's stress
	type stateEntry struct {
		Date          string   `json:"date"`
		StateCode     string   `json:"state_code"`
		StateLabel    string   `json:"state_label"`
		Color         string   `json:"color"`
		Action        string   `json:"action"`
		Layer1Stress  int      `json:"layer1_stress"`
		Layer2AStress int      `json:"layer2a_stress"`
		Layer2BStress int      `json:"layer2b_stress"`
		SP500         *float64 `json:"sp500"`
		Return6M      *float64 `json:"return_6m"`
	}

	var states []stateEntry
	for _, mk := range targetMonths {
		fedRow := fedMap[mk]
		soma := getFloat(fedRow, "soma_assets")
		rrp := getFloat(fedRow, "rrp")
		tga := getFloat(fedRow, "tga")
		reserves := getFloat(fedRow, "reserves")

		// Layer 1
		l1Score := 50
		if soma != nil && rrp != nil && tga != nil && len(nlHistory) > 0 {
			currentNL := *soma - *rrp - *tga
			l1 := analysis.CalculateLayer1Stress(currentNL, nlHistory, 520)
			l1Score = l1.StressScore
		}

		// Layer 2A
		marginRow := marginMap[mk]
		bankRow := bankMap[mk]
		spreadRow := spreadsMap[mk]
		srfRow, hasSrf := srfMonthly[mk]

		var reservesMoM *float64
		prevMonths := make([]string, 0)
		for _, m := range allMonths {
			if m < mk {
				prevMonths = append(prevMonths, m)
			}
		}
		if len(prevMonths) > 0 && reserves != nil {
			prevFed := fedMap[prevMonths[len(prevMonths)-1]]
			prevRes := getFloat(prevFed, "reserves")
			if prevRes != nil && *prevRes != 0 {
				v := ((*reserves - *prevRes) / *prevRes) * 100
				reservesMoM = &v
			}
		}

		srfUsage := 0.0
		srfDays := 0
		if hasSrf {
			srfUsage = srfRow.Usage
			srfDays = srfRow.Days
		}

		l2a := analysis.CalculateLayer2AStress(
			reservesMoM,
			getFloat(bankRow, "kre_52w_change"),
			&srfUsage,
			getFloat(spreadRow, "ig_spread"),
			&srfDays,
			&srfDays,
		)
		l2aScore := l2a.StressScore

		// Layer 2B
		change2y := getFloat(marginRow, "change_2y")
		mmfRow := mmfMap[mk]
		sp500Row := sp500Map[mk]

		l2bScore := 40
		if change2y != nil {
			l2b := analysis.CalculateLayer2BStress(
				*change2y,
				nil,
				getFloat(mmfRow, "change_3m"),
				getFloat(sp500Row, "vix"),
			)
			l2bScore = l2b.StressScore
		}

		// State determination
		interpType := l2a.InterpretationType
		ms := analysis.DetermineMarketState(l1Score, l2aScore, l2bScore, &interpType)

		// 6-month forward return
		var return6m *float64
		sp500Now := getFloat(sp500Row, "sp500")
		if sp500Now != nil && *sp500Now > 0 {
			monthNum, _ := strconv.Atoi(mk[5:7])
			yearNum, _ := strconv.Atoi(mk[:4])
			futureMonth := monthNum + 6
			futureYear := yearNum
			if futureMonth > 12 {
				futureMonth -= 12
				futureYear++
			}
			targetKey := fmt.Sprintf("%d-%02d", futureYear, futureMonth)
			// Find first month >= targetKey
			idx := sort.SearchStrings(sp500MonthsSorted, targetKey)
			if idx < len(sp500MonthsSorted) {
				futureRow := sp500Map[sp500MonthsSorted[idx]]
				sp500Future := getFloat(futureRow, "sp500")
				if sp500Future != nil && *sp500Now > 0 {
					v := math.Round(((*sp500Future-*sp500Now)/ *sp500Now)*10000) / 100
					return6m = &v
				}
			}
		}

		date := mk + "-28"
		if d, ok := fedRow["date"].(string); ok && d != "" {
			date = d
		}

		states = append(states, stateEntry{
			Date:          date,
			StateCode:     ms.Code,
			StateLabel:    ms.Label,
			Color:         ms.Color,
			Action:        ms.Action,
			Layer1Stress:  l1Score,
			Layer2AStress: l2aScore,
			Layer2BStress: l2bScore,
			SP500:         sp500Now,
			Return6M:      return6m,
		})
	}

	// Statistics
	statBuckets := map[string][]float64{}
	for _, s := range states {
		if s.Return6M != nil {
			statBuckets[s.StateCode] = append(statBuckets[s.StateCode], *s.Return6M)
		}
	}
	stateStats := map[string]map[string]any{}
	for code, returns := range statBuckets {
		if len(returns) == 0 {
			continue
		}
		sum := 0.0
		wins := 0
		minR := returns[0]
		maxR := returns[0]
		for _, r := range returns {
			sum += r
			if r > 0 {
				wins++
			}
			if r < minR {
				minR = r
			}
			if r > maxR {
				maxR = r
			}
		}
		stateStats[code] = map[string]any{
			"avg_return_6m": math.Round(sum/float64(len(returns))*100) / 100,
			"win_rate":      math.Round(float64(wins)/float64(len(returns))*1000) / 10,
			"max_drawdown":  math.Round(minR*100) / 100,
			"best_return":   math.Round(maxR*100) / 100,
			"sample_count":  len(returns),
			"occurrence_pct": math.Round(float64(len(returns))/math.Max(float64(len(states)), 1)*1000) / 10,
		}
	}

	// Event timeline
	var eventTimeline []map[string]any
	for _, ev := range crisisEvents {
		var matched *stateEntry
		for i := range states {
			if states[i].Date <= ev.Date {
				matched = &states[i]
			}
		}
		if matched != nil {
			eventTimeline = append(eventTimeline, map[string]any{
				"event":         ev.Name,
				"description":   ev.Description,
				"event_date":    ev.Date,
				"actual_date":   matched.Date,
				"state_code":    matched.StateCode,
				"state_label":   matched.StateLabel,
				"color":         matched.Color,
				"layer1_stress": matched.Layer1Stress,
				"layer2a_stress": matched.Layer2AStress,
				"layer2b_stress": matched.Layer2BStress,
				"sp500":         matched.SP500,
				"return_6m":     matched.Return6M,
			})
		}
	}

	// State definitions
	stateCodes := []string{
		"LIQUIDITY_SHOCK", "CREDIT_CONTRACTION", "POLICY_TIGHTENING",
		"SPLIT_BUBBLE", "MARKET_OVERSHOOT", "FINANCIAL_RALLY", "HEALTHY", "NEUTRAL",
	}
	conditionsMap := map[string]string{
		"LIQUIDITY_SHOCK":    "L2A >= 65",
		"CREDIT_CONTRACTION": "L2A >= 50",
		"POLICY_TIGHTENING":  "L1 >= 45",
		"SPLIT_BUBBLE":       "L2A >= 40 AND L2B >= 70",
		"MARKET_OVERSHOOT":   "L2B >= 80 AND L2A < 35",
		"FINANCIAL_RALLY":    "L1 < 30 AND L2B > 60",
		"HEALTHY":            "L1 < 35 AND L2A < 35 AND L2B < 40",
		"NEUTRAL":            "いずれにも該当しない",
	}
	var stateDefs []map[string]any
	for _, code := range stateCodes {
		d := analysis.MarketStateDefinitions[code]
		stateDefs = append(stateDefs, map[string]any{
			"code":        code,
			"label":       d.Label,
			"description": d.Description,
			"conditions":  conditionsMap[code],
			"action":      d.Action,
			"color":       d.Color,
		})
	}

	if states == nil {
		states = []stateEntry{}
	}
	if eventTimeline == nil {
		eventTimeline = []map[string]any{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"states":            states,
		"state_definitions": stateDefs,
		"state_stats":       stateStats,
		"total_months":      len(states),
		"event_timeline":    eventTimeline,
	})
}

// ============================================================
// Helpers
// ============================================================

func errDetail(msg string) map[string]string {
	return map[string]string{"detail": msg}
}

func firstOrNil[T any](s []T) any {
	if len(s) == 0 {
		return nil
	}
	return s[0]
}

// forwardFill finds the first non-null value for the given field in a date-DESC slice.
func forwardFill[T any](rows []T, getter func(T) *float64) *float64 {
	for _, r := range rows {
		if v := getter(r); v != nil {
			return v
		}
	}
	return nil
}

// findNthNonNull finds the N-th (0-indexed) non-null value for a field.
func findNthNonNull[T any](rows []T, getter func(T) *float64, n int) *float64 {
	count := 0
	for _, r := range rows {
		if v := getter(r); v != nil {
			if count == n {
				return v
			}
			count++
		}
	}
	return nil
}

// subtractYears subtracts n years from a YYYY-MM-DD date string.
func subtractYears(dateStr string, years int) string {
	if len(dateStr) < 4 {
		return dateStr
	}
	y, _ := strconv.Atoi(dateStr[:4])
	return fmt.Sprintf("%d%s", y-years, dateStr[4:])
}

// getFloat safely extracts a *float64 from a map[string]any.
func getFloat(m map[string]any, key string) *float64 {
	if m == nil {
		return nil
	}
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch val := v.(type) {
	case *float64:
		return val
	case float64:
		return &val
	}
	return nil
}

// sortedKeys returns sorted map keys.
func sortedKeys(m map[string]map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// intersectSortedKeys returns sorted keys present in both maps.
func intersectSortedKeys(a, b map[string]float64) []string {
	var result []string
	for k := range a {
		if _, ok := b[k]; ok {
			result = append(result, k)
		}
	}
	sort.Strings(result)
	return result
}

