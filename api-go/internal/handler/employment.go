package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/errgroup"

	"github.com/open-regime/api-go/internal/analysis"
	"github.com/open-regime/api-go/internal/model"
	"github.com/open-regime/api-go/internal/repository"
)

// ---- Cache constants (Redis skill rules: ram-ttl / data-key-naming / conn-timeouts) ----
const (
	employmentRiskScoreTTL   = 24 * time.Hour
	employmentRiskScoreKey   = "employment:risk_score:v1"
	employmentRiskHistoryTTL = 24 * time.Hour
	// risk-history key is parameterized by months: fmt.Sprintf("employment:risk_history:v1:%d", months)

	// Per-operation context timeouts (skill rule: conn-timeouts)
	// 同ホスト Docker Redis のラウンドトリップは <1ms なので 200ms / 500ms は十分余裕。
	// Redis 遅延時に API リクエストを巻き込まないためのフォールバック装置。
	employmentCacheGetTimeout = 200 * time.Millisecond
	employmentCacheSetTimeout = 500 * time.Millisecond // payload ~350KB のため少し長め
)

// Query limits for risk-score (撤廃前は 24/52/150 でハードコード = ちょうど 2 年)
// 実 DB は NFP 327 行 / claims 1422 行 / consumer 6 指標 ~2000 行。倍率は将来余裕。
const (
	riskScoreNFPLimit       = 2000  // 実 DB 327 行 → 6 倍余裕
	riskScoreClaimsLimit    = 5000  // 実 DB 1422 行 → 3.5 倍余裕
	riskScoreIndicatorLimit = 10000 // 実 DB ~2000 行 → 5 倍余裕
)

// EmploymentHandler handles /api/employment endpoints.
type EmploymentHandler struct {
	repo        *repository.EmploymentRepository
	redis       *redis.Client
	warmupToken string
}

// NewEmploymentHandler creates a new EmploymentHandler.
func NewEmploymentHandler(repo *repository.EmploymentRepository, redisClient *redis.Client, warmupToken string) *EmploymentHandler {
	return &EmploymentHandler{
		repo:        repo,
		redis:       redisClient,
		warmupToken: warmupToken,
	}
}

// Register mounts all employment routes on the given Echo group.
// authGroup should have auth middleware applied for POST routes.
func (h *EmploymentHandler) Register(g *echo.Group, authGroup *echo.Group) {
	g.GET("/overview", h.GetOverview)
	g.GET("/indicators", h.ListIndicators)
	g.GET("/weekly-claims", h.ListWeeklyClaims)
	g.GET("/revisions/:indicator_id", h.ListRevisions)
	g.GET("/risk-score", h.GetRiskScore)
	g.GET("/risk-history", h.GetRiskHistory)

	authGroup.POST("/indicators", h.UpsertIndicator)
}

// ---------- CRUD endpoints ----------

// GetOverview handles GET /api/employment/overview.
func (h *EmploymentHandler) GetOverview(c echo.Context) error {
	ctx := c.Request().Context()

	var latestNFP *model.EconomicIndicator
	var latestClaims *model.WeeklyClaims

	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error {
		nfp, err := h.repo.LatestNFP(gCtx)
		if err != nil {
			return err
		}
		latestNFP = nfp
		return nil
	})

	g.Go(func() error {
		claims, err := h.repo.LatestWeeklyClaims(gCtx)
		if err != nil {
			return err
		}
		latestClaims = claims
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Internal server error"})
	}

	// Alert level calculation
	score := 0
	var factors []string

	if latestNFP != nil {
		if latestNFP.U3Rate != nil {
			u3 := *latestNFP.U3Rate
			if u3 > 5.0 {
				score += 2
				factors = append(factors, "U3 rate > 5.0%")
			} else if u3 > 4.5 {
				score += 1
				factors = append(factors, "U3 rate > 4.5%")
			}
		}
		if latestNFP.NFPChange != nil {
			nc := *latestNFP.NFPChange
			if nc < 0 {
				score += 2
				factors = append(factors, "NFP negative")
			} else if nc < 100 {
				score += 1
				factors = append(factors, "NFP < 100K")
			}
		}
	}

	if latestClaims != nil && latestClaims.InitialClaims != nil {
		ic := *latestClaims.InitialClaims
		if ic > 300000 {
			score += 2
			factors = append(factors, "Initial claims > 300K")
		} else if ic > 250000 {
			score += 1
			factors = append(factors, "Initial claims > 250K")
		}
	}

	alertLevel := "Low"
	if score >= 4 {
		alertLevel = "High"
	} else if score >= 2 {
		alertLevel = "Medium"
	}

	if factors == nil {
		factors = []string{}
	}

	return c.JSON(http.StatusOK, model.OverviewResponse{
		LatestNFP:    latestNFP,
		LatestClaims: latestClaims,
		AlertLevel:   alertLevel,
		AlertFactors: factors,
	})
}

