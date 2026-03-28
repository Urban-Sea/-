// Package analysis ports the Python liquidity_score.py calculations to Go.
//
// All calculation functions produce results within ±0.01 of the Python version.
// Stress scores range from 0 (healthy) to 100 (critical).
package analysis

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// ============================================================
// Constants
// ============================================================

// ITBubblePeak2YChange is the peak 2-year margin debt change rate during the IT bubble.
const ITBubblePeak2YChange = 104.68

// phaseThreshold maps change_2y ranges to labels and stress scores.
type phaseThreshold struct {
	upperBound float64
	label      string
	stress     int
}

var phaseThresholds = []phaseThreshold{
	{40, "健全", 20},
	{60, "警戒", 40},
	{80, "高警戒", 70},
	{100, "危険", 90},
	{math.Inf(1), "臨界", 100},
}

// ============================================================
// Layer 1: 政策流動性 (Net Liquidity Z-score)
// ============================================================

// Layer1Result holds the Layer 1 stress calculation output.
type Layer1Result struct {
	StressScore    int     `json:"stress_score"`
	ZScore         float64 `json:"z_score"`
	NetLiquidity   float64 `json:"net_liquidity"`
	Interpretation string  `json:"interpretation"`
}

// CalculateLayer1Stress computes the Layer 1 (policy liquidity) stress score.
// windowSize defaults to 520 (~10 years of weekly data).
func CalculateLayer1Stress(netLiquidity float64, historicalValues []float64, windowSize int) Layer1Result {
	if windowSize <= 0 {
		windowSize = 520
	}

	if len(historicalValues) < 2 {
		return Layer1Result{
			StressScore:    50,
			ZScore:         0.0,
			NetLiquidity:   netLiquidity,
			Interpretation: "データ不足",
		}
	}

	// Use the last windowSize values.
	window := historicalValues
	if len(window) > windowSize {
		window = window[len(window)-windowSize:]
	}

	mean := calcMean(window)
	stdev := calcStdev(window) // sample stdev (ddof=1)

	var zScore float64
	if stdev == 0 {
		zScore = 0.0
	} else {
		zScore = (netLiquidity - mean) / stdev
	}

	// Z-score → Stress: Z=+1.5 → 10, Z=0 → 50, Z=-1.5 → 90
	stress := 50.0 - (zScore * 26.67)
	stress = clamp(stress, 0, 100)

	var interp string
	switch {
	case stress < 30:
		interp = "流動性は十分に潤沢"
	case stress < 50:
		interp = "流動性は平均的"
	case stress < 70:
		interp = "流動性は減少傾向"
	default:
		interp = "流動性は逼迫状態"
	}

	return Layer1Result{
		StressScore:    int(stress),
		ZScore:         roundTo(zScore, 2),
		NetLiquidity:   netLiquidity,
		Interpretation: interp,
	}
}

// ============================================================
// Layer 2A: 銀行システム (Banking System)
// ============================================================

// Layer2AResult holds the Layer 2A stress calculation output.
type Layer2AResult struct {
	StressScore        int                    `json:"stress_score"`
	Interpretation     string                 `json:"interpretation"`
	InterpretationType string                 `json:"interpretation_type"`
	Alerts             []string               `json:"alerts"`
	Components         map[string]interface{} `json:"components"`
}

