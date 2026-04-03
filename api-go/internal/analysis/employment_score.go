package analysis

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/open-regime/api-go/internal/model"
)

// --- Phase definitions ---

var phases = []model.PhaseInfo{
	{Code: "EXPANSION", Label: "拡大期", Color: "green", PositionLimit: 80,
		Description: "雇用市場は力強く拡大中。過熱リスクに注意。",
		Action:      "過熱警戒。利確・回転を意識。ポジション上限80%"},
	{Code: "SLOWDOWN", Label: "減速期", Color: "cyan", PositionLimit: 100,
		Description: "最良の買い場。バックテスト勝率81%、平均+8.4%/6ヶ月。",
		Action:      "積極投資OK。フルポジション可"},
	{Code: "CAUTION", Label: "警戒期", Color: "yellow", PositionLimit: 70,
		Description: "複数の指標が悪化傾向。景気後退リスクが高まっている。",
		Action:      "現物のみ。新規ポジション抑制。ポジション上限70%"},
	{Code: "CONTRACTION", Label: "収縮期", Color: "orange", PositionLimit: 40,
		Description: "景気後退入りの可能性が高い。最も危険なフェーズ。",
		Action:      "信用取引禁止。現金比率引き上げ。ポジション上限40%"},
	{Code: "CRISIS", Label: "危機", Color: "red", PositionLimit: 60,
		Description: "深刻な景気後退。ただし底値圏のため逆張りチャンス。",
		Action:      "分割で現物仕込み。底値圏の逆張り。ポジション上限60%"},
}

// GetPhase returns the PhaseInfo for a given score.
func GetPhase(score int) model.PhaseInfo {
	switch {
	case score <= 20:
		return phases[0]
	case score <= 40:
		return phases[1]
	case score <= 60:
		return phases[2]
	case score <= 80:
		return phases[3]
	default:
		return phases[4]
	}
}

// --- Helper functions ---

func meanFloat(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range vals {
		sum += v
	}
	return sum / float64(len(vals))
}