// ListIndicators handles GET /api/employment/indicators.
func (h *EmploymentHandler) ListIndicators(c echo.Context) error {
	limit := 12
	if l := c.QueryParam("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}

	indicator := ""
	if ind := c.QueryParam("indicator"); ind != "" {
		indicator = strings.ToUpper(ind)
	}

	rows, err := h.repo.ListIndicators(c.Request().Context(), indicator, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Internal server error"})
	}
	if rows == nil {
		rows = []model.EconomicIndicator{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"data":  rows,
		"count": len(rows),
	})
}

// ListWeeklyClaims handles GET /api/employment/weekly-claims.
func (h *EmploymentHandler) ListWeeklyClaims(c echo.Context) error {
	limit := 12
	if l := c.QueryParam("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := h.repo.ListWeeklyClaims(c.Request().Context(), limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Internal server error"})
	}
	if rows == nil {
		rows = []model.WeeklyClaims{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"data":  rows,
		"count": len(rows),
	})
}

// ListRevisions handles GET /api/employment/revisions/:indicator_id.
func (h *EmploymentHandler) ListRevisions(c echo.Context) error {
	idStr := c.Param("indicator_id")
	indicatorID, err := strconv.Atoi(idStr)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid indicator_id"})
	}

	rows, err := h.repo.ListRevisions(c.Request().Context(), indicatorID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Internal server error"})
	}
	if rows == nil {
		rows = []model.EconomicIndicatorRevision{}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"data":  rows,
		"count": len(rows),
	})
}

// UpsertIndicator handles POST /api/employment/indicators.
func (h *EmploymentHandler) UpsertIndicator(c echo.Context) error {
	var input model.IndicatorInput
	if err := c.Bind(&input); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "Invalid request body"})
	}

	input.Indicator = strings.ToUpper(input.Indicator)
	if input.Indicator == "" || input.ReferencePeriod == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"detail": "indicator and reference_period are required"})
	}

	ctx := c.Request().Context()

	existing, err := h.repo.FindExistingIndicator(ctx, input.Indicator, input.ReferencePeriod)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Internal server error"})
	}

	if existing == nil {
		// New record
		id, err := h.repo.InsertIndicator(ctx, input)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to create indicator"})
		}

		// Insert initial revision
		notes := "速報"
		if err := h.repo.InsertRevision(ctx, id, 0, input.CurrentValue, nil, nil, &notes); err != nil {
			// Non-fatal: log but don't fail the request
			_ = err
		}

		return c.JSON(http.StatusCreated, map[string]any{
			"status":          "created",
			"id":              id,
			"revision_number": 0,
		})
	}

	// Update existing record
	valueChanged := input.CurrentValue != nil && existing.CurrentValue != nil &&
		*input.CurrentValue != *existing.CurrentValue

	revisionCount := existing.RevisionCount

	if valueChanged {
		revisionCount++

		change := *input.CurrentValue - *existing.CurrentValue
		var changePct *float64
		if *existing.CurrentValue != 0 {
			pct := math.Round((change/math.Abs(*existing.CurrentValue))*10000) / 100
			changePct = &pct
		}

		direction := "下方修正"
		if change > 0 {
			direction = "上方修正"
		}
		notes := fmt.Sprintf("%s: %v → %v", direction, *existing.CurrentValue, *input.CurrentValue)
		roundedChange := math.Round(change*10000) / 10000

		if err := h.repo.InsertRevision(ctx, existing.ID, revisionCount, input.CurrentValue, &roundedChange, changePct, &notes); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to insert revision"})
		}
	}

	if err := h.repo.UpdateIndicator(ctx, existing.ID, input, revisionCount); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Failed to update indicator"})
	}

	if valueChanged {
		change := math.Round((*input.CurrentValue-*existing.CurrentValue)*100) / 100
		direction := "下方修正"
		if change > 0 {
			direction = "上方修正"
		}
		return c.JSON(http.StatusOK, map[string]any{
			"status":          "revised",
			"id":              existing.ID,
			"revision_number": revisionCount,
			"change":          change,
			"direction":       direction,
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":          "updated",
		"id":              existing.ID,
		"revision_number": revisionCount,
		"change":          nil,
		"direction":       nil,
	})
}