// CalculateLayer2AStress computes the Layer 2A (banking system) stress score.
// Weights: reserves=20%, KRE=20%, SRF=40%, IG=20%.
func CalculateLayer2AStress(
	reservesChangeMoM *float64,
	kre52wChange *float64,
	srfUsage *float64,
	igSpread *float64,
	srfConsecutiveDays *int,
	srfDays90d *int,
) Layer2AResult {
	var alerts []string
	reservesScore := 0
	kreScore := 0
	srfScore := 0
	igScore := 0

	// Reserves change
	if reservesChangeMoM != nil {
		v := *reservesChangeMoM
		switch {
		case v < -10:
			reservesScore = 25
			alerts = append(alerts, "準備預金急減（-10%超）")
		case v < -5:
			reservesScore = 15
			alerts = append(alerts, "準備預金減少（-5%超）")
		case v < 0:
			reservesScore = 8
		case v > 10:
			reservesScore = -5
		}
	}

	// KRE 52-week change
	if kre52wChange != nil {
		v := *kre52wChange
		switch {
		case v < -30:
			kreScore = 25
			alerts = append(alerts, "銀行株急落（-30%超）")
		case v < -20:
			kreScore = 20
			alerts = append(alerts, "銀行株大幅下落（-20%超）")
		case v < -10:
			kreScore = 12
			alerts = append(alerts, "銀行株下落（-10%超）")
		case v > 20:
			kreScore = -5
		}
	}

	// SRF usage
	srfAmountScore := 0
	srfDaysScore := 0

	if srfUsage != nil && *srfUsage > 0 {
		v := *srfUsage
		switch {
		case v >= 200:
			srfAmountScore = 15
			alerts = append(alerts, fmt.Sprintf("SRF月間大量利用（30日累計%.0fB）", v))
		case v >= 100:
			srfAmountScore = 12
		case v >= 50:
			srfAmountScore = 8
		case v >= 20:
			srfAmountScore = 5
		default:
			srfAmountScore = 2
		}
	}

	if srfConsecutiveDays != nil && *srfConsecutiveDays > 0 {
		d := *srfConsecutiveDays
		switch {
		case d >= 15:
			srfDaysScore = 15
			alerts = append(alerts, fmt.Sprintf("SRF恒常的利用（月%d日）", d))
		case d >= 10:
			srfDaysScore = 12
		case d >= 5:
			srfDaysScore = 8
		case d >= 2:
			srfDaysScore = 4
		default:
			srfDaysScore = 2
		}
	}

	srfScore = max(srfAmountScore, srfDaysScore)
	if srfAmountScore >= 10 && srfDaysScore >= 8 {
		srfScore = min(25, srfScore+5)
	}

	// 90-day dependency
	if srfDays90d != nil && *srfDays90d > 0 {
		dependencyRate := float64(*srfDays90d) / 90.0 * 100.0
		var bonus int
		switch {
		case dependencyRate > 50:
			bonus = 8
		case dependencyRate > 30:
			bonus = 5
		case dependencyRate > 10:
			bonus = 3
		}
		srfScore = min(25, srfScore+bonus)
	}

	// IG spread
	if igSpread != nil {
		v := *igSpread
		switch {
		case v > 2.0:
			igScore = 25
			alerts = append(alerts, fmt.Sprintf("IGスプレッド拡大（%.2f%%）", v))
		case v > 1.5:
			igScore = 15
			alerts = append(alerts, fmt.Sprintf("IGスプレッド警戒（%.2f%%）", v))
		case v > 1.0:
			igScore = 8
		case v < 0.8:
			igScore = -3
		}
	}

	// Clip to [0, 25]
	reservesScore = clampInt(reservesScore, 0, 25)
	kreScore = clampInt(kreScore, 0, 25)
	srfScore = clampInt(srfScore, 0, 25)
	igScore = clampInt(igScore, 0, 25)

	// Weighted average
	weightedSum := float64(reservesScore)*0.20 +
		float64(kreScore)*0.20 +
		float64(srfScore)*0.40 +
		float64(igScore)*0.20
	stress := 15.0 + weightedSum*3.4
	stress = clamp(stress, 0, 100)

	// Interpretation type
	hasCreditStress := (kre52wChange != nil && *kre52wChange < -10) ||
		(igSpread != nil && *igSpread > 1.5)
	hasSRFDependency := (srfDays90d != nil && *srfDays90d > 9) ||
		(srfConsecutiveDays != nil && *srfConsecutiveDays >= 5)

	interpType := "NORMAL"
	var interp string
	switch {
	case stress < 30:
		interp = "銀行システムは健全"
		interpType = "HEALTHY"
	case stress < 50:
		interp = "銀行システムは安定"
		interpType = "STABLE"
	default: // stress >= 50
		switch {
		case hasCreditStress && hasSRFDependency:
			interp = "銀行システム危機の兆候"
			interpType = "CRISIS"
		case hasCreditStress:
			interp = "銀行システムにストレス発生"
			interpType = "CREDIT_STRESS"
		case hasSRFDependency:
			interp = "Fed施設への流動性依存"
			interpType = "FED_DEPENDENCY"
		default:
			interp = "銀行システムに警戒シグナル"
			interpType = "WARNING"
		}
	}

	if alerts == nil {
		alerts = []string{}
	}

	return Layer2AResult{
		StressScore:        int(stress),
		Interpretation:     interp,
		InterpretationType: interpType,
		Alerts:             alerts,
		Components: map[string]interface{}{
			"reserves_change_mom": reservesChangeMoM,
			"kre_52w_change":     kre52wChange,
			"srf_usage":          srfUsage,
			"ig_spread":          igSpread,
			"reserves":           reservesScore,
			"kre":                kreScore,
			"srf":                srfScore,
			"ig":                 igScore,
		},
	}
}

// ============================================================
// Layer 2B: リスク許容度 (Market Risk Appetite)
// ============================================================

// Layer2BResult holds the Layer 2B stress calculation output.
type Layer2BResult struct {
	StressScore        int                    `json:"stress_score"`
	Phase              string                 `json:"phase"`
	MarginDebt2Y       float64                `json:"margin_debt_2y"`
	MarginDebt1Y       *float64               `json:"margin_debt_1y"`
	ITBubbleComparison float64                `json:"it_bubble_comparison"`
	ITBubblePeak       float64                `json:"it_bubble_peak"`
	Components         map[string]interface{} `json:"components"`
}

func getPhaseStress(change2y float64) int {
	for _, t := range phaseThresholds {
		if change2y < t.upperBound {
			return t.stress
		}
	}
	return 100
}

func getPhaseLabel(change2y float64) string {
	for _, t := range phaseThresholds {
		if change2y < t.upperBound {
			return t.label
		}
	}
	return "臨界"
}

// CalculateLayer2BStress computes the Layer 2B (risk appetite) stress score.
// Weights: margin_debt=80%, MMF=20%.
func CalculateLayer2BStress(
	marginDebt2Y float64,
	marginDebt1Y *float64,
	mmfChange *float64,
	vix *float64,
) Layer2BResult {
	marginScore := getPhaseStress(marginDebt2Y)
	phaseLabel := getPhaseLabel(marginDebt2Y)

	mmfScore := 50
	if mmfChange != nil {
		invertedMMF := -*mmfChange
		mmfScore = clampInt(int(50.0+invertedMMF*2.5), 0, 100)
	}

	var finalStress int
	if mmfChange != nil {
		finalStress = int(float64(marginScore)*0.8 + float64(mmfScore)*0.2)
	} else {
		finalStress = marginScore
	}
	finalStress = clampInt(finalStress, 0, 100)

	itBubbleComparison := roundTo((marginDebt2Y/ITBubblePeak2YChange)*100.0, 1)

	var mmfScorePtr *int
	if mmfChange != nil {
		v := mmfScore
		mmfScorePtr = &v
	}

	return Layer2BResult{
		StressScore:        finalStress,
		Phase:              phaseLabel,
		MarginDebt2Y:       marginDebt2Y,
		MarginDebt1Y:       marginDebt1Y,
		ITBubbleComparison: itBubbleComparison,
		ITBubblePeak:       ITBubblePeak2YChange,
		Components: map[string]interface{}{
			"margin_debt_2y": marginDebt2Y,
			"margin_debt_1y": marginDebt1Y,
			"mmf_change":     mmfChange,
			"margin_score":   marginScore,
			"mmf_score":      mmfScorePtr,
		},
	}
}

// ============================================================
// Credit Pressure (Layer 3 — not scored)
// ============================================================

// CreditPressureComponent holds value + status for a single component.
type CreditPressureComponent struct {
	Value  *float64 `json:"value"`
	Status string   `json:"status"`
}

// CreditPressureResult holds the credit pressure assessment.
type CreditPressureResult struct {
	Level         string                              `json:"level"`
	PressureCount int                                 `json:"pressure_count"`
	Components    map[string]CreditPressureComponent  `json:"components"`
	Alerts        []string                            `json:"alerts"`
}