func getFloat(m map[string]any, key string) *float64 {
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

func getInt(m map[string]any, key string) *int {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch n := v.(type) {
	case int:
		return &n
	case int32:
		i := int(n)
		return &i
	case int64:
		i := int(n)
		return &i
	case float64:
		i := int(n)
		return &i
	case pgtype.Numeric:
		f, err := n.Float64Value()
		if err != nil || !f.Valid {
			return nil
		}
		i := int(f.Float64)
		return &i
	default:
		return nil
	}
}

func getString(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case time.Time:
		return t.Format("2006-01-02")
	default:
		return fmt.Sprintf("%v", v)
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func clampFloat(v, lo, hi float64) float64 {
	return maxFloat(lo, minFloat(hi, v))
}

func minSlice(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	m := vals[0]
	for _, v := range vals[1:] {
		if v < m {
			m = v
		}
	}
	return m
}

// --- Employment Category (50 points) ---

// CalcNFPTrend calculates the NFP trend subscore (25 points).
func CalcNFPTrend(nfpData []map[string]any) model.RiskSubScore {
	var changes []float64
	limit := 6
	if len(nfpData) < limit {
		limit = len(nfpData)
	}
	for _, d := range nfpData[:limit] {
		if nc := getInt(d, "nfp_change"); nc != nil {
			changes = append(changes, float64(*nc))
		}
	}

	var avg float64
	if len(changes) >= 3 {
		avg = meanFloat(changes[:3])
	} else if len(changes) > 0 {
		avg = changes[0]
	}

	var score int
	switch {
	case avg > 200:
		score = 0
	case avg > 150:
		score = 5
	case avg > 100:
		score = 10
	case avg > 50:
		score = 15
	case avg > 0:
		score = 20
	default:
		score = 25
	}

	status := "normal"
	if score > 20 {
		status = "danger"
	} else if score > 10 {
		status = "warning"
	}

	detail := "データなし"
	if len(changes) > 0 {
		detail = fmt.Sprintf("3M平均 %+.0fK（150K超で健全、50K以下で警戒）", avg)
	}

	return model.RiskSubScore{Name: "NFPトレンド", Score: score, MaxScore: 25, Detail: detail, Status: status}
}

// CalcSahmRule calculates the Sahm Rule subscore (15 points) and SahmRuleData.
func CalcSahmRule(nfpData []map[string]any) (model.RiskSubScore, model.SahmRuleData) {
	// Sort by reference_period ascending
	sorted := make([]map[string]any, len(nfpData))
	copy(sorted, nfpData)
	sort.Slice(sorted, func(i, j int) bool {
		return getString(sorted[i], "reference_period") < getString(sorted[j], "reference_period")
	})

	var u3Values []float64
	for _, d := range sorted {
		if v := getFloat(d, "u3_rate"); v != nil {
			u3Values = append(u3Values, *v)
		}
	}

	if len(u3Values) < 3 {
		var currentU3 *float64
		if len(u3Values) > 0 {
			v := u3Values[len(u3Values)-1]
			currentU3 = &v
		}
		return model.RiskSubScore{Name: "サームルール", Score: 0, MaxScore: 15, Detail: "データ不足", Status: "normal"},
			model.SahmRuleData{CurrentU3: currentU3}
	}

	// Calculate 3-month moving averages
	avgs3m := make([]float64, 0, len(u3Values)-2)
	for i := 2; i < len(u3Values); i++ {
		avgs3m = append(avgs3m, meanFloat(u3Values[i-2:i+1]))
	}

	current3mAvg := avgs3m[len(avgs3m)-1]
	window := avgs3m
	if len(avgs3m) > 12 {
		window = avgs3m[len(avgs3m)-12:]
	}
	low12m3mAvg := minSlice(window)
	sahmValue := math.Round((current3mAvg-low12m3mAvg)*100) / 100
	triggered := sahmValue >= 0.5

	// Previous month Sahm value (for 2-month consecutive check)
	var prevSahm *float64
	if len(avgs3m) >= 2 {
		var prevWindow []float64
		if len(avgs3m) >= 13 {
			prevWindow = avgs3m[len(avgs3m)-13 : len(avgs3m)-1]
		} else {
			prevWindow = avgs3m[:len(avgs3m)-1]
		}
		prevLow := minSlice(prevWindow)
		ps := math.Round((avgs3m[len(avgs3m)-2]-prevLow)*100) / 100
		prevSahm = &ps
	}

	var score int
	switch {
	case sahmValue >= 1.0:
		score = 15
	case sahmValue >= 0.5:
		if prevSahm != nil && *prevSahm >= 0.5 {
			score = 15
		} else {
			score = 10
		}
	case sahmValue >= 0.3:
		score = 8
	case sahmValue >= 0.15:
		score = 4
	default:
		score = 0
	}

	// Peak-out detection
	peakOut := false
	nearPeakOut := false
	if triggered && len(avgs3m) >= 2 {
		prev3mAvg := avgs3m[len(avgs3m)-2]
		var prevLowForPrev []float64
		if len(avgs3m) >= 13 {
			prevLowForPrev = avgs3m[len(avgs3m)-13 : len(avgs3m)-1]
		} else {
			prevLowForPrev = avgs3m[:len(avgs3m)-1]
		}
		prevLow := minSlice(prevLowForPrev)
		prevRise := prev3mAvg - prevLow
		riseDiff := prevRise - sahmValue
		if riseDiff >= 0.05 {
			peakOut = true
		} else if riseDiff >= 0 {
			nearPeakOut = true
		}
	}

	detail := fmt.Sprintf("Sahm値: %.2f（0.50で不況シグナル発動）", sahmValue)
	if triggered {
		if peakOut {
			detail = fmt.Sprintf("Sahm値: %.2f（発動中・ピークアウト兆候）", sahmValue)
		} else {
			detail = fmt.Sprintf("Sahm値: %.2f（⚠️ 不況シグナル発動中）", sahmValue)
		}
	}

	status := "normal"
	if triggered {
		status = "danger"
	} else if score >= 4 {
		status = "warning"
	}

	currentU3 := math.Round(u3Values[len(u3Values)-1]*10) / 10
	c3m := math.Round(current3mAvg*100) / 100
	l12m := math.Round(low12m3mAvg*100) / 100

	return model.RiskSubScore{Name: "サームルール", Score: score, MaxScore: 15, Detail: detail, Status: status},
		model.SahmRuleData{
			CurrentU3:     &currentU3,
			U33MAvg:       &c3m,
			U312MLow3MAvg: &l12m,
			SahmValue:     &sahmValue,
			Triggered:     triggered,
			PeakOut:       peakOut,
			NearPeakOut:   nearPeakOut,
		}
}

// CalcClaimsLevel calculates the claims level subscore (2 points).
func CalcClaimsLevel(claimsData []map[string]any) model.RiskSubScore {
	limit := 4
	if len(claimsData) < limit {
		limit = len(claimsData)
	}

	var avgs []float64
	for _, d := range claimsData[:limit] {
		if v := getFloat(d, "initial_claims_4w_avg"); v != nil {
			avgs = append(avgs, *v)
		} else if v := getFloat(d, "initial_claims"); v != nil {
			avgs = append(avgs, *v)
		}
	}

	if len(avgs) == 0 {
		return model.RiskSubScore{Name: "失業保険", Score: 0, MaxScore: 2, Detail: "データ不足", Status: "normal"}
	}

	level := avgs[0]
	var score int
	switch {
	case level >= 300000:
		score = 2
	case level >= 250000:
		score = 1
	default:
		score = 0
	}

	detail := fmt.Sprintf("4W平均 %.0fK（250K未満で健全、300K超で危険）", level/1000)
	status := "normal"
	if score >= 2 {
		status = "danger"
	} else if score >= 1 {
		status = "warning"
	}

	return model.RiskSubScore{Name: "失業保険", Score: score, MaxScore: 2, Detail: detail, Status: status}
}

// CalcEmploymentDiscrepancy calculates the employment discrepancy subscore (8 points).
func CalcEmploymentDiscrepancy(nfpData, claimsData []map[string]any, manualByMetric map[string][]map[string]any) model.RiskSubScore {
	var changes []float64
	limit := 3
	if len(nfpData) < limit {
		limit = len(nfpData)
	}
	for _, d := range nfpData[:limit] {
		if nc := getInt(d, "nfp_change"); nc != nil {
			changes = append(changes, float64(*nc))
		}
	}
	if len(changes) == 0 {
		return model.RiskSubScore{Name: "雇用乖離", Score: 0, MaxScore: 8, Detail: "NFPデータなし", Status: "normal"}
	}
	nfp3mAvg := meanFloat(changes)

	type gap struct {
		name   string
		gap    float64
		weight float64
	}
	var gaps []gap

	// ADP — weight 0.6
	adpRows := manualByMetric["ADP_CHANGE"]
	if len(adpRows) >= 3 {
		var adpValues []float64
		for _, r := range adpRows[:3] {
			if v := getFloat(r, "value"); v != nil {
				adpValues = append(adpValues, *v)
			}
		}
		if len(adpValues) >= 3 {
			adp3mAvg := meanFloat(adpValues)
			gapAdp := nfp3mAvg - adp3mAvg
			gaps = append(gaps, gap{"ADP", gapAdp, 0.6})
		}
	}

	// Challenger — weight 0.8, trend=1.0
	chRows := manualByMetric["CHALLENGER_CUTS"]
	if len(chRows) > 0 {
		if chCurrent := getFloat(chRows[0], "value"); chCurrent != nil {
			var chHistory []float64
			if len(chRows) >= 4 {
				for _, r := range chRows[1:4] {
					if v := getFloat(r, "value"); v != nil {
						chHistory = append(chHistory, *v)
					}
				}
			}
			ch3mAvg := 80000.0
			if len(chHistory) >= 3 {
				ch3mAvg = meanFloat(chHistory)
			}

			adaptiveThreshold := ch3mAvg * 1.3
			trendFlag := *chCurrent > adaptiveThreshold

			chYoYFlag := false
			if len(chRows) >= 13 {
				var recent3, yearAgo3 []float64
				for _, r := range chRows[:3] {
					if v := getFloat(r, "value"); v != nil {
						recent3 = append(recent3, *v)
					}
				}
				end := 15
				if len(chRows) < end {
					end = len(chRows)
				}
				for _, r := range chRows[12:end] {
					if v := getFloat(r, "value"); v != nil {
						yearAgo3 = append(yearAgo3, *v)
					}
				}
				if len(recent3) > 0 && len(yearAgo3) > 0 {
					recentAvg := meanFloat(recent3)
					yearAgoAvg := meanFloat(yearAgo3)
					if yearAgoAvg > 0 {
						chYoY := ((recentAvg - yearAgoAvg) / yearAgoAvg) * 100
						chYoYFlag = chYoY > 50
					}
				}
			}

			if (trendFlag || chYoYFlag) && nfp3mAvg > 0 {
				gapCh := minFloat(50, (*chCurrent-ch3mAvg)/1000)
				weight := 0.8
				if trendFlag {
					weight = 1.0
				}
				gaps = append(gaps, gap{"Challenger", maxFloat(0, gapCh), weight})
			}
		}
	}

	// ICSA — weight 0.3
	if len(claimsData) > 0 {
		var icsaVal *float64
		if v := getFloat(claimsData[0], "initial_claims_4w_avg"); v != nil {
			icsaVal = v
		} else if v := getFloat(claimsData[0], "initial_claims"); v != nil {
			icsaVal = v
		}
		if icsaVal != nil && *icsaVal > 250000 && nfp3mAvg > 50 {
			gapIcsa := minFloat(30, (*icsaVal-220000)/5000)
			gaps = append(gaps, gap{"ICSA", gapIcsa, 0.3})
		}
	}

	// Source notes
	var sourceNotes []string
	if len(adpRows) >= 3 {
		var adpVals []float64
		for _, r := range adpRows[:3] {
			if v := getFloat(r, "value"); v != nil {
				adpVals = append(adpVals, *v)
			}
		}
		if len(adpVals) >= 3 {
			sourceNotes = append(sourceNotes, fmt.Sprintf("ADP 3M平均%.0fK", meanFloat(adpVals)))
		}
	} else {
		sourceNotes = append(sourceNotes, fmt.Sprintf("ADP %d件（3件必要）", len(adpRows)))
	}
	if len(chRows) > 0 {
		if v := getFloat(chRows[0], "value"); v != nil {
			sourceNotes = append(sourceNotes, fmt.Sprintf("Challenger直近%.0f件", *v))
		}
	} else {
		sourceNotes = append(sourceNotes, "Challengerデータなし")
	}

	if len(gaps) == 0 {
		detail := fmt.Sprintf("乖離未検出 — NFP 3M平均%.0fK", nfp3mAvg)
		for _, sn := range sourceNotes {
			detail += " / " + sn
		}
		return model.RiskSubScore{Name: "雇用乖離", Score: 0, MaxScore: 8, Detail: detail, Status: "normal"}
	}

	totalWeight := 0.0
	weightedGap := 0.0
	for _, g := range gaps {
		totalWeight += g.weight
		weightedGap += g.gap * g.weight
	}
	weightedGap /= totalWeight
	discScore := 100.0 / (1.0 + math.Exp(-weightedGap/30.0))

	var score int
	if discScore >= 70 {
		hasConfirming := false
		for _, g := range gaps {
			if g.name != "ADP" {
				hasConfirming = true
				break
			}
		}
		if hasConfirming {
			score = 8
		} else {
			score = 5
		}
	} else if discScore >= 60 {
		score = 5
	} else if discScore >= 50 {
		score = 3
	} else {
		score = 0
	}

	var sources string
	for i, g := range gaps {
		if i > 0 {
			sources += ", "
		}
		sources += g.name
	}
	gapDir := "NFP>民間"
	if weightedGap <= 0 {
		gapDir = "NFP<民間"
	}
	status := "normal"
	if score >= 8 {
		status = "danger"
	} else if score >= 3 {
		status = "warning"
	}

	detail := fmt.Sprintf("乖離度%.0f%%（%s, gap%+.0fK）70%%超で警戒", discScore, gapDir, weightedGap)
	for _, sn := range sourceNotes {
		detail += " / " + sn
	}

	return model.RiskSubScore{Name: "雇用乖離", Score: score, MaxScore: 8, Detail: detail, Status: status}
}

// --- Consumption Category (25 points) ---

// CalcRealIncome calculates the real income subscore (10 points).
func CalcRealIncome(indicatorData []map[string]any) model.RiskSubScore {
	var w875 []map[string]any
	for _, d := range indicatorData {
		if getString(d, "indicator") == "W875RX1" && getFloat(d, "current_value") != nil {
			w875 = append(w875, d)
		}
	}
	sort.Slice(w875, func(i, j int) bool {
		return getString(w875[i], "reference_period") > getString(w875[j], "reference_period")
	})

	if len(w875) < 13 {
		detail := "データなし"
		if len(w875) > 0 {
			detail = "YoY算出不可(データ不足)"
		}
		return model.RiskSubScore{Name: "実質個人所得", Score: 0, MaxScore: 10, Detail: detail, Status: "normal"}
	}

	current := *getFloat(w875[0], "current_value")
	yearAgo := *getFloat(w875[12], "current_value")
	if yearAgo == 0 {
		return model.RiskSubScore{Name: "実質個人所得", Score: 0, MaxScore: 10, Detail: "ゼロ除算回避", Status: "normal"}
	}

	yoy := ((current - yearAgo) / math.Abs(yearAgo)) * 100
	var score int
	switch {
	case yoy >= 3.0:
		score = 0
	case yoy >= 1.0:
		score = 3
	case yoy >= 0.0:
		score = 6
	default:
		score = 10
	}

	status := "normal"
	if score >= 10 {
		status = "danger"
	} else if score >= 3 {
		status = "warning"
	}

	return model.RiskSubScore{
		Name: "実質個人所得", Score: score, MaxScore: 10,
		Detail: fmt.Sprintf("実質所得 YoY %+.1f%%（3%%超で健全、マイナスで危険）", yoy),
		Status: status,
	}
}

// CalcConsumerSentiment calculates the consumer sentiment subscore (5 points).
func CalcConsumerSentiment(indicatorData []map[string]any) model.RiskSubScore {
	var umcsent []map[string]any
	for _, d := range indicatorData {
		if getString(d, "indicator") == "UMCSENT" && getFloat(d, "current_value") != nil {
			umcsent = append(umcsent, d)
		}
	}
	sort.Slice(umcsent, func(i, j int) bool {
		return getString(umcsent[i], "reference_period") > getString(umcsent[j], "reference_period")
	})

	if len(umcsent) == 0 {
		return model.RiskSubScore{Name: "消費者信頼感", Score: 0, MaxScore: 5, Detail: "データなし", Status: "normal"}
	}

	currentVal := *getFloat(umcsent[0], "current_value")
	if len(umcsent) < 13 {
		return model.RiskSubScore{
			Name: "消費者信頼感", Score: 0, MaxScore: 5,
			Detail: fmt.Sprintf("UMCSENT: %.1f (YoY算出不可)", currentVal), Status: "normal",
		}
	}

	yearAgoVal := *getFloat(umcsent[12], "current_value")
	if yearAgoVal == 0 {
		return model.RiskSubScore{Name: "消費者信頼感", Score: 0, MaxScore: 5, Detail: "ゼロ除算回避", Status: "normal"}
	}

	yoy := ((currentVal - yearAgoVal) / math.Abs(yearAgoVal)) * 100
	var score int
	switch {
	case yoy <= -15:
		score = 5
	case yoy <= -10:
		score = 3
	case yoy <= -5:
		score = 1
	default:
		score = 0
	}

	status := "normal"
	if score >= 5 {
		status = "danger"
	} else if score >= 1 {
		status = "warning"
	}

	return model.RiskSubScore{
		Name: "消費者信頼感", Score: score, MaxScore: 5,
		Detail: fmt.Sprintf("消費者信頼感 %.1f（YoY %+.1f%%、-15%%超低下で警戒）", currentVal, yoy),
		Status: status,
	}
}

// CalcCreditDelinquency calculates the credit card delinquency subscore (5 points).
func CalcCreditDelinquency(indicatorData []map[string]any) model.RiskSubScore {
	var drc []map[string]any
	for _, d := range indicatorData {
		if getString(d, "indicator") == "DRCCLACBS" && getFloat(d, "current_value") != nil {
			drc = append(drc, d)
		}
	}
	sort.Slice(drc, func(i, j int) bool {
		return getString(drc[i], "reference_period") > getString(drc[j], "reference_period")
	})

	if len(drc) == 0 {
		return model.RiskSubScore{Name: "クレカ延滞率", Score: 0, MaxScore: 5, Detail: "データなし", Status: "normal"}
	}

	current := *getFloat(drc[0], "current_value")

	// Quarterly data: 4 quarters ago = YoY
	if len(drc) >= 5 {
		yearAgo := *getFloat(drc[4], "current_value")
		yoyChange := current - yearAgo

		var score int
		switch {
		case yoyChange >= 1.0:
			score = 5
		case yoyChange >= 0.5:
			score = 3
		case yoyChange >= 0.2:
			score = 1
		default:
			score = 0
		}

		status := "normal"
		if score >= 5 {
			status = "danger"
		} else if score >= 1 {
			status = "warning"
		}

		return model.RiskSubScore{
			Name: "クレカ延滞率", Score: score, MaxScore: 5,
			Detail: fmt.Sprintf("延滞率 %.2f%%（YoY %+.2fpp、+0.5pp超で警戒）", current, yoyChange),
			Status: status,
		}
	}

	return model.RiskSubScore{
		Name: "クレカ延滞率", Score: 0, MaxScore: 5,
		Detail: fmt.Sprintf("%.2f%% (YoY算出不可)", current), Status: "normal",
	}
}

// CalcInflationDiscrepancy calculates the inflation discrepancy subscore (5 points).
func CalcInflationDiscrepancy(indicatorData []map[string]any, manualByMetric map[string][]map[string]any) model.RiskSubScore {
	var cpiData []map[string]any
	for _, d := range indicatorData {
		if getString(d, "indicator") == "CPILFESL" && getFloat(d, "current_value") != nil {
			cpiData = append(cpiData, d)
		}
	}
	sort.Slice(cpiData, func(i, j int) bool {
		return getString(cpiData[i], "reference_period") > getString(cpiData[j], "reference_period")
	})

	if len(cpiData) < 13 {
		return model.RiskSubScore{Name: "インフレ乖離", Score: 0, MaxScore: 5, Detail: "CPIデータ不足", Status: "normal"}
	}

	currentCPI := *getFloat(cpiData[0], "current_value")
	yearAgoCPI := *getFloat(cpiData[12], "current_value")
	if yearAgoCPI == 0 {
		return model.RiskSubScore{Name: "インフレ乖離", Score: 0, MaxScore: 5, Detail: "ゼロ除算回避", Status: "normal"}
	}

	cpiYoY := ((currentCPI - yearAgoCPI) / math.Abs(yearAgoCPI)) * 100

	truRows := manualByMetric["TRUFLATION"]
	if len(truRows) == 0 {
		return model.RiskSubScore{
			Name: "インフレ乖離", Score: 0, MaxScore: 5,
			Detail: fmt.Sprintf("コアCPI YoY: %.1f%% (代替データなし)", cpiYoY), Status: "normal",
		}
	}

	truflationValue := getFloat(truRows[0], "value")
	if truflationValue == nil {
		return model.RiskSubScore{
			Name: "インフレ乖離", Score: 0, MaxScore: 5,
			Detail: fmt.Sprintf("コアCPI YoY: %.1f%% (代替データなし)", cpiYoY), Status: "normal",
		}
	}

	gap := *truflationValue - cpiYoY
	discScore := clampFloat(50+(gap/2.0)*25, 0, 100)

	var score int
	switch {
	case discScore >= 70:
		score = 5
	case discScore >= 50:
		score = 2
	default:
		score = 0
	}

	status := "normal"
	if score >= 5 {
		status = "danger"
	} else if score >= 2 {
		status = "warning"
	}

	return model.RiskSubScore{
		Name: "インフレ乖離", Score: score, MaxScore: 5,
		Detail: fmt.Sprintf("CPI %.1f%% vs Truflation %.1f%%（差 %+.1f%%、+1%%超で隠れインフレ）", cpiYoY, *truflationValue, gap),
		Status: status,
	}
}

// --- Structure Category (25 points) ---

// CalcJobOpeningsRatio calculates the job openings ratio subscore (10 points).
func CalcJobOpeningsRatio(joltsData, unemployData []map[string]any) model.RiskSubScore {
	if len(joltsData) == 0 || len(unemployData) == 0 {
		return model.RiskSubScore{Name: "求人倍率", Score: 0, MaxScore: 10, Detail: "データなし", Status: "normal"}
	}

	joltsVal := getFloat(joltsData[0], "current_value")
	unemployVal := getFloat(unemployData[0], "current_value")
	if joltsVal == nil || unemployVal == nil || *unemployVal == 0 {
		return model.RiskSubScore{Name: "求人倍率", Score: 0, MaxScore: 10, Detail: "データ不足", Status: "normal"}
	}

	ratio := *joltsVal / *unemployVal
	var score int
	switch {
	case ratio >= 1.2:
		score = 0
	case ratio >= 1.0:
		score = 3
	case ratio >= 0.8:
		score = 7
	default:
		score = 10
	}

	status := "normal"
	if score >= 10 {
		status = "danger"
	} else if score >= 3 {
		status = "warning"
	}

	return model.RiskSubScore{
		Name: "求人倍率", Score: score, MaxScore: 10,
		Detail: fmt.Sprintf("求人/失業者 %.2f倍（1.0倍超で労働者有利、0.8倍未満で深刻）", ratio),
		Status: status,
	}
}

// CalcU6U3Spread calculates the U6-U3 spread subscore (7 points).
func CalcU6U3Spread(nfpData []map[string]any) model.RiskSubScore {
	if len(nfpData) == 0 {
		return model.RiskSubScore{Name: "U6-U3スプレッド", Score: 0, MaxScore: 7, Detail: "データなし", Status: "normal"}
	}

	u3 := getFloat(nfpData[0], "u3_rate")
	u6 := getFloat(nfpData[0], "u6_rate")
	if u3 == nil || u6 == nil {
		return model.RiskSubScore{Name: "U6-U3スプレッド", Score: 0, MaxScore: 7, Detail: "データなし", Status: "normal"}
	}

	spread := *u6 - *u3
	var score int
	switch {
	case spread >= 5.0:
		score = 7
	case spread >= 4.5:
		score = 4
	case spread >= 4.0:
		score = 2
	default:
		score = 0
	}

	status := "normal"
	if score >= 7 {
		status = "danger"
	} else if score >= 2 {
		status = "warning"
	}

	return model.RiskSubScore{
		Name: "U6-U3スプレッド", Score: score, MaxScore: 7,
		Detail: fmt.Sprintf("U6-U3 %.1f%%（4.0%%未満で健全、5.0%%超で隠れ失業拡大）", spread),
		Status: status,
	}
}

// CalcLaborParticipation calculates the labor force participation rate subscore (5 points).
func CalcLaborParticipation(nfpData []map[string]any) model.RiskSubScore {
	type lfprEntry struct {
		period string
		value  float64
	}
	var lfprValues []lfprEntry
	for _, d := range nfpData {
		if v := getFloat(d, "labor_force_participation"); v != nil {
			lfprValues = append(lfprValues, lfprEntry{getString(d, "reference_period"), *v})
		}
	}

	if len(lfprValues) == 0 {
		return model.RiskSubScore{Name: "労働参加率", Score: 0, MaxScore: 5, Detail: "データなし", Status: "normal"}
	}

	currentLFPR := lfprValues[0].value
	if len(lfprValues) < 13 {
		return model.RiskSubScore{
			Name: "労働参加率", Score: 0, MaxScore: 5,
			Detail: fmt.Sprintf("LFPR: %.1f%% (YoY算出不可)", currentLFPR), Status: "normal",
		}
	}

	yearAgoLFPR := lfprValues[12].value
	yoyChange := currentLFPR - yearAgoLFPR

	var score int
	switch {
	case yoyChange <= -0.5:
		score = 5
	case yoyChange <= -0.3:
		score = 3
	case yoyChange <= -0.2:
		score = 1
	default:
		score = 0
	}

	status := "normal"
	if score >= 5 {
		status = "danger"
	} else if score >= 1 {
		status = "warning"
	}

	return model.RiskSubScore{
		Name: "労働参加率", Score: score, MaxScore: 5,
		Detail: fmt.Sprintf("参加率 %.1f%%（YoY %+.1fpp、-0.3pp超低下で警戒）", currentLFPR, yoyChange),
		Status: status,
	}
}

// CalcKShapeProxy calculates the K-shape proxy subscore (3 points).
func CalcKShapeProxy(marketData []map[string]any) model.RiskSubScore {
	if len(marketData) == 0 {
		return model.RiskSubScore{Name: "K字型Proxy", Score: 0, MaxScore: 3, Detail: "市場データなし", Status: "normal"}
	}

	var ratio *float64
	for _, row := range marketData {
		sp := getFloat(row, "sp500")
		rut := getFloat(row, "russell2000")
		if sp != nil && rut != nil && *sp > 0 {
			r := *rut / *sp
			ratio = &r
			break
		}
	}

	if ratio == nil {
		return model.RiskSubScore{Name: "K字型Proxy", Score: 0, MaxScore: 3, Detail: "RUT/SPXデータなし", Status: "normal"}
	}

	var score int
	switch {
	case *ratio < 0.40:
		score = 3
	case *ratio < 0.45:
		score = 2
	case *ratio < 0.50:
		score = 1
	default:
		score = 0
	}

	status := "normal"
	if score >= 3 {
		status = "danger"
	} else if score >= 1 {
		status = "warning"
	}

	return model.RiskSubScore{
		Name: "K字型Proxy", Score: score, MaxScore: 3,
		Detail: fmt.Sprintf("RUT/SPX %.3f（0.50超で健全、0.40未満で格差極大）", *ratio),
		Status: status,
	}
}

// --- Simplified scorers for risk-history ---

// SimplifiedNFPScore returns the simplified NFP trend score (max 25).
func SimplifiedNFPScore(nfpRows []map[string]any) int {
	var changes []float64
	limit := 3
	if len(nfpRows) < limit {
		limit = len(nfpRows)
	}
	for _, d := range nfpRows[:limit] {
		if nc := getInt(d, "nfp_change"); nc != nil {
			changes = append(changes, float64(*nc))
		}
	}
	if len(changes) == 0 {
		return 0
	}
	avg := meanFloat(changes)
	switch {
	case avg > 200:
		return 0
	case avg > 150:
		return 5
	case avg > 100:
		return 10
	case avg > 50:
		return 15
	case avg > 0:
		return 20
	default:
		return 25
	}
}

// SimplifiedSahmScore returns the simplified Sahm Rule score (max 15).
func SimplifiedSahmScore(u3Values []float64) int {
	if len(u3Values) < 3 {
		return 0
	}
	avgs3m := make([]float64, 0, len(u3Values)-2)
	for i := 2; i < len(u3Values); i++ {
		avgs3m = append(avgs3m, meanFloat(u3Values[i-2:i+1]))
	}
	current3m := avgs3m[len(avgs3m)-1]
	window := avgs3m
	if len(avgs3m) > 12 {
		window = avgs3m[len(avgs3m)-12:]
	}
	low12m := minSlice(window)
	sahm := current3m - low12m

	var prevSahm *float64
	if len(avgs3m) >= 2 {
		var prevWindow []float64
		if len(avgs3m) >= 13 {
			prevWindow = avgs3m[len(avgs3m)-13 : len(avgs3m)-1]
		} else {
			prevWindow = avgs3m[:len(avgs3m)-1]
		}
		prevLow := minSlice(prevWindow)
		ps := avgs3m[len(avgs3m)-2] - prevLow
		prevSahm = &ps
	}

	switch {
	case sahm >= 1.0:
		return 15
	case sahm >= 0.5:
		if prevSahm != nil && *prevSahm >= 0.5 {
			return 15
		}
		return 10
	case sahm >= 0.3:
		return 8
	case sahm >= 0.15:
		return 4
	default:
		return 0
	}
}

// SimplifiedClaimsScore returns the simplified claims score (max 2).
func SimplifiedClaimsScore(claims4wAvg *float64) int {
	if claims4wAvg == nil {
		return 0
	}
	switch {
	case *claims4wAvg >= 300000:
		return 2
	case *claims4wAvg >= 250000:
		return 1
	default:
		return 0
	}
}

// SimplifiedSentimentScore returns the simplified consumer sentiment score (max 5).
func SimplifiedSentimentScore(current, yearAgo *float64) int {
	if current == nil || yearAgo == nil || *yearAgo == 0 {
		return 0
	}
	yoy := ((*current - *yearAgo) / math.Abs(*yearAgo)) * 100
	switch {
	case yoy <= -15:
		return 5
	case yoy <= -10:
		return 3
	case yoy <= -5:
		return 1
	default:
		return 0
	}
}

// SimplifiedDelinquencyScore returns the simplified credit delinquency score (max 5).
func SimplifiedDelinquencyScore(current, yearAgo *float64) int {
	if current == nil || yearAgo == nil {
		return 0
	}
	change := *current - *yearAgo
	switch {
	case change >= 1.0:
		return 5
	case change >= 0.5:
		return 3
	case change >= 0.2:
		return 1
	default:
		return 0
	}
}

// SimplifiedIncomeScore returns the simplified real income score (max 10).
func SimplifiedIncomeScore(current, yearAgo *float64) int {
	if current == nil || yearAgo == nil || *yearAgo == 0 {
		return 0
	}
	yoy := ((*current - *yearAgo) / math.Abs(*yearAgo)) * 100
	switch {
	case yoy >= 3.0:
		return 0
	case yoy >= 1.0:
		return 3
	case yoy >= 0.0:
		return 6
	default:
		return 10
	}
}

// SimplifiedJobRatioScore returns the simplified job openings ratio score (max 10).
func SimplifiedJobRatioScore(joltsVal, unemployVal *float64) int {
	if joltsVal == nil || unemployVal == nil || *unemployVal == 0 {
		return 0
	}
	ratio := *joltsVal / *unemployVal
	switch {
	case ratio >= 1.2:
		return 0
	case ratio >= 1.0:
		return 3
	case ratio >= 0.8:
		return 7
	default:
		return 10
	}
}

// SimplifiedU6U3Score returns the simplified U6-U3 spread score (max 7).
func SimplifiedU6U3Score(u3, u6 *float64) int {
	if u3 == nil || u6 == nil {
		return 0
	}
	spread := *u6 - *u3
	switch {
	case spread >= 5.0:
		return 7
	case spread >= 4.5:
		return 4
	case spread >= 4.0:
		return 2
	default:
		return 0
	}
}

// SimplifiedLFPRScore returns the simplified labor force participation score (max 5).
func SimplifiedLFPRScore(currentLFPR, yearAgoLFPR *float64) int {
	if currentLFPR == nil || yearAgoLFPR == nil {
		return 0
	}
	yoyChange := *currentLFPR - *yearAgoLFPR
	switch {
	case yoyChange <= -0.5:
		return 5
	case yoyChange <= -0.3:
		return 3
	case yoyChange <= -0.2:
		return 1
	default:
		return 0
	}
}

// SimplifiedKShapeScore returns the simplified K-shape proxy score (max 3).
func SimplifiedKShapeScore(ratio *float64) int {
	if ratio == nil {
		return 0
	}
	switch {
	case *ratio < 0.40:
		return 3
	case *ratio < 0.45:
		return 2
	case *ratio < 0.50:
		return 1
	default:
		return 0
	}
}