// ---------- Calculation endpoints ----------

// GetRiskScore handles GET /api/employment/risk-score.
//
// Cache: 24h Redis (key: employment:risk_score:v1)
// Purge: ?purge=1 with X-Warmup-Token header (used by batch warmup cron)
//
// 注 (§5.1.A): cache miss と cache hit でフィールドの動的型が変わる (time.Time → string、
// pgtype.Numeric → float64 等) が、analysis 系の関数 (CalcNFPTrend 等) は cache miss
// 経路でしか呼ばれず、ハンドラ自身は LatestNFP / *History を type assertion せずに
// レスポンスへパススルーするだけなので問題ない。analysis/employment_score.go の
// getString/getFloat/getInt ヘルパーは複数型に対応済。
func (h *EmploymentHandler) GetRiskScore(c echo.Context) error {
	ctx := c.Request().Context()

	// 1. ?purge=1 認証 (DoS 対策、§5.1.B)
	purge := false
	if c.QueryParam("purge") == "1" {
		if h.warmupToken == "" || c.Request().Header.Get("X-Warmup-Token") != h.warmupToken {
			return c.JSON(http.StatusForbidden, map[string]string{
				"detail": "purge requires valid X-Warmup-Token",
			})
		}
		purge = true
	}

	// 2. Cache check (purge=true ならスキップして再計算)
	if !purge {
		if cached, err := h.getRiskScoreCache(ctx); err == nil && cached != nil {
			return c.JSON(http.StatusOK, cached)
		}
	}

	var (
		nfpData       []map[string]any
		claimsData    []map[string]any
		allIndicators []map[string]any
		marketData    []map[string]any
		manualInputs  []map[string]any
	)

	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error {
		data, err := h.repo.ListNFPRows(gCtx, riskScoreNFPLimit)
		if err != nil {
			return err
		}
		nfpData = data
		return nil
	})

	g.Go(func() error {
		data, err := h.repo.ListClaimsRows(gCtx, riskScoreClaimsLimit)
		if err != nil {
			return err
		}
		claimsData = data
		return nil
	})

	g.Go(func() error {
		names := []string{"W875RX1", "UMCSENT", "DRCCLACBS", "CPILFESL", "JOLTS", "UNEMPLOY"}
		data, err := h.repo.ListIndicatorsByNames(gCtx, names, riskScoreIndicatorLimit)
		if err != nil {
			return err
		}
		allIndicators = data
		return nil
	})

	g.Go(func() error {
		data, err := h.repo.ListMarketIndicators(gCtx, 2)
		if err != nil {
			return err
		}
		marketData = data
		return nil
	})

	g.Go(func() error {
		metrics := []string{"ADP_CHANGE", "CHALLENGER_CUTS", "TRUFLATION"}
		data, err := h.repo.ListManualInputs(gCtx, metrics, 30)
		if err != nil {
			return err
		}
		manualInputs = data
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Internal server error"})
	}

	// Split indicators
	var consumerData, joltsData, unemployData []map[string]any
	consumerIndicators := map[string]bool{"W875RX1": true, "UMCSENT": true, "DRCCLACBS": true, "CPILFESL": true}
	for _, d := range allIndicators {
		ind := getString(d, "indicator")
		if consumerIndicators[ind] {
			consumerData = append(consumerData, d)
		}
		if ind == "JOLTS" {
			joltsData = append(joltsData, d)
		}
		if ind == "UNEMPLOY" {
			unemployData = append(unemployData, d)
		}
	}

	// Split manual inputs by metric
	manualByMetric := map[string][]map[string]any{}
	for _, row := range manualInputs {
		metric := getString(row, "metric")
		manualByMetric[metric] = append(manualByMetric[metric], row)
	}

	// Employment (50 points)
	nfpTrend := analysis.CalcNFPTrend(nfpData)
	sahmSub, sahmData := analysis.CalcSahmRule(nfpData)
	claims := analysis.CalcClaimsLevel(claimsData)
	discrepancy := analysis.CalcEmploymentDiscrepancy(nfpData, claimsData, manualByMetric)

	employmentScore := nfpTrend.Score + sahmSub.Score + claims.Score + discrepancy.Score
	employmentCat := model.RiskScoreCategory{
		Name: "雇用", Score: employmentScore, MaxScore: 50,
		Components: []model.RiskSubScore{nfpTrend, sahmSub, discrepancy, claims},
	}

	// Consumption (25 points)
	realIncome := analysis.CalcRealIncome(consumerData)
	sentiment := analysis.CalcConsumerSentiment(consumerData)
	delinquency := analysis.CalcCreditDelinquency(consumerData)
	inflationDisc := analysis.CalcInflationDiscrepancy(consumerData, manualByMetric)

	consumerScore := realIncome.Score + sentiment.Score + delinquency.Score + inflationDisc.Score
	consumerCat := model.RiskScoreCategory{
		Name: "消費", Score: consumerScore, MaxScore: 25,
		Components: []model.RiskSubScore{realIncome, sentiment, delinquency, inflationDisc},
	}

	// Structure (25 points)
	jobRatio := analysis.CalcJobOpeningsRatio(joltsData, unemployData)
	u6u3 := analysis.CalcU6U3Spread(nfpData)
	lfpr := analysis.CalcLaborParticipation(nfpData)
	kShape := analysis.CalcKShapeProxy(marketData)

	structureScore := jobRatio.Score + u6u3.Score + lfpr.Score + kShape.Score
	structureCat := model.RiskScoreCategory{
		Name: "構造", Score: structureScore, MaxScore: 25,
		Components: []model.RiskSubScore{jobRatio, u6u3, lfpr, kShape},
	}

	// Total
	rawTotal := employmentScore + consumerScore + structureScore
	totalScore := rawTotal
	if totalScore > 100 {
		totalScore = 100
	}

	// Alerts
	var alertFactors []string
	if sahmData.Triggered {
		alertFactors = append(alertFactors,
			fmt.Sprintf("サームルール発動: Sahm値 %.2f ≥ 0.50", *sahmData.SahmValue))
	}
	for _, cat := range []model.RiskScoreCategory{employmentCat, consumerCat, structureCat} {
		for _, comp := range cat.Components {
			if comp.Status == "danger" || comp.Status == "warning" {
				alertFactors = append(alertFactors, fmt.Sprintf("%s: %s", comp.Name, comp.Detail))
			}
		}
	}
	if alertFactors == nil {
		alertFactors = []string{}
	}

	// Build response maps
	var latestNFPMap map[string]any
	if len(nfpData) > 0 {
		latestNFPMap = nfpData[0]
	}
	var latestClaimsMap map[string]any
	if len(claimsData) > 0 {
		latestClaimsMap = claimsData[0]
	}

	result := model.EmploymentRiskScore{
		TotalScore:      totalScore,
		Phase:           analysis.GetPhase(totalScore),
		Categories:      []model.RiskScoreCategory{employmentCat, consumerCat, structureCat},
		SahmRule:        sahmData,
		AlertFactors:    alertFactors,
		Timestamp:       time.Now().Format(time.RFC3339),
		LatestNFP:       latestNFPMap,
		LatestClaims:    latestClaimsMap,
		NFPHistory:      nfpData,
		ClaimsHistory:   claimsData,
		ConsumerHistory: consumerData,
	}

	// Cache write (best-effort, errors are logged but not propagated)
	if err := h.setRiskScoreCache(ctx, &result); err != nil {
		slog.Warn("employment.risk-score cache set failed", "error", err)
	}

	return c.JSON(http.StatusOK, result)
}