// CalculateCreditPressure assesses credit market pressure.
func CalculateCreditPressure(
	hySpread *float64,
	igSpread *float64,
	yieldCurve *float64,
	dxy *float64,
) CreditPressureResult {
	pressureCount := 0
	var alerts []string
	components := map[string]CreditPressureComponent{
		"hy_spread":   {Value: hySpread, Status: "normal"},
		"ig_spread":   {Value: igSpread, Status: "normal"},
		"yield_curve": {Value: yieldCurve, Status: "normal"},
		"dxy":         {Value: dxy, Status: "normal"},
	}

	if hySpread != nil {
		v := *hySpread
		if v > 5.0 {
			pressureCount += 2
			alerts = append(alerts, fmt.Sprintf("HYスプレッド高水準（%.2f%%）", v))
			components["hy_spread"] = CreditPressureComponent{Value: hySpread, Status: "danger"}
		} else if v > 3.5 {
			pressureCount += 1
			alerts = append(alerts, fmt.Sprintf("HYスプレッド警戒（%.2f%%）", v))
			components["hy_spread"] = CreditPressureComponent{Value: hySpread, Status: "warning"}
		}
	}

	if igSpread != nil {
		v := *igSpread
		if v > 1.5 {
			pressureCount += 2
			alerts = append(alerts, fmt.Sprintf("IGスプレッド拡大（%.2f%%）", v))
			components["ig_spread"] = CreditPressureComponent{Value: igSpread, Status: "danger"}
		} else if v > 1.0 {
			pressureCount += 1
			alerts = append(alerts, fmt.Sprintf("IGスプレッド警戒（%.2f%%）", v))
			components["ig_spread"] = CreditPressureComponent{Value: igSpread, Status: "warning"}
		}
	}

	if yieldCurve != nil {
		v := *yieldCurve
		if v < 0 {
			pressureCount += 2
			alerts = append(alerts, fmt.Sprintf("逆イールド（%.2f%%）", v))
			components["yield_curve"] = CreditPressureComponent{Value: yieldCurve, Status: "danger"}
		} else if v < 0.5 {
			pressureCount += 1
			alerts = append(alerts, fmt.Sprintf("フラット化（%.2f%%）", v))
			components["yield_curve"] = CreditPressureComponent{Value: yieldCurve, Status: "warning"}
		}
	}

	if dxy != nil {
		v := *dxy
		if v > 105 {
			pressureCount += 1
			alerts = append(alerts, fmt.Sprintf("ドル高（DXY: %.1f）", v))
			components["dxy"] = CreditPressureComponent{Value: dxy, Status: "warning"}
		}
	}

	var level string
	switch {
	case pressureCount >= 5:
		level = "High"
	case pressureCount >= 2:
		level = "Medium"
	default:
		level = "Low"
	}

	if alerts == nil {
		alerts = []string{}
	}

	return CreditPressureResult{
		Level:         level,
		PressureCount: pressureCount,
		Components:    components,
		Alerts:        alerts,
	}
}

// ============================================================
// Market State Determination
// ============================================================

// MarketStateDef holds the static definition of a market state.
type MarketStateDef struct {
	Label       string
	Description string
	Action      string
	Color       string
}

// MarketStateDefinitions maps state codes to their definitions.
var MarketStateDefinitions = map[string]MarketStateDef{
	"LIQUIDITY_SHOCK": {
		Label:       "流動性ショック",
		Description: "銀行システムで高ストレスまたは急激なストレス上昇を検出。緊急事態の可能性。",
		Action:      "防御態勢、現金比率UP",
		Color:       "red",
	},
	"CREDIT_CONTRACTION": {
		Label:       "信用収縮",
		Description: "銀行システムにストレス発生。信用供給が制限される可能性。",
		Action:      "信用取引厳禁、様子見",
		Color:       "orange",
	},
	"POLICY_TIGHTENING": {
		Label:       "政策引き締め",
		Description: "FRBの流動性供給が縮小中。市場への逆風に注意。",
		Action:      "リスク資産への逆風に注意",
		Color:       "yellow",
	},
	"SPLIT_BUBBLE": {
		Label:       "分断型バブル",
		Description: "銀行システムにストレスがある一方、市場は過熱中。脆弱な上昇相場。",
		Action:      "段階的にリスク縮小",
		Color:       "orange",
	},
	"MARKET_OVERSHOOT": {
		Label:       "市場先行型",
		Description: "銀行・政策は安定だが、市場参加者の信用取引が先行して過熱中。",
		Action:      "利確検討、新規抑制",
		Color:       "yellow",
	},
	"FINANCIAL_RALLY": {
		Label:       "金融相場",
		Description: "政策流動性が潤沢で、市場に資金が流入中。上昇しやすい環境。",
		Action:      "積極的にリスクオン",
		Color:       "cyan",
	},
	"HEALTHY": {
		Label:       "健全相場",
		Description: "全Layerで流動性が安定。通常の相場環境。",
		Action:      "通常投資を継続",
		Color:       "green",
	},
	"NEUTRAL": {
		Label:       "中立",
		Description: "特定の状態パターンに該当しない。個別指標を確認してください。",
		Action:      "現状維持",
		Color:       "gray",
	},
}