// GetRiskHistory handles GET /api/employment/risk-history.
//
// Cache: 24h Redis (key: employment:risk_history:v1:{months})
// Purge: ?purge=1 with X-Warmup-Token header (used by batch warmup cron)
func (h *EmploymentHandler) GetRiskHistory(c echo.Context) error {
	months := 120
	if m := c.QueryParam("months"); m != "" {
		if parsed, err := strconv.Atoi(m); err == nil && parsed > 0 {
			months = parsed
		}
	}

	ctx := c.Request().Context()

	// 1. ?purge=1 認証 (DoS 対策、§5.1.B)
	purge := false
	if c.QueryParam("purge") == "1" {
		if h.warmupToken == "" || c.Request().Header.Get("X-Warmup-Token") != h.warmupToken {
			return c.JSON(http.StatusForbidden, map[string]string{
				"detail": "purge requires valid X-Warmup-Token",
			})
		}
		purge = true
	}

	// 2. Cache check
	if !purge {
		if cached, err := h.getRiskHistoryCache(ctx, months); err == nil && cached != nil {
			return c.JSON(http.StatusOK, cached)
		}
	}

	startDate := time.Now().AddDate(0, -(months + 12), 0).Format("2006-01-02")

	var (
		nfpData      []map[string]any
		claimsData   []map[string]any
		consumerData []map[string]any
		marketData   []map[string]any
	)

	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error {
		data, err := h.repo.ListNFPRowsForHistory(gCtx, months+24)
		if err != nil {
			return err
		}
		nfpData = data
		return nil
	})

	g.Go(func() error {
		data, err := h.repo.ListClaimsRowsSince(gCtx, startDate)
		if err != nil {
			return err
		}
		claimsData = data
		return nil
	})

	g.Go(func() error {
		data, err := h.repo.ListConsumerIndicatorsSince(gCtx, startDate)
		if err != nil {
			return err
		}
		consumerData = data
		return nil
	})

	g.Go(func() error {
		data, err := h.repo.ListMarketIndicatorsSince(gCtx, startDate)
		if err != nil {
			return err
		}
		marketData = data
		return nil
	})

	if err := g.Wait(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"detail": "Internal server error"})
	}

	// Reverse nfpData to ascending order
	nfpRows := make([]map[string]any, len(nfpData))
	for i, row := range nfpData {
		nfpRows[len(nfpData)-1-i] = row
	}

	// Index data by month
	nfpByMonth := map[string][]map[string]any{}
	for _, row := range nfpRows {
		key := getString(row, "reference_period")
		if len(key) >= 7 {
			key = key[:7]
		}
		nfpByMonth[key] = append(nfpByMonth[key], row)
	}

	umcsentByMonth := map[string]float64{}
	w875ByMonth := map[string]float64{}
	drcByMonth := map[string]float64{}
	joltsByMonth := map[string]float64{}
	unemployByMonth := map[string]float64{}
	for _, row := range consumerData {
		key := getString(row, "reference_period")
		if len(key) >= 7 {
			key = key[:7]
		}
		val := getFloatFromMap(row, "current_value")
		if val == nil {
			continue
		}
		ind := getString(row, "indicator")
		switch ind {
		case "UMCSENT":
			umcsentByMonth[key] = *val
		case "W875RX1":
			w875ByMonth[key] = *val
		case "DRCCLACBS":
			drcByMonth[key] = *val
		case "JOLTS":
			joltsByMonth[key] = *val
		case "UNEMPLOY":
			unemployByMonth[key] = *val
		}
	}

	claimsByMonth := map[string]float64{}
	for _, row := range claimsData {
		key := getString(row, "week_ending")
		if len(key) >= 7 {
			key = key[:7]
		}
		if v := getFloatFromMap(row, "initial_claims_4w_avg"); v != nil {
			claimsByMonth[key] = *v
		} else if v := getFloatFromMap(row, "initial_claims"); v != nil {
			claimsByMonth[key] = *v
		}
	}

	sp500ByMonth := map[string]float64{}
	rutSPXByMonth := map[string]float64{}
	for _, row := range marketData {
		key := getString(row, "date")
		if len(key) >= 7 {
			key = key[:7]
		}
		sp := getFloatFromMap(row, "sp500")
		if sp != nil {
			sp500ByMonth[key] = *sp
		}
		rut := getFloatFromMap(row, "russell2000")
		if sp != nil && rut != nil && *sp > 0 {
			rutSPXByMonth[key] = *rut / *sp
		}
	}

	// Get sorted month keys
	allMonthKeys := make([]string, 0, len(nfpByMonth))
	for k := range nfpByMonth {
		allMonthKeys = append(allMonthKeys, k)
	}
	sort.Strings(allMonthKeys)

	// Carry forward
	umcsentByMonth = carryForward(umcsentByMonth, allMonthKeys)
	w875ByMonth = carryForward(w875ByMonth, allMonthKeys)
	drcByMonth = carryForward(drcByMonth, allMonthKeys)
	joltsByMonth = carryForward(joltsByMonth, allMonthKeys)
	unemployByMonth = carryForward(unemployByMonth, allMonthKeys)
	claimsByMonth = carryForward(claimsByMonth, allMonthKeys)

	// Calculate monthly scores
	var history []model.RiskHistoryEntry
	var allU3Values []float64

	for idx, monthKey := range allMonthKeys {
		nfpMonthRows := nfpByMonth[monthKey]
		if len(nfpMonthRows) == 0 {
			continue
		}
		latestNFP := nfpMonthRows[len(nfpMonthRows)-1]

		u3 := getFloatFromMap(latestNFP, "u3_rate")
		if u3 != nil {
			allU3Values = append(allU3Values, *u3)
		}

		// Employment (50)
		start := idx - 2
		if start < 0 {
			start = 0
		}
		recentMonths := allMonthKeys[start : idx+1]
		var recentNFP []map[string]any
		for _, m := range recentMonths {
			rows := nfpByMonth[m]
			if len(rows) > 0 {
				recentNFP = append(recentNFP, rows[len(rows)-1])
			}
		}
		// Reverse for desc order
		for i, j := 0, len(recentNFP)-1; i < j; i, j = i+1, j-1 {
			recentNFP[i], recentNFP[j] = recentNFP[j], recentNFP[i]
		}
		nfpS := analysis.SimplifiedNFPScore(recentNFP)
		sahmS := analysis.SimplifiedSahmScore(append([]float64{}, allU3Values...))
		claimsVal := getOptionalFromMap(claimsByMonth, monthKey)
		claimsS := analysis.SimplifiedClaimsScore(claimsVal)
		employment := nfpS + sahmS + claimsS
		if employment > 50 {
			employment = 50
		}

		// Consumer (25)
		prevYrKey := ""
		if len(monthKey) >= 7 {
			yr, _ := strconv.Atoi(monthKey[:4])
			mo := monthKey[5:7]
			prevYrKey = fmt.Sprintf("%d-%s", yr-1, mo)
		}
		sentS := analysis.SimplifiedSentimentScore(
			getOptionalFromMap(umcsentByMonth, monthKey),
			getOptionalFromMap(umcsentByMonth, prevYrKey))
		incomeS := analysis.SimplifiedIncomeScore(
			getOptionalFromMap(w875ByMonth, monthKey),
			getOptionalFromMap(w875ByMonth, prevYrKey))
		drcS := analysis.SimplifiedDelinquencyScore(
			getOptionalFromMap(drcByMonth, monthKey),
			getOptionalFromMap(drcByMonth, prevYrKey))
		consumer := sentS + incomeS + drcS // inflation_disc = 0
		if consumer > 25 {
			consumer = 25
		}

		// Structure (25)
		jobS := analysis.SimplifiedJobRatioScore(
			getOptionalFromMap(joltsByMonth, monthKey),
			getOptionalFromMap(unemployByMonth, monthKey))
		u6u3S := analysis.SimplifiedU6U3Score(u3, getFloatFromMap(latestNFP, "u6_rate"))
		currentLFPR := getFloatFromMap(latestNFP, "labor_force_participation")
		var yearAgoLFPR *float64
		if idx >= 12 {
			prevYrMonth := allMonthKeys[idx-12]
			prevYrNFP := nfpByMonth[prevYrMonth]
			if len(prevYrNFP) > 0 {
				yearAgoLFPR = getFloatFromMap(prevYrNFP[len(prevYrNFP)-1], "labor_force_participation")
			}
		}
		lfprS := analysis.SimplifiedLFPRScore(currentLFPR, yearAgoLFPR)
		currentRatio := getOptionalFromMap(rutSPXByMonth, monthKey)
		kShapeS := analysis.SimplifiedKShapeScore(currentRatio)
		structure := jobS + u6u3S + lfprS + kShapeS
		if structure > 25 {
			structure = 25
		}

		total := employment + consumer + structure
		if total > 100 {
			total = 100
		}

		var sahmValue *float64
		if len(allU3Values) >= 3 {
			avgs3m := make([]float64, 0, len(allU3Values)-2)
			for i := 2; i < len(allU3Values); i++ {
				sum := allU3Values[i-2] + allU3Values[i-1] + allU3Values[i]
				avgs3m = append(avgs3m, sum/3.0)
			}
			c3m := avgs3m[len(avgs3m)-1]
			window := avgs3m
			if len(avgs3m) > 12 {
				window = avgs3m[len(avgs3m)-12:]
			}
			low12m := window[0]
			for _, v := range window[1:] {
				if v < low12m {
					low12m = v
				}
			}
			sv := math.Round((c3m-low12m)*100) / 100
			sahmValue = &sv
		}

		phase := analysis.GetPhase(total)

		refPeriod := getString(latestNFP, "reference_period")
		history = append(history, model.RiskHistoryEntry{
			Date:            refPeriod,
			TotalScore:      total,
			EmploymentScore: employment,
			ConsumerScore:   consumer,
			StructureScore:  structure,
			Phase:           phase.Code,
			SahmValue:       sahmValue,
		})
	}

	// Overlay latest month with real-time calculation
	if len(history) > 0 {
		h.overlayLatestMonth(&history, nfpRows, claimsData, marketData)
	}

	// Build SP500 list
	sp500Keys := make([]string, 0, len(sp500ByMonth))
	for k := range sp500ByMonth {
		sp500Keys = append(sp500Keys, k)
	}
	sort.Strings(sp500Keys)

	sp500List := make([]model.SP500Entry, 0, len(sp500Keys))
	for _, k := range sp500Keys {
		sp500List = append(sp500List, model.SP500Entry{
			Date:  k + "-01",
			Close: sp500ByMonth[k],
		})
	}

	result := model.RiskHistoryResponse{
		History: history,
		SP500:   sp500List,
	}

	// Cache write (best-effort)
	if err := h.setRiskHistoryCache(ctx, months, &result); err != nil {
		slog.Warn("employment.risk-history cache set failed", "error", err, "months", months)
	}

	return c.JSON(http.StatusOK, result)
}

// overlayLatestMonth replaces the last history entry with a real-time computed score.
func (h *EmploymentHandler) overlayLatestMonth(history *[]model.RiskHistoryEntry, nfpRows, claimsRows, sp500Rows []map[string]any) {
	// Build latest NFP desc (last 24)
	start := 0
	if len(nfpRows) > 24 {
		start = len(nfpRows) - 24
	}
	latestNFPDesc := make([]map[string]any, 0, 24)
	for i := len(nfpRows) - 1; i >= start; i-- {
		latestNFPDesc = append(latestNFPDesc, nfpRows[i])
	}

	// Claims desc
	latestClaimsDesc := make([]map[string]any, len(claimsRows))
	copy(latestClaimsDesc, claimsRows)
	sort.Slice(latestClaimsDesc, func(i, j int) bool {
		return getString(latestClaimsDesc[i], "week_ending") > getString(latestClaimsDesc[j], "week_ending")
	})

	// Employment (50) — without discrepancy (no manual_inputs)
	rtNFP := analysis.CalcNFPTrend(latestNFPDesc)
	rtSahm, _ := analysis.CalcSahmRule(latestNFPDesc)
	rtClaims := analysis.CalcClaimsLevel(latestClaimsDesc)
	rtEmp := rtNFP.Score + rtSahm.Score + rtClaims.Score
	if rtEmp > 50 {
		rtEmp = 50
	}

	// Consumer (25) — fetch overlay indicators inline
	// Note: This uses the data already available; for full accuracy we'd need another query.
	// Keep simplified for overlay since risk-history is cached.
	rtCon := (*history)[len(*history)-1].ConsumerScore

	// Structure (25) — market desc
	marketDesc := make([]map[string]any, len(sp500Rows))
	copy(marketDesc, sp500Rows)
	sort.Slice(marketDesc, func(i, j int) bool {
		return getString(marketDesc[i], "date") > getString(marketDesc[j], "date")
	})
	if len(marketDesc) > 2 {
		marketDesc = marketDesc[:2]
	}

	rtU6U3 := analysis.CalcU6U3Spread(latestNFPDesc)
	rtLFPR := analysis.CalcLaborParticipation(latestNFPDesc)
	rtKShape := analysis.CalcKShapeProxy(marketDesc)
	rtStr := rtU6U3.Score + rtLFPR.Score + rtKShape.Score
	if rtStr > 25 {
		rtStr = 25
	}

	rtTotal := rtEmp + rtCon + rtStr
	if rtTotal > 100 {
		rtTotal = 100
	}

	lastIdx := len(*history) - 1
	(*history)[lastIdx] = model.RiskHistoryEntry{
		Date:            (*history)[lastIdx].Date,
		TotalScore:      rtTotal,
		EmploymentScore: rtEmp,
		ConsumerScore:   rtCon,
		StructureScore:  rtStr,
		Phase:           analysis.GetPhase(rtTotal).Code,
		SahmValue:       (*history)[lastIdx].SahmValue,
	}
}