// MarketStateEntry is a matched state entry.
type MarketStateEntry struct {
	Code        string `json:"code"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Action      string `json:"action"`
	Color       string `json:"color"`
	Priority    int    `json:"priority"`
}

// MarketStateResult is the market state determination result.
type MarketStateResult struct {
	Code        string             `json:"code"`
	Label       string             `json:"label"`
	Description string             `json:"description"`
	Action      string             `json:"action"`
	Color       string             `json:"color"`
	Comment     string             `json:"comment"`
	AllStates   []MarketStateEntry `json:"all_states"`
	StateCount  int                `json:"state_count"`
}

func adjustDescriptionByL2AType(stateCode, description string, l2aType *string) string {
	if l2aType == nil {
		return description
	}
	t := *l2aType
	switch stateCode {
	case "CREDIT_CONTRACTION":
		switch t {
		case "FED_DEPENDENCY":
			return "Fed緊急流動性施設(SRF)への依存が高まっている。潜在的な流動性リスクに注意。"
		case "CRISIS":
			return "銀行システム危機の兆候。銀行信用ストレスとFed施設への依存が同時発生。"
		}
	case "SPLIT_BUBBLE":
		switch t {
		case "FED_DEPENDENCY":
			return "Fed施設依存下で市場が過熱中。流動性は脆弱だが、銀行信用自体は安定。"
		case "CRISIS":
			return "銀行危機の兆候がある中で市場が過熱。極めて脆弱な上昇相場。"
		}
	case "LIQUIDITY_SHOCK":
		switch t {
		case "FED_DEPENDENCY":
			return "Fed施設への構造的依存が深刻化。緊急流動性供給に頼った不安定な状態。"
		case "CRISIS":
			return "銀行システム危機。信用ストレスとFed依存が同時に高水準。"
		}
	}
	return description
}

// DetermineMarketState determines the market state from layer stress scores.
func DetermineMarketState(
	layer1Stress, layer2aStress, layer2bStress int,
	l2aInterpretationType *string,
) MarketStateResult {
	type condition struct {
		matches  bool
		code     string
		priority int
	}

	conditions := []condition{
		{layer2aStress >= 65, "LIQUIDITY_SHOCK", 1},
		{layer2aStress >= 50, "CREDIT_CONTRACTION", 2},
		{layer1Stress >= 45, "POLICY_TIGHTENING", 3},
		{layer2aStress >= 40 && layer2bStress >= 70, "SPLIT_BUBBLE", 4},
		{layer2bStress >= 80 && layer2aStress < 35, "MARKET_OVERSHOOT", 5},
		{layer1Stress < 30 && layer2bStress > 60, "FINANCIAL_RALLY", 6},
		{layer1Stress < 35 && layer2aStress < 35 && layer2bStress < 40, "HEALTHY", 7},
	}

	// Find primary (first match).
	primaryCode := "NEUTRAL"
	for _, c := range conditions {
		if c.matches {
			primaryCode = c.code
			break
		}
	}

	primaryDef := MarketStateDefinitions[primaryCode]
	primaryDesc := adjustDescriptionByL2AType(primaryCode, primaryDef.Description, l2aInterpretationType)

	// Collect all matching states.
	var allStates []MarketStateEntry
	for _, c := range conditions {
		if c.matches {
			def := MarketStateDefinitions[c.code]
			desc := adjustDescriptionByL2AType(c.code, def.Description, l2aInterpretationType)
			allStates = append(allStates, MarketStateEntry{
				Code:        c.code,
				Label:       def.Label,
				Description: desc,
				Action:      def.Action,
				Color:       def.Color,
				Priority:    c.priority,
			})
		}
	}

	if len(allStates) == 0 {
		def := MarketStateDefinitions["NEUTRAL"]
		allStates = append(allStates, MarketStateEntry{
			Code:        "NEUTRAL",
			Label:       def.Label,
			Description: def.Description,
			Action:      def.Action,
			Color:       def.Color,
			Priority:    10,
		})
	}

	sort.Slice(allStates, func(i, j int) bool {
		return allStates[i].Priority < allStates[j].Priority
	})

	comment := GenerateMarketComment(primaryCode, layer1Stress, layer2aStress, layer2bStress)

	return MarketStateResult{
		Code:        primaryCode,
		Label:       primaryDef.Label,
		Description: primaryDesc,
		Action:      primaryDef.Action,
		Color:       primaryDef.Color,
		Comment:     comment,
		AllStates:   allStates,
		StateCount:  len(allStates),
	}
}

// GenerateMarketComment generates an auto-comment for the market state.
func GenerateMarketComment(stateCode string, layer1Stress, layer2aStress, layer2bStress int) string {
	var comments []string

	stateComments := map[string]string{
		"HEALTHY":             "流動性環境は健全。リスク資産への追い風が期待できる状況。",
		"FINANCIAL_RALLY":     "政策流動性が潤沢で、金融相場の様相。実体経済との乖離に注意。",
		"MARKET_OVERSHOOT":    "信用取引主導で市場が先行して過熱中。投機的動きが目立つ。",
		"SPLIT_BUBBLE":        "銀行ストレスの中での上昇。脆弱な相場構造に警戒。",
		"LIQUIDITY_SHOCK":     "緊急事態。銀行システムで急激なストレス上昇。リスク資産は回避推奨。",
		"CREDIT_CONTRACTION":  "銀行ストレス発生。信用供給が制限される可能性。守りの姿勢を推奨。",
		"POLICY_TIGHTENING":   "FRBの流動性供給が縮小中。株式市場への逆風に注意。",
		"NEUTRAL":             "明確な状態パターンなし。各Layerの個別動向を注視。",
	}
	if c, ok := stateComments[stateCode]; ok {
		comments = append(comments, c)
	}

	if layer1Stress >= 70 {
		comments = append(comments, "政策流動性が逼迫。FRBの動向に注目。")
	} else if layer1Stress <= 30 {
		comments = append(comments, "政策流動性は潤沢。")
	}

	if layer2aStress >= 70 {
		comments = append(comments, "銀行システムにストレス。金融機関の健全性に注意。")
	} else if layer2aStress <= 30 {
		comments = append(comments, "銀行システムは健全。")
	}

	return strings.Join(comments, " ")
}

// ============================================================
// Event Detection System
// ============================================================

// MarketEvent represents a detected market event.
type MarketEvent struct {
	EventType    string  `json:"event_type"`
	EventLabel   string  `json:"event_label"`
	Severity     string  `json:"severity"` // CRITICAL, ALERT, WARNING
	Description  string  `json:"description"`
	TriggerValue float64 `json:"trigger_value"`
	Threshold    float64 `json:"threshold"`
}

type eventDef struct {
	label       string
	description string
}

var eventDefinitions = map[string]eventDef{
	"FUNDING_STRESS":   {"資金調達ストレス", "準備預金が急減。銀行間市場で流動性逼迫の兆候。"},
	"LIQUIDITY_DRAIN":  {"流動性急減", "Net Liquidityが急激に減少。市場全体への資金供給が縮小。"},
	"BANK_STRESS":      {"銀行ストレス", "銀行株が急落。金融システムへの懸念が浮上。"},
	"VOLATILITY_SHOCK": {"ボラティリティショック", "VIXが急騰。市場参加者のリスク回避が急速に進行。"},
	"CREDIT_SPIKE":     {"クレジットスパイク", "社債スプレッドが急拡大。信用リスクへの警戒が高まっている。"},
	"REPO_STRESS":      {"レポ市場ストレス", "レポ金利が急騰または異常値。短期資金市場に問題発生。"},
}

func detectFundingStress(reservesChange1m, reservesChange1w *float64) *MarketEvent {
	d := eventDefinitions["FUNDING_STRESS"]
	if reservesChange1m != nil {
		v := *reservesChange1m
		switch {
		case v <= -15:
			return &MarketEvent{"FUNDING_STRESS", d.label, "CRITICAL", d.description, v, -15}
		case v <= -10:
			return &MarketEvent{"FUNDING_STRESS", d.label, "ALERT", d.description, v, -10}
		case v <= -5:
			return &MarketEvent{"FUNDING_STRESS", d.label, "WARNING", d.description, v, -5}
		}
	}
	if reservesChange1w != nil && *reservesChange1w <= -5 {
		return &MarketEvent{"FUNDING_STRESS", d.label, "ALERT",
			"準備預金が1週間で急減。短期的な流動性逼迫。", *reservesChange1w, -5}
	}
	return nil
}

func detectLiquidityDrain(nlChange3m, nlChange1m *float64) *MarketEvent {
	d := eventDefinitions["LIQUIDITY_DRAIN"]
	if nlChange3m != nil {
		v := *nlChange3m
		switch {
		case v <= -20:
			return &MarketEvent{"LIQUIDITY_DRAIN", d.label, "CRITICAL", d.description, v, -20}
		case v <= -15:
			return &MarketEvent{"LIQUIDITY_DRAIN", d.label, "ALERT", d.description, v, -15}
		case v <= -10:
			return &MarketEvent{"LIQUIDITY_DRAIN", d.label, "WARNING", d.description, v, -10}
		}
	}
	if nlChange1m != nil && *nlChange1m <= -10 {
		return &MarketEvent{"LIQUIDITY_DRAIN", d.label, "ALERT",
			"Net Liquidityが1ヶ月で急減。短期的な資金供給縮小。", *nlChange1m, -10}
	}
	return nil
}

func detectBankStress(kreChange2m, kreChange1m *float64) *MarketEvent {
	d := eventDefinitions["BANK_STRESS"]
	if kreChange2m != nil {
		v := *kreChange2m
		switch {
		case v <= -25:
			return &MarketEvent{"BANK_STRESS", d.label, "CRITICAL", d.description, v, -25}
		case v <= -15:
			return &MarketEvent{"BANK_STRESS", d.label, "ALERT", d.description, v, -15}
		}
	}
	if kreChange1m != nil && *kreChange1m <= -15 {
		return &MarketEvent{"BANK_STRESS", d.label, "ALERT",
			"銀行株が1ヶ月で急落。金融セクターへの懸念。", *kreChange1m, -15}
	}
	return nil
}

func detectVolatilityShock(vixCurrent, vix1mAgo, vix1wAgo *float64) *MarketEvent {
	d := eventDefinitions["VOLATILITY_SHOCK"]
	if vixCurrent != nil {
		v := *vixCurrent
		if v >= 40 {
			return &MarketEvent{"VOLATILITY_SHOCK", d.label, "CRITICAL",
				"VIXが40を超え、パニック水準に到達。", v, 40}
		}
		if v >= 30 {
			return &MarketEvent{"VOLATILITY_SHOCK", d.label, "ALERT",
				"VIXが30を超え、高警戒水準。", v, 30}
		}
		if vix1wAgo != nil && v-*vix1wAgo >= 15 {
			delta := v - *vix1wAgo
			return &MarketEvent{"VOLATILITY_SHOCK", d.label, "ALERT",
				fmt.Sprintf("VIXが1週間で%.1fポイント急騰。", delta), delta, 15}
		}
		if vix1mAgo != nil && v-*vix1mAgo >= 20 {
			delta := v - *vix1mAgo
			return &MarketEvent{"VOLATILITY_SHOCK", d.label, "WARNING",
				fmt.Sprintf("VIXが1ヶ月で%.1fポイント上昇。", delta), delta, 20}
		}
	}
	return nil
}

func detectCreditSpike(hySpreadCurrent, hySpread1mAgo, igSpreadCurrent, igSpread1mAgo *float64) *MarketEvent {
	d := eventDefinitions["CREDIT_SPIKE"]
	if hySpreadCurrent != nil {
		v := *hySpreadCurrent
		if v >= 6.0 {
			return &MarketEvent{"CREDIT_SPIKE", d.label, "CRITICAL",
				fmt.Sprintf("HYスプレッドが%.2f%%に拡大。信用危機水準。", v), v, 6.0}
		}
		if v >= 5.0 {
			return &MarketEvent{"CREDIT_SPIKE", d.label, "ALERT",
				fmt.Sprintf("HYスプレッドが%.2f%%に拡大。信用リスク警戒。", v), v, 5.0}
		}
		if hySpread1mAgo != nil {
			change := v - *hySpread1mAgo
			if change >= 1.5 {
				return &MarketEvent{"CREDIT_SPIKE", d.label, "ALERT",
					fmt.Sprintf("HYスプレッドが1ヶ月で%.2f%%拡大。", change), change, 1.5}
			}
		}
	}
	if igSpreadCurrent != nil && igSpread1mAgo != nil {
		change := *igSpreadCurrent - *igSpread1mAgo
		if change >= 0.5 {
			return &MarketEvent{"CREDIT_SPIKE", d.label, "WARNING",
				fmt.Sprintf("IGスプレッドが1ヶ月で%.2f%%拡大。", change), change, 0.5}
		}
	}
	return nil
}

func detectRepoStress(sofrFFSpread, rrpChange1w *float64) *MarketEvent {
	d := eventDefinitions["REPO_STRESS"]
	if sofrFFSpread != nil {
		v := *sofrFFSpread
		if v >= 30 {
			return &MarketEvent{"REPO_STRESS", d.label, "CRITICAL",
				fmt.Sprintf("SOFR-FFスプレッドが%.0fbpに拡大。レポ市場危機。", v), v, 30}
		}
		if v >= 15 {
			return &MarketEvent{"REPO_STRESS", d.label, "ALERT",
				fmt.Sprintf("SOFR-FFスプレッドが%.0fbpに拡大。", v), v, 15}
		}
	}
	if rrpChange1w != nil && *rrpChange1w <= -30 {
		return &MarketEvent{"REPO_STRESS", d.label, "WARNING",
			fmt.Sprintf("RRP残高が1週間で%.1f%%減少。QTの緩衝材が枯渇に向かっており、これ以上のQT継続は市場から直接資金を吸収し始めるリスク。", *rrpChange1w), *rrpChange1w, -30}
	}
	return nil
}

// DetectMarketEventsInput holds all inputs for event detection.
type DetectMarketEventsInput struct {
	ReservesChange1m   *float64
	ReservesChange1w   *float64
	NLChange3m         *float64
	NLChange1m         *float64
	KREChange2m        *float64
	KREChange1m        *float64
	VIXCurrent         *float64
	VIX1mAgo           *float64
	VIX1wAgo           *float64
	HYSpreadCurrent    *float64
	HYSpread1mAgo      *float64
	IGSpreadCurrent    *float64
	IGSpread1mAgo      *float64
	SOFRFFSpread       *float64
	RRPChange1w        *float64
}

// DetectMarketEvents detects market events sorted by severity.
func DetectMarketEvents(input DetectMarketEventsInput) []MarketEvent {
	var events []MarketEvent

	detectors := []func() *MarketEvent{
		func() *MarketEvent { return detectFundingStress(input.ReservesChange1m, input.ReservesChange1w) },
		func() *MarketEvent { return detectLiquidityDrain(input.NLChange3m, input.NLChange1m) },
		func() *MarketEvent { return detectBankStress(input.KREChange2m, input.KREChange1m) },
		func() *MarketEvent { return detectVolatilityShock(input.VIXCurrent, input.VIX1mAgo, input.VIX1wAgo) },
		func() *MarketEvent {
			return detectCreditSpike(input.HYSpreadCurrent, input.HYSpread1mAgo, input.IGSpreadCurrent, input.IGSpread1mAgo)
		},
		func() *MarketEvent { return detectRepoStress(input.SOFRFFSpread, input.RRPChange1w) },
	}

	for _, detect := range detectors {
		if evt := detect(); evt != nil {
			events = append(events, *evt)
		}
	}

	severityOrder := map[string]int{"CRITICAL": 0, "ALERT": 1, "WARNING": 2}
	sort.Slice(events, func(i, j int) bool {
		return severityOrder[events[i].Severity] < severityOrder[events[j].Severity]
	})

	return events
}

// ============================================================
// Policy Regime Detection
// ============================================================

// PolicyRegimeDef holds the static definition of a policy regime.
type PolicyRegimeDef struct {
	Label       string
	Description string
}

var policyRegimeDefinitions = map[string]PolicyRegimeDef{
	"PIVOT_CONFIRMED": {"政策転換確定", "利下げ継続またはバランスシート増勢が確認された状態。緩和サイクル入り。"},
	"PIVOT_EARLY":     {"政策転換初期", "利下げの見込みあり。保険的利下げの可能性あり。RRP枯渇があれば警戒強。"},
	"QE_MODE":         {"量的緩和モード", "FRBがバランスシートを拡大中。市場に流動性を供給している状態。"},
	"QT_ACTIVE":       {"量的引き締め（実効）", "FRBがバランスシートを縮小中。RRP潤沢で流動性吸収が効いている状態。"},
	"QT_EXHAUSTED":    {"量的引き締め（疲弊）", "形式上はQT継続だが、RRP枯渇でQTが効かなくなっている状態。"},
	"NEUTRAL_POLICY":  {"中立", "明確な政策方向性なし。バランスシートは横ばい。"},
}

var policyThresholds = struct {
	RRPDepleted    float64
	RRPAmple       float64
	SOMAExpanding  float64
	SOMAShrinking  float64
	SOMAFlat       float64
	CutsConfirmed  float64
}{
	RRPDepleted:   50,
	RRPAmple:      200,
	SOMAExpanding: 2.0,
	SOMAShrinking: -0.5,
	SOMAFlat:      0.5,
	CutsConfirmed: 100,
}

// FedActionRoom holds the Fed's action capacity assessment.
type FedActionRoom struct {
	RateCutRoom           map[string]interface{} `json:"rate_cut_room"`
	AbsorptionRoom        map[string]interface{} `json:"absorption_room"`
	FiscalAssistPotential map[string]interface{} `json:"fiscal_assist_potential"`
	OverallRoom           string                 `json:"overall_room"`
}

// PolicyRegimeResult is the policy regime detection output.
type PolicyRegimeResult struct {
	Regime        string       `json:"regime"`
	RegimeLabel   string       `json:"regime_label"`
	Description   string       `json:"description"`
	FedActionRoom FedActionRoom `json:"fed_action_room"`
	Signals       []string     `json:"signals"`
}

func calculateFedActionRoom(ffRate, rrpLevel, tgaLevel, inflationRate, yieldCurve *float64) FedActionRoom {
	result := FedActionRoom{
		RateCutRoom:           map[string]interface{}{"level": "Unknown", "room_pct": nil, "constraint": nil},
		AbsorptionRoom:        map[string]interface{}{"level": "Unknown", "rrp_buffer": nil, "comment": nil},
		FiscalAssistPotential: map[string]interface{}{"level": "Unknown", "tga_level": nil, "comment": nil},
		OverallRoom:           "Unknown",
	}
	var fedScores []int

	// Rate cut room
	if ffRate != nil {
		roomPct := *ffRate
		var constraint *string
		var level string

		if inflationRate != nil && *inflationRate > 3.0 {
			c := fmt.Sprintf("高インフレ（%.1f%%）が利下げを制約", *inflationRate)
			constraint = &c
			level = "Low"
			fedScores = append(fedScores, 1)
		} else if *ffRate >= 4.0 {
			level = "High"
			fedScores = append(fedScores, 3)
		} else if *ffRate >= 2.0 {
			level = "Medium"
			fedScores = append(fedScores, 2)
		} else {
			level = "Low"
			c := "ゼロ金利に近い"
			constraint = &c
			fedScores = append(fedScores, 1)
		}
		result.RateCutRoom = map[string]interface{}{
			"level":      level,
			"room_pct":   roundTo(roomPct, 2),
			"constraint": constraint,
		}
	}

	// Absorption room (RRP)
	if rrpLevel != nil {
		v := *rrpLevel
		var level, comment string
		if v > 500 {
			level = "High"
			comment = fmt.Sprintf("RRP残高潤沢（%.0fB$）- QT継続余地あり", v)
			fedScores = append(fedScores, 3)
		} else if v > 200 {
			level = "Medium"
			comment = fmt.Sprintf("RRP残高中程度（%.0fB$）- QT慎重に継続", v)
			fedScores = append(fedScores, 2)
		} else {
			level = "Low"
			comment = fmt.Sprintf("RRP残高低下（%.0fB$）- QT限界に接近", v)
			fedScores = append(fedScores, 1)
		}
		result.AbsorptionRoom = map[string]interface{}{
			"level":      level,
			"rrp_buffer": v,
			"comment":    comment,
		}
	}

	// Fiscal assist potential (TGA)
	if tgaLevel != nil {
		v := *tgaLevel
		var level, comment string
		if v > 500 {
			level = "Available"
			comment = fmt.Sprintf("TGA残高あり（%.0fB$）- 財政余力あり（政治裁量）", v)
		} else {
			level = "Limited"
			comment = fmt.Sprintf("TGA残高限定的（%.0fB$）", v)
		}
		result.FiscalAssistPotential = map[string]interface{}{
			"level":     level,
			"tga_level": v,
			"comment":   comment,
		}
	}

	// Overall (Fed-only = rate_cut + absorption, exclude TGA)
	if len(fedScores) > 0 {
		sum := 0
		for _, s := range fedScores {
			sum += s
		}
		avg := float64(sum) / float64(len(fedScores))
		if avg >= 2.5 {
			result.OverallRoom = "Ample"
		} else if avg >= 1.5 {
			result.OverallRoom = "Moderate"
		} else {
			result.OverallRoom = "Limited"
		}
	}

	return result
}

// DetectPolicyRegimeInput holds all inputs for policy regime detection.
type DetectPolicyRegimeInput struct {
	SOMAChange3m   *float64
	SOMAChange6m   *float64
	RRPLevel       *float64
	RRPChange3m    *float64
	TGALevel       *float64
	FFRate         *float64
	FFRateChange6m *float64
	YieldCurve     *float64
	InflationRate  *float64
}

// DetectPolicyRegime detects the current policy regime.
func DetectPolicyRegime(input DetectPolicyRegimeInput) PolicyRegimeResult {
	T := policyThresholds
	var signals []string
	regime := "NEUTRAL_POLICY"

	var cutsCumBP6m float64
	if input.FFRateChange6m != nil {
		cutsCumBP6m = -*input.FFRateChange6m * 100
	}

	somaFlat := input.SOMAChange3m != nil && math.Abs(*input.SOMAChange3m) < T.SOMAFlat
	rrpDepleted := input.RRPLevel != nil && *input.RRPLevel < T.RRPDepleted
	rrpAmple := input.RRPLevel != nil && *input.RRPLevel > T.RRPAmple
	somaExpanding := input.SOMAChange3m != nil && *input.SOMAChange3m > T.SOMAExpanding
	somaShrinking := input.SOMAChange3m != nil && *input.SOMAChange3m < T.SOMAShrinking

	switch {
	case cutsCumBP6m >= T.CutsConfirmed:
		regime = "PIVOT_CONFIRMED"
		signals = append(signals, fmt.Sprintf("利下げ累計 %.0fbp（6M）- 緩和サイクル確定", cutsCumBP6m))

	case cutsCumBP6m > 0:
		regime = "PIVOT_EARLY"
		signals = append(signals, fmt.Sprintf("利下げ開始（累計 %.0fbp / 6M）", cutsCumBP6m))
		if rrpDepleted {
			signals = append(signals, fmt.Sprintf("RRP枯渇（%.1fB$）- 警戒強", *input.RRPLevel))
		}

	case somaExpanding:
		regime = "QE_MODE"
		signals = append(signals, fmt.Sprintf("SOMA拡大中（3M: +%.1f%%）", *input.SOMAChange3m))

	case somaShrinking && rrpAmple:
		regime = "QT_ACTIVE"
		signals = append(signals, fmt.Sprintf("SOMA縮小中（3M: %.1f%%）", *input.SOMAChange3m))
		signals = append(signals, fmt.Sprintf("RRP潤沢（%.0fB$）- QT実効中", *input.RRPLevel))

	case rrpDepleted && cutsCumBP6m <= 0 && (somaShrinking || somaFlat):
		regime = "QT_EXHAUSTED"
		action := "縮小"
		if !somaShrinking {
			action = "横ばい"
		}
		signals = append(signals, fmt.Sprintf("SOMA %s中（3M: %.1f%%）", action, *input.SOMAChange3m))
		signals = append(signals, fmt.Sprintf("RRP枯渇（%.1fB$）- QT限界到達", *input.RRPLevel))

	default:
		if input.SOMAChange3m != nil {
			signals = append(signals, fmt.Sprintf("SOMA変化（3M: %+.1f%%）", *input.SOMAChange3m))
		}
		if input.RRPLevel != nil {
			signals = append(signals, fmt.Sprintf("RRP残高: %.0fB$", *input.RRPLevel))
		}
	}

	regimeDef := policyRegimeDefinitions[regime]
	fedActionRoom := calculateFedActionRoom(
		input.FFRate, input.RRPLevel, input.TGALevel,
		input.InflationRate, input.YieldCurve,
	)

	return PolicyRegimeResult{
		Regime:        regime,
		RegimeLabel:   regimeDef.Label,
		Description:   regimeDef.Description,
		FedActionRoom: fedActionRoom,
		Signals:       signals,
	}
}

// GenerateFedActionComment generates a comment about the Fed's action room.
func GenerateFedActionComment(result PolicyRegimeResult) string {
	action := result.FedActionRoom
	rate := action.RateCutRoom
	absorb := action.AbsorptionRoom
	fiscal := action.FiscalAssistPotential

	rateLevel, _ := rate["level"].(string)
	ratePct, _ := rate["room_pct"].(float64)
	absorbLevel, _ := absorb["level"].(string)
	rrpBuffer, _ := absorb["rrp_buffer"].(float64)
	fiscalLevel, _ := fiscal["level"].(string)
	hasConstraint := rate["constraint"] != nil

	var constraintStr string
	if c, ok := rate["constraint"].(*string); ok && c != nil {
		constraintStr = *c
	} else if c, ok := rate["constraint"].(string); ok {
		constraintStr = c
	}

	var lines []string

	// Rate situation (main assessment)
	switch {
	case rateLevel == "High" && !hasConstraint:
		lines = append(lines, fmt.Sprintf("利下げ余地は約%.1f%%pt。大幅利下げが可能な水準。", ratePct))
		if absorbLevel == "Low" {
			lines = append(lines, "ただしRRP緩衝材が枯渇。QTを続ければ市場から直接資金吸収が始まるため、利下げ・QT停止圧力が高まっている。")
		} else if absorbLevel == "Medium" {
			lines = append(lines, "保険的利下げの可能性あり。景気減速シグナルに注視。")
		}
	case rateLevel == "Medium":
		lines = append(lines, fmt.Sprintf("FF金利%.1f%%。利下げカードは温存されている。", ratePct))
		if hasConstraint {
			lines = append(lines, constraintStr+"。実行にはハードルあり。")
		} else if absorbLevel == "Low" {
			lines = append(lines, "景気悪化時は保険的利下げの可能性。RRP緩衝材の枯渇でQTが市場を直接圧迫するリスクあり。")
		} else {
			lines = append(lines, "景気・インフレ次第で利下げ着手のタイミングを探る局面。")
		}
	case rateLevel == "Low":
		if hasConstraint {
			lines = append(lines, constraintStr+"。利下げカード乏しい。")
		} else {
			lines = append(lines, "ゼロ金利に近く、利下げ余地は極めて限定的。")
		}
		if absorbLevel == "Low" {
			lines = append(lines, "RRP緩衝材も枯渇。QTは市場から直接吸収する段階。Fedの弾切れリスク。")
		}
	}

	// RRP/QT status
	if absorbLevel == "Low" && rrpBuffer > 0 {
		lines = append(lines, fmt.Sprintf("RRP残高%.0fB$ — QTの緩衝材がほぼ消失。これ以上のQTは銀行準備預金を直接削る。", rrpBuffer))
	} else if absorbLevel == "High" {
		lines = append(lines, "RRP残高潤沢。QTの影響はRRPが吸収しており、市場への直接的圧迫なし。")
	}

	// Fiscal room
	tgaLevel, _ := fiscal["tga_level"].(float64)
	switch fiscalLevel {
	case "Available":
		if tgaLevel > 0 {
			lines = append(lines, fmt.Sprintf("TGA %.0fB$で財政補助の余地あり（政治裁量）。", tgaLevel))
		} else {
			lines = append(lines, "財政補助の余地あり。")
		}
	case "Limited":
		lines = append(lines, "TGA残高限定的。財政面からの支援は期待薄。")
	}

	if len(lines) == 0 {
		lines = append(lines, "明確な政策方向性なし。データ不足の可能性。")
	}

	return strings.Join(lines, " ")
}

// ============================================================
// Rolling Z-Score (for divergence analysis)
// ============================================================

// RollingZScore computes rolling window z-scores for a series.
func RollingZScore(values []float64, window int) []*float64 {
	result := make([]*float64, len(values))
	for i := range values {
		start := i - window + 1
		if start < 0 {
			start = 0
		}
		w := values[start : i+1]
		if len(w) < 3 {
			result[i] = nil
			continue
		}
		mean := calcMean(w)
		std := calcStdev(w)
		if std > 0 {
			z := roundTo((values[i]-mean)/std, 3)
			result[i] = &z
		} else {
			z := 0.0
			result[i] = &z
		}
	}
	return result
}

// ============================================================
// Math Helpers
// ============================================================

// calcMean computes the arithmetic mean (equivalent to statistics.mean).
func calcMean(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

// calcStdev computes the sample standard deviation (ddof=1, equivalent to statistics.stdev).
func calcStdev(values []float64) float64 {
	n := len(values)
	if n < 2 {
		return 1.0 // match Python: returns 1.0 when len < 2
	}
	mean := calcMean(values)
	sumSq := 0.0
	for _, v := range values {
		d := v - mean
		sumSq += d * d
	}
	return math.Sqrt(sumSq / float64(n-1))
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func roundTo(v float64, decimals int) float64 {
	pow := math.Pow(10, float64(decimals))
	return math.Round(v*pow) / pow
}

// PctChange computes ((current - previous) / abs(previous)) * 100.
// Returns nil if either value is nil or previous is 0.
func PctChange(current, previous *float64) *float64 {
	if current == nil || previous == nil || *previous == 0 {
		return nil
	}
	v := ((*current - *previous) / math.Abs(*previous)) * 100
	return &v
}

// FloatPtr returns a pointer to the given float64.
func FloatPtr(v float64) *float64 {
	return &v
}

// IntPtr returns a pointer to the given int.
func IntPtr(v int) *int {
	return &v
}