// --- helper functions ---

func getString(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	case time.Time:
		return s.Format("2006-01-02")
	default:
		return fmt.Sprintf("%v", v)
	}
}

func getFloatFromMap(m map[string]any, key string) *float64 {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch n := v.(type) {
	case float64:
		return &n
	case float32:
		f := float64(n)
		return &f
	case int:
		f := float64(n)
		return &f
	case int32:
		f := float64(n)
		return &f
	case int64:
		f := float64(n)
		return &f
	case pgtype.Numeric:
		f, err := n.Float64Value()
		if err != nil || !f.Valid {
			return nil
		}
		return &f.Float64
	default:
		return nil
	}
}

func getOptionalFromMap(m map[string]float64, key string) *float64 {
	v, ok := m[key]
	if !ok {
		return nil
	}
	return &v
}

func carryForward(d map[string]float64, allKeys []string) map[string]float64 {
	filled := make(map[string]float64, len(allKeys))
	var lastVal *float64
	for _, k := range allKeys {
		if v, ok := d[k]; ok {
			lastVal = &v
		}
		if lastVal != nil {
			filled[k] = *lastVal
		}
	}
	return filled
}

// --- Cache helpers (Redis skill: conn-timeouts, ram-ttl, data-key-naming) ---
//
// All cache operations use a per-operation context.WithTimeout to prevent
// Redis latency from blocking the API request. On any error (timeout,
// connection failure, marshal/unmarshal error) the helpers return so that
// the caller falls through to the cache miss / DB recompute path.
//
// Pattern intentionally mirrors api-go/internal/handler/fx.go (getCache/setCache).

func (h *EmploymentHandler) getRiskScoreCache(parent context.Context) (*model.EmploymentRiskScore, error) {
	if h.redis == nil {
		return nil, redis.Nil
	}
	ctx, cancel := context.WithTimeout(parent, employmentCacheGetTimeout)
	defer cancel()

	data, err := h.redis.Get(ctx, employmentRiskScoreKey).Bytes()
	if err != nil {
		return nil, err
	}
	var score model.EmploymentRiskScore
	if err := json.Unmarshal(data, &score); err != nil {
		return nil, err
	}
	return &score, nil
}

func (h *EmploymentHandler) setRiskScoreCache(parent context.Context, score *model.EmploymentRiskScore) error {
	if h.redis == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, employmentCacheSetTimeout)
	defer cancel()

	data, err := json.Marshal(score)
	if err != nil {
		return err
	}
	return h.redis.Set(ctx, employmentRiskScoreKey, data, employmentRiskScoreTTL).Err()
}

func (h *EmploymentHandler) getRiskHistoryCache(parent context.Context, months int) (*model.RiskHistoryResponse, error) {
	if h.redis == nil {
		return nil, redis.Nil
	}
	ctx, cancel := context.WithTimeout(parent, employmentCacheGetTimeout)
	defer cancel()

	key := fmt.Sprintf("employment:risk_history:v1:%d", months)
	data, err := h.redis.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}
	var resp model.RiskHistoryResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (h *EmploymentHandler) setRiskHistoryCache(parent context.Context, months int, resp *model.RiskHistoryResponse) error {
	if h.redis == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, employmentCacheSetTimeout)
	defer cancel()

	key := fmt.Sprintf("employment:risk_history:v1:%d", months)
	data, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	return h.redis.Set(ctx, key, data, employmentRiskHistoryTTL).Err()
}
