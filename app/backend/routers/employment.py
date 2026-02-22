"""
/api/employment - 景気警戒タブデータ
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
import main
import math
import statistics

router = APIRouter()


class EconomicIndicator(BaseModel):
    """経済指標"""
    id: int
    indicator: str
    reference_period: date
    current_value: Optional[float]
    revision_count: int
    nfp_change: Optional[int]
    u3_rate: Optional[float]
    u6_rate: Optional[float]
    avg_hourly_earnings: Optional[float]
    wage_mom: Optional[float]
    labor_force_participation: Optional[float]
    notes: Optional[str]


class WeeklyClaims(BaseModel):
    """週次失業保険"""
    week_ending: date
    initial_claims: Optional[int]
    continued_claims: Optional[int]
    initial_claims_4w_avg: Optional[int]


class EmploymentOverview(BaseModel):
    """雇用概要"""
    latest_nfp: Optional[EconomicIndicator]
    latest_claims: Optional[WeeklyClaims]

    # 警戒レベル
    alert_level: str  # Low, Medium, High
    alert_factors: list[str]


@router.get("/overview", response_model=EmploymentOverview)
async def get_employment_overview():
    """
    景気警戒タブ：雇用概要（最新データ）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # NFP（雇用統計）の最新データ
        nfp = supabase.table("economic_indicators").select("*").eq("indicator", "NFP").order("reference_period", desc=True).limit(1).execute()

        # 週次失業保険の最新データ
        claims = supabase.table("weekly_claims").select("*").order("week_ending", desc=True).limit(1).execute()

        nfp_data = EconomicIndicator(**nfp.data[0]) if nfp.data else None
        claims_data = WeeklyClaims(**claims.data[0]) if claims.data else None

        # 警戒レベル判定
        alert_factors = []
        alert_level_score = 0

        if nfp_data:
            # 失業率チェック
            if nfp_data.u3_rate and nfp_data.u3_rate > 5.0:
                alert_factors.append(f"失業率高水準: {nfp_data.u3_rate}%")
                alert_level_score += 2
            elif nfp_data.u3_rate and nfp_data.u3_rate > 4.5:
                alert_factors.append(f"失業率上昇中: {nfp_data.u3_rate}%")
                alert_level_score += 1

            # NFP変化チェック
            if nfp_data.nfp_change and nfp_data.nfp_change < 0:
                alert_factors.append(f"雇用減少: {nfp_data.nfp_change}千人")
                alert_level_score += 2
            elif nfp_data.nfp_change and nfp_data.nfp_change < 100:
                alert_factors.append(f"雇用増加鈍化: {nfp_data.nfp_change}千人")
                alert_level_score += 1

        if claims_data:
            # 新規失業保険申請
            if claims_data.initial_claims and claims_data.initial_claims > 300000:
                alert_factors.append(f"新規失業保険申請増加: {claims_data.initial_claims:,}件")
                alert_level_score += 2
            elif claims_data.initial_claims and claims_data.initial_claims > 250000:
                alert_factors.append(f"新規失業保険申請やや増加: {claims_data.initial_claims:,}件")
                alert_level_score += 1

        # 警戒レベル判定
        if alert_level_score >= 4:
            alert_level = "High"
        elif alert_level_score >= 2:
            alert_level = "Medium"
        else:
            alert_level = "Low"

        return EmploymentOverview(
            latest_nfp=nfp_data,
            latest_claims=claims_data,
            alert_level=alert_level,
            alert_factors=alert_factors,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/indicators")
async def get_economic_indicators(
    indicator: Optional[str] = Query(None, description="指標名でフィルタ: NFP, GDP, CPI等"),
    limit: int = Query(12, description="取得件数"),
):
    """経済指標履歴"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("economic_indicators").select("*")

        if indicator:
            query = query.eq("indicator", indicator.upper())

        result = query.order("reference_period", desc=True).limit(limit).execute()
        return {"data": result.data, "count": len(result.data)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/weekly-claims")
async def get_weekly_claims(
    limit: int = Query(12, description="取得件数"),
):
    """週次失業保険履歴"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("weekly_claims").select("*").order("week_ending", desc=True).limit(limit).execute()
        return {"data": result.data, "count": len(result.data)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/revisions/{indicator_id}")
async def get_indicator_revisions(indicator_id: int):
    """経済指標の修正履歴"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("economic_indicator_revisions").select("*").eq("indicator_id", indicator_id).order("revision_number").execute()
        return {"data": result.data, "count": len(result.data)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 経済指標 登録・修正（自動リビジョン追跡）
# ============================================================

class IndicatorInput(BaseModel):
    """経済指標 入力"""
    indicator: str               # "NFP", "GDP", "CPI" 等
    reference_period: str        # "2026-01-01"
    current_value: Optional[float] = None
    nfp_change: Optional[int] = None
    u3_rate: Optional[float] = None
    u6_rate: Optional[float] = None
    avg_hourly_earnings: Optional[float] = None
    wage_mom: Optional[float] = None
    labor_force_participation: Optional[float] = None
    notes: Optional[str] = None


@router.post("/indicators")
async def upsert_indicator(data: IndicatorInput):
    """
    経済指標を登録または更新。値が変わった場合は自動で修正履歴を記録。

    - 新規: revision_number=0（速報）として記録
    - 更新: current_value が変わった場合のみ revision_count++ & 修正履歴追加
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        indicator = data.indicator.upper()

        # 既存レコード検索
        existing = supabase.table("economic_indicators") \
            .select("id,current_value,revision_count") \
            .eq("indicator", indicator) \
            .eq("reference_period", data.reference_period) \
            .limit(1).execute()

        row = {
            "indicator": indicator,
            "reference_period": data.reference_period,
            "current_value": data.current_value,
            "nfp_change": data.nfp_change,
            "u3_rate": data.u3_rate,
            "u6_rate": data.u6_rate,
            "avg_hourly_earnings": data.avg_hourly_earnings,
            "wage_mom": data.wage_mom,
            "labor_force_participation": data.labor_force_participation,
            "notes": data.notes,
            "updated_at": datetime.now().isoformat(),
        }

        if not existing.data:
            # ===== 新規登録 =====
            row["revision_count"] = 0
            result = supabase.table("economic_indicators").insert(row).execute()
            indicator_id = result.data[0]["id"]

            # 速報（revision_number=0）を記録
            if data.current_value is not None:
                supabase.table("economic_indicator_revisions").insert({
                    "indicator_id": indicator_id,
                    "revision_number": 0,
                    "value": data.current_value,
                    "published_date": datetime.now().strftime("%Y-%m-%d"),
                    "notes": "速報",
                }).execute()

            return {
                "status": "created",
                "id": indicator_id,
                "revision_number": 0,
            }

        else:
            # ===== 更新 =====
            rec = existing.data[0]
            indicator_id = rec["id"]
            old_value = rec["current_value"]
            old_rev_count = rec.get("revision_count") or 0

            # current_value が変わった場合のみ修正履歴を追加
            value_changed = (
                data.current_value is not None
                and old_value is not None
                and float(data.current_value) != float(old_value)
            )

            if value_changed:
                new_rev_count = old_rev_count + 1
                row["revision_count"] = new_rev_count

                # 修正履歴を記録
                change = data.current_value - old_value
                change_pct = (change / abs(old_value) * 100) if old_value != 0 else None
                direction = "上方修正" if change > 0 else "下方修正"

                supabase.table("economic_indicator_revisions").insert({
                    "indicator_id": indicator_id,
                    "revision_number": new_rev_count,
                    "value": data.current_value,
                    "published_date": datetime.now().strftime("%Y-%m-%d"),
                    "change_from_prev": round(change, 4),
                    "change_pct_from_prev": round(change_pct, 4) if change_pct is not None else None,
                    "notes": f"{direction}: {old_value} → {data.current_value}",
                }).execute()
            else:
                row["revision_count"] = old_rev_count

            # 指標レコード更新
            supabase.table("economic_indicators") \
                .update(row) \
                .eq("id", indicator_id) \
                .execute()

            return {
                "status": "revised" if value_changed else "updated",
                "id": indicator_id,
                "revision_number": old_rev_count + 1 if value_changed else old_rev_count,
                "change": round(change, 2) if value_changed else None,
                "direction": direction if value_changed else None,
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# リスクスコア計算（100点満点・5フェーズ — Demo準拠3カテゴリ）
# 雇用(50点) + 消費(25点) + 構造(25点)
# ============================================================

class RiskSubScore(BaseModel):
    name: str
    score: int
    max_score: int
    detail: str
    status: str  # "normal", "warning", "danger"


class RiskScoreCategory(BaseModel):
    name: str
    score: int
    max_score: int
    components: list[RiskSubScore]


class SahmRuleData(BaseModel):
    current_u3: Optional[float]
    u3_3m_avg: Optional[float]
    u3_12m_low_3m_avg: Optional[float]
    sahm_value: Optional[float]
    triggered: bool
    peak_out: bool = False
    near_peak_out: bool = False


class PhaseInfo(BaseModel):
    code: str
    label: str
    description: str
    action: str
    color: str
    position_limit: int


class EmploymentRiskScore(BaseModel):
    total_score: int
    phase: PhaseInfo
    categories: list[RiskScoreCategory]
    sahm_rule: SahmRuleData
    alert_factors: list[str]
    timestamp: str
    latest_nfp: Optional[dict]
    latest_claims: Optional[dict]
    nfp_history: list[dict]
    claims_history: list[dict]
    consumer_history: list[dict]


PHASES = [
    {"code": "EXPANSION", "label": "拡大期", "color": "green", "position_limit": 80,
     "description": "雇用市場は力強く拡大中。過熱リスクに注意。",
     "action": "過熱警戒。利確・回転を意識。ポジション上限80%"},
    {"code": "SLOWDOWN", "label": "減速期", "color": "cyan", "position_limit": 100,
     "description": "最良の買い場。バックテスト勝率81%、平均+8.4%/6ヶ月。",
     "action": "積極投資OK。フルポジション可"},
    {"code": "CAUTION", "label": "警戒期", "color": "yellow", "position_limit": 70,
     "description": "複数の指標が悪化傾向。景気後退リスクが高まっている。",
     "action": "現物のみ。新規ポジション抑制。ポジション上限70%"},
    {"code": "CONTRACTION", "label": "収縮期", "color": "orange", "position_limit": 40,
     "description": "景気後退入りの可能性が高い。最も危険なフェーズ。",
     "action": "信用取引禁止。現金比率引き上げ。ポジション上限40%"},
    {"code": "CRISIS", "label": "危機", "color": "red", "position_limit": 60,
     "description": "深刻な景気後退。ただし底値圏のため逆張りチャンス。",
     "action": "分割で現物仕込み。底値圏の逆張り。ポジション上限60%"},
]


def _get_phase(score: int) -> PhaseInfo:
    if score <= 20:
        p = PHASES[0]
    elif score <= 40:
        p = PHASES[1]
    elif score <= 60:
        p = PHASES[2]
    elif score <= 80:
        p = PHASES[3]
    else:
        p = PHASES[4]
    return PhaseInfo(**p)


# ----- 雇用カテゴリ (50点) -----

def _calc_nfp_trend(nfp_data: list[dict]) -> RiskSubScore:
    """NFPトレンド (25点): 直近3ヶ月のNFP変化平均"""
    changes = [d["nfp_change"] for d in nfp_data[:6] if d.get("nfp_change") is not None]
    avg = statistics.mean(changes[:3]) if len(changes) >= 3 else (changes[0] if changes else 0)

    if avg > 200:
        score = 0
    elif avg > 150:
        score = 5
    elif avg > 100:
        score = 10
    elif avg > 50:
        score = 15
    elif avg > 0:
        score = 20
    else:
        score = 25

    status = "normal" if score <= 10 else "warning" if score <= 20 else "danger"
    return RiskSubScore(
        name="NFPトレンド", score=score, max_score=25,
        detail=f"3ヶ月平均: {avg:+.0f}K" if changes else "データなし",
        status=status,
    )


def _calc_sahm_rule(nfp_data: list[dict]) -> tuple[RiskSubScore, SahmRuleData]:
    """サームルール (15点): U3 3ヶ月平均 − 12ヶ月最小の3ヶ月平均"""
    u3_values = [d["u3_rate"] for d in sorted(nfp_data, key=lambda x: x.get("reference_period", ""))
                 if d.get("u3_rate") is not None]

    if len(u3_values) < 3:
        return (
            RiskSubScore(name="サームルール", score=0, max_score=15, detail="データ不足", status="normal"),
            SahmRuleData(current_u3=u3_values[-1] if u3_values else None,
                         u3_3m_avg=None, u3_12m_low_3m_avg=None, sahm_value=None, triggered=False),
        )

    avgs_3m = [statistics.mean(u3_values[i-2:i+1]) for i in range(2, len(u3_values))]
    current_3m_avg = avgs_3m[-1]
    low_12m_3m_avg = min(avgs_3m[-12:]) if len(avgs_3m) >= 12 else min(avgs_3m)
    sahm_value = round(current_3m_avg - low_12m_3m_avg, 2)
    triggered = sahm_value >= 0.5

    # Demo準拠閾値
    if sahm_value >= 0.5:
        score = 15
    elif sahm_value >= 0.3:
        score = 8
    elif sahm_value >= 0.15:
        score = 4
    else:
        score = 0

    # ピークアウト検知（Demo準拠）
    peak_out = False
    near_peak_out = False
    if triggered and len(avgs_3m) >= 2:
        prev_3m_avg = avgs_3m[-2]
        prev_low = min(avgs_3m[-13:-1]) if len(avgs_3m) >= 13 else min(avgs_3m[:-1])
        prev_rise = prev_3m_avg - prev_low
        rise_diff = prev_rise - sahm_value
        if rise_diff >= 0.05:
            peak_out = True
        elif rise_diff >= 0:
            near_peak_out = True

    detail = f"Sahm値: {sahm_value:.2f}"
    if triggered:
        if peak_out:
            detail += " (ピークアウト)"
        else:
            detail += " (発動)"

    status = "danger" if triggered else "warning" if score >= 4 else "normal"
    return (
        RiskSubScore(
            name="サームルール", score=score, max_score=15,
            detail=detail,
            status=status,
        ),
        SahmRuleData(
            current_u3=round(u3_values[-1], 1),
            u3_3m_avg=round(current_3m_avg, 2),
            u3_12m_low_3m_avg=round(low_12m_3m_avg, 2),
            sahm_value=sahm_value, triggered=triggered,
            peak_out=peak_out, near_peak_out=near_peak_out,
        ),
    )


def _calc_claims_level(claims_data: list[dict]) -> RiskSubScore:
    """失業保険水準 (5点): 4W平均の絶対水準 OR モメンタム（Demo準拠）"""
    avgs = [d.get("initial_claims_4w_avg") or d.get("initial_claims")
            for d in claims_data[:8]]
    avgs = [v for v in avgs if v is not None]

    if not avgs:
        return RiskSubScore(name="失業保険", score=0, max_score=5, detail="データ不足", status="normal")

    level = avgs[0]  # 最新の4W avg

    # 変化率: 直近4W avg vs 前月4W avg
    change_pct = 0.0
    if len(avgs) >= 8:
        current_avg = statistics.mean(avgs[:4])
        prev_avg = statistics.mean(avgs[4:8])
        if prev_avg > 0:
            change_pct = ((current_avg - prev_avg) / prev_avg) * 100

    # Demo準拠: 水準 OR 変化率のどちらか高い方でスコア
    if level >= 300000 or change_pct >= 20:
        score = 5
    elif level >= 250000 or change_pct >= 10:
        score = 3
    elif level >= 220000 or change_pct >= 5:
        score = 1
    else:
        score = 0

    detail = f"4W平均: {level/1000:.0f}K"
    if change_pct >= 5:
        detail += f" (前月比: {change_pct:+.1f}%)"

    status = "danger" if score >= 5 else "warning" if score >= 1 else "normal"
    return RiskSubScore(
        name="失業保険", score=score, max_score=5,
        detail=detail,
        status=status,
    )


def _calc_employment_discrepancy(supabase, nfp_data: list[dict], claims_data: list[dict]) -> RiskSubScore:
    """雇用乖離 (5点): Demo準拠 — ADP/Challenger/ICSA vs 公式NFP の乖離をシグモイド変換"""
    # NFP 3ヶ月平均
    changes = [d["nfp_change"] for d in nfp_data[:3] if d.get("nfp_change") is not None]
    if not changes:
        return RiskSubScore(name="雇用乖離", score=0, max_score=5, detail="NFPデータなし", status="normal")
    nfp_3m_avg = statistics.mean(changes)

    gaps: list[tuple[str, float, float]] = []  # (name, gap, weight)

    # ADP（manual_inputsテーブルから取得）
    try:
        adp_result = supabase.table("manual_inputs") \
            .select("value").eq("metric", "ADP_CHANGE") \
            .order("reference_date", desc=True).limit(3).execute()
        if adp_result.data and len(adp_result.data) >= 3:
            adp_values = [r["value"] for r in adp_result.data[:3]]
            adp_3m_avg = statistics.mean(adp_values)
            gap_adp = nfp_3m_avg - adp_3m_avg
            gaps.append(("ADP", gap_adp, 1.0))
    except Exception:
        pass  # テーブルなし = スキップ

    # Challenger（manual_inputsから）
    try:
        challenger_result = supabase.table("manual_inputs") \
            .select("value").eq("metric", "CHALLENGER_CUTS") \
            .order("reference_date", desc=True).limit(1).execute()
        if challenger_result.data:
            challenger_val = challenger_result.data[0]["value"]
            if challenger_val > 50000 and nfp_3m_avg > 0:
                gap_ch = min(50, (challenger_val - 50000) / 1000)
                gaps.append(("Challenger", gap_ch, 0.5))
    except Exception:
        pass

    # ICSA逆指標（自動: weekly_claimsから）
    icsa_avgs = [d.get("initial_claims_4w_avg") or d.get("initial_claims")
                 for d in claims_data[:1]]
    icsa_avgs = [v for v in icsa_avgs if v is not None]
    if icsa_avgs:
        icsa_val = icsa_avgs[0]
        if icsa_val > 250000 and nfp_3m_avg > 50:
            gap_icsa = min(30, (icsa_val - 220000) / 5000)
            gaps.append(("ICSA", gap_icsa, 0.3))

    if not gaps:
        return RiskSubScore(name="雇用乖離", score=0, max_score=5, detail="代替データ不足", status="normal")

    # 加重平均 → シグモイド変換(0-100)
    total_weight = sum(w for _, _, w in gaps)
    weighted_gap = sum(g * w for _, g, w in gaps) / total_weight
    disc_score = 100 / (1 + math.exp(-weighted_gap / 30))

    # 5点変換（Demo準拠）
    if disc_score >= 70:
        score = 5
    elif disc_score >= 50:
        score = 2
    else:
        score = 0

    sources = ", ".join(n for n, _, _ in gaps)
    status = "danger" if score >= 5 else "warning" if score >= 2 else "normal"
    return RiskSubScore(
        name="雇用乖離", score=score, max_score=5,
        detail=f"乖離: {disc_score:.0f}/100 ({sources})",
        status=status,
    )


# ----- 消費カテゴリ (25点) -----

def _calc_real_income(indicator_data: list[dict]) -> RiskSubScore:
    """実質個人所得 (10点): W875RX1 YoY%"""
    w875_data = sorted(
        [d for d in indicator_data if d.get("indicator") == "W875RX1" and d.get("current_value") is not None],
        key=lambda x: x.get("reference_period", ""), reverse=True,
    )

    if len(w875_data) < 13:
        # YoY計算不可: 直近値だけで判断
        if not w875_data:
            return RiskSubScore(name="実質個人所得", score=0, max_score=10, detail="データなし", status="normal")
        return RiskSubScore(name="実質個人所得", score=0, max_score=10, detail="YoY算出不可(データ不足)", status="normal")

    current = w875_data[0]["current_value"]
    year_ago = w875_data[12]["current_value"]

    if year_ago == 0:
        return RiskSubScore(name="実質個人所得", score=0, max_score=10, detail="ゼロ除算回避", status="normal")

    yoy = ((current - year_ago) / abs(year_ago)) * 100

    if yoy >= 3.0:
        score = 0
    elif yoy >= 1.0:
        score = 3
    elif yoy >= 0.0:
        score = 6
    else:
        score = 10

    status = "danger" if score >= 10 else "warning" if score >= 3 else "normal"
    return RiskSubScore(
        name="実質個人所得", score=score, max_score=10,
        detail=f"YoY: {yoy:+.1f}%",
        status=status,
    )


def _calc_consumer_sentiment(indicator_data: list[dict]) -> RiskSubScore:
    """消費者信頼感 (5点): UMCSENT"""
    umcsent_data = sorted(
        [d for d in indicator_data if d.get("indicator") == "UMCSENT" and d.get("current_value") is not None],
        key=lambda x: x.get("reference_period", ""), reverse=True,
    )

    if not umcsent_data:
        return RiskSubScore(name="消費者信頼感", score=0, max_score=5, detail="データなし", status="normal")

    val = umcsent_data[0]["current_value"]

    if val >= 80:
        score = 0
    elif val >= 70:
        score = 1
    elif val >= 60:
        score = 3
    else:
        score = 5

    status = "danger" if score >= 5 else "warning" if score >= 1 else "normal"
    return RiskSubScore(
        name="消費者信頼感", score=score, max_score=5,
        detail=f"UMCSENT: {val:.1f}",
        status=status,
    )


def _calc_credit_delinquency(indicator_data: list[dict]) -> RiskSubScore:
    """クレカ延滞率 (5点): DRCCLACBS YoY変化"""
    drc_data = sorted(
        [d for d in indicator_data if d.get("indicator") == "DRCCLACBS" and d.get("current_value") is not None],
        key=lambda x: x.get("reference_period", ""), reverse=True,
    )

    if not drc_data:
        return RiskSubScore(name="クレカ延滞率", score=0, max_score=5, detail="データなし", status="normal")

    current = drc_data[0]["current_value"]

    # 四半期データ: 4四半期前 = YoY
    if len(drc_data) >= 5:
        year_ago = drc_data[4]["current_value"]
        yoy_change = current - year_ago

        if yoy_change >= 1.0:
            score = 5
        elif yoy_change >= 0.5:
            score = 3
        elif yoy_change >= 0.2:
            score = 1
        else:
            score = 0

        status = "danger" if score >= 5 else "warning" if score >= 1 else "normal"
        detail = f"{current:.2f}% (YoY変化: {yoy_change:+.2f}pp)"
    else:
        score = 0
        status = "normal"
        detail = f"{current:.2f}% (YoY算出不可)"

    return RiskSubScore(name="クレカ延滞率", score=score, max_score=5, detail=detail, status=status)


def _calc_inflation_discrepancy(supabase, indicator_data: list[dict]) -> RiskSubScore:
    """インフレ乖離 (5点): Demo準拠 — コアCPI YoY vs Truflation の乖離"""
    # コアCPI (CPILFESL) のYoY計算
    cpi_data = sorted(
        [d for d in indicator_data if d.get("indicator") == "CPILFESL" and d.get("current_value") is not None],
        key=lambda x: x.get("reference_period", ""), reverse=True,
    )

    if len(cpi_data) < 13:
        return RiskSubScore(name="インフレ乖離", score=0, max_score=5, detail="CPIデータ不足", status="normal")

    current_cpi = cpi_data[0]["current_value"]
    year_ago_cpi = cpi_data[12]["current_value"]
    if year_ago_cpi == 0:
        return RiskSubScore(name="インフレ乖離", score=0, max_score=5, detail="ゼロ除算回避", status="normal")

    cpi_yoy = ((current_cpi - year_ago_cpi) / abs(year_ago_cpi)) * 100

    # Truflation（manual_inputsから取得）
    truflation_value = None
    try:
        tru_result = supabase.table("manual_inputs") \
            .select("value").eq("metric", "TRUFLATION") \
            .order("reference_date", desc=True).limit(1).execute()
        if tru_result.data:
            truflation_value = tru_result.data[0]["value"]
    except Exception:
        pass  # テーブルなし = スキップ

    if truflation_value is None:
        return RiskSubScore(
            name="インフレ乖離", score=0, max_score=5,
            detail=f"コアCPI YoY: {cpi_yoy:.1f}% (代替データなし)",
            status="normal",
        )

    # 乖離計算: gap = Truflation - コアCPI_YoY
    gap = truflation_value - cpi_yoy
    disc_score = 50 + (gap / 2.0) * 25
    disc_score = max(0, min(100, disc_score))

    if disc_score >= 70:
        score = 5
    elif disc_score >= 50:
        score = 2
    else:
        score = 0

    status = "danger" if score >= 5 else "warning" if score >= 2 else "normal"
    return RiskSubScore(
        name="インフレ乖離", score=score, max_score=5,
        detail=f"CPI: {cpi_yoy:.1f}% vs Tru: {truflation_value:.1f}% (Gap: {gap:+.1f}%)",
        status=status,
    )


# ----- 構造カテゴリ (25点) -----

def _calc_job_openings_ratio(jolts_data: list[dict], unemploy_data: list[dict]) -> RiskSubScore:
    """求人倍率 (15点): JTSJOL / UNEMPLOY"""
    if not jolts_data or not unemploy_data:
        return RiskSubScore(name="求人倍率", score=0, max_score=15, detail="データなし", status="normal")

    jolts_val = jolts_data[0].get("current_value")
    unemploy_val = unemploy_data[0].get("current_value")

    if not jolts_val or not unemploy_val or unemploy_val == 0:
        return RiskSubScore(name="求人倍率", score=0, max_score=15, detail="データ不足", status="normal")

    ratio = jolts_val / unemploy_val

    if ratio >= 1.2:
        score = 0
    elif ratio >= 1.0:
        score = 5
    elif ratio >= 0.8:
        score = 10
    else:
        score = 15

    status = "danger" if score >= 15 else "warning" if score >= 5 else "normal"
    return RiskSubScore(
        name="求人倍率", score=score, max_score=15,
        detail=f"JOLTS/失業者: {ratio:.2f}倍",
        status=status,
    )


def _calc_u6_u3_spread(nfp_data: list[dict]) -> RiskSubScore:
    """U6-U3スプレッド (5点)"""
    latest = nfp_data[0] if nfp_data else {}
    u3 = latest.get("u3_rate")
    u6 = latest.get("u6_rate")

    if u3 is None or u6 is None:
        return RiskSubScore(name="U6-U3スプレッド", score=0, max_score=5, detail="データなし", status="normal")

    spread = u6 - u3

    if spread >= 5.0:
        score = 5
    elif spread >= 4.5:
        score = 3
    elif spread >= 4.0:
        score = 1
    else:
        score = 0

    status = "danger" if score >= 5 else "warning" if score >= 1 else "normal"
    return RiskSubScore(
        name="U6-U3スプレッド", score=score, max_score=5,
        detail=f"スプレッド: {spread:.1f}% (U6={u6:.1f}% − U3={u3:.1f}%)",
        status=status,
    )


def _calc_labor_participation(nfp_data: list[dict]) -> RiskSubScore:
    """労働参加率 (3点): Demo準拠 — 構造カテゴリ内で3点配分"""
    latest = nfp_data[0] if nfp_data else {}
    lfpr = latest.get("labor_force_participation")

    if lfpr is None:
        return RiskSubScore(name="労働参加率", score=0, max_score=3, detail="データなし", status="normal")

    if lfpr < 62.0:
        score = 3
    elif lfpr < 62.5:
        score = 2
    elif lfpr < 63.0:
        score = 1
    else:
        score = 0

    status = "danger" if score >= 3 else "warning" if score >= 1 else "normal"
    return RiskSubScore(name="労働参加率", score=score, max_score=3, detail=f"{lfpr:.1f}%", status=status)


def _calc_k_shape_proxy() -> RiskSubScore:
    """K字型Proxy (2点): プレースホルダー — 将来実装予定"""
    return RiskSubScore(
        name="K字型Proxy", score=0, max_score=2,
        detail="未実装（将来テコ入れ予定）",
        status="normal",
    )


# ----- メインエンドポイント -----

@router.get("/risk-score")
async def get_risk_score():
    """
    景気警戒タブ：100点満点のリセッションリスクスコア
    雇用(50点) + 消費(25点) + 構造(25点) → 5フェーズ分類
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # ===== データ取得 =====
        nfp_result = supabase.table("economic_indicators") \
            .select("*").eq("indicator", "NFP") \
            .order("reference_period", desc=True).limit(24).execute()
        nfp_data = nfp_result.data or []

        claims_result = supabase.table("weekly_claims") \
            .select("*").order("week_ending", desc=True).limit(52).execute()
        claims_data = claims_result.data or []

        # 消費者・構造系列を一括取得（CPILFESL追加: インフレ乖離計算用）
        consumer_indicators = ["W875RX1", "UMCSENT", "DRCCLACBS", "CPILFESL"]
        consumer_result = supabase.table("economic_indicators") \
            .select("*").in_("indicator", consumer_indicators) \
            .order("reference_period", desc=True).limit(120).execute()
        consumer_data = consumer_result.data or []

        jolts_result = supabase.table("economic_indicators") \
            .select("*").eq("indicator", "JOLTS") \
            .order("reference_period", desc=True).limit(3).execute()
        jolts_data = jolts_result.data or []

        unemploy_result = supabase.table("economic_indicators") \
            .select("*").eq("indicator", "UNEMPLOY") \
            .order("reference_period", desc=True).limit(3).execute()
        unemploy_data = unemploy_result.data or []

        # ===== 雇用カテゴリ (50点) =====
        nfp_trend = _calc_nfp_trend(nfp_data)
        sahm_sub, sahm_data = _calc_sahm_rule(nfp_data)
        claims = _calc_claims_level(claims_data)
        discrepancy = _calc_employment_discrepancy(supabase, nfp_data, claims_data)

        employment_score = nfp_trend.score + sahm_sub.score + claims.score + discrepancy.score
        employment_cat = RiskScoreCategory(
            name="雇用", score=employment_score, max_score=50,
            components=[nfp_trend, sahm_sub, claims, discrepancy],
        )

        # ===== 消費カテゴリ (25点) =====
        real_income = _calc_real_income(consumer_data)
        sentiment = _calc_consumer_sentiment(consumer_data)
        delinquency = _calc_credit_delinquency(consumer_data)
        inflation_disc = _calc_inflation_discrepancy(supabase, consumer_data)

        consumer_score = real_income.score + sentiment.score + delinquency.score + inflation_disc.score
        consumer_cat = RiskScoreCategory(
            name="消費", score=consumer_score, max_score=25,
            components=[real_income, sentiment, delinquency, inflation_disc],
        )

        # ===== 構造カテゴリ (25点) =====
        job_ratio = _calc_job_openings_ratio(jolts_data, unemploy_data)
        u6u3 = _calc_u6_u3_spread(nfp_data)
        lfpr = _calc_labor_participation(nfp_data)
        k_shape = _calc_k_shape_proxy()

        structure_score = job_ratio.score + u6u3.score + lfpr.score + k_shape.score
        structure_cat = RiskScoreCategory(
            name="構造", score=structure_score, max_score=25,
            components=[job_ratio, u6u3, lfpr, k_shape],
        )

        # ===== 総合スコア =====
        total_score = employment_score + consumer_score + structure_score

        # サームルール強制ルール廃止（Demo準拠）
        # 理由: 2009-2010年の回復初動を殺してしまうため
        # サームルールはフラグ（triggered, peak_out）として情報提供のみ
        total_score = min(total_score, 100)

        # ===== アラート生成 =====
        alert_factors = []
        if sahm_data.triggered:
            alert_factors.append(f"サームルール発動: Sahm値 {sahm_data.sahm_value:.2f} ≥ 0.50")
        for cat in [employment_cat, consumer_cat, structure_cat]:
            for comp in cat.components:
                if comp.status in ("danger", "warning"):
                    alert_factors.append(f"{comp.name}: {comp.detail}")

        # ===== レスポンス =====
        return EmploymentRiskScore(
            total_score=total_score,
            phase=_get_phase(total_score),
            categories=[employment_cat, consumer_cat, structure_cat],
            sahm_rule=sahm_data,
            alert_factors=alert_factors,
            timestamp=datetime.now().isoformat(),
            latest_nfp=nfp_data[0] if nfp_data else None,
            latest_claims=claims_data[0] if claims_data else None,
            nfp_history=nfp_data,
            claims_history=claims_data,
            consumer_history=consumer_data,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 月次リスクスコア履歴 — 過去リスクスコア履歴タブ用
# ============================================================

def _simplified_nfp_score(nfp_rows: list[dict]) -> int:
    """NFPトレンド簡易スコア (25点満点)"""
    changes = [d["nfp_change"] for d in nfp_rows[:3] if d.get("nfp_change") is not None]
    if not changes:
        return 0
    avg = statistics.mean(changes)
    if avg > 200: return 0
    if avg > 150: return 5
    if avg > 100: return 10
    if avg > 50: return 15
    if avg > 0: return 20
    return 25


def _simplified_sahm_score(u3_values: list[float]) -> int:
    """サームルール簡易スコア (15点満点)"""
    if len(u3_values) < 3:
        return 0
    avgs_3m = [statistics.mean(u3_values[i-2:i+1]) for i in range(2, len(u3_values))]
    current_3m = avgs_3m[-1]
    low_12m = min(avgs_3m[-12:]) if len(avgs_3m) >= 12 else min(avgs_3m)
    sahm = current_3m - low_12m
    if sahm >= 0.5: return 15
    if sahm >= 0.3: return 8
    if sahm >= 0.15: return 4
    return 0


def _simplified_claims_score(claims_4w_avg: float | None) -> int:
    """失業保険簡易スコア (5点満点)"""
    if claims_4w_avg is None:
        return 0
    if claims_4w_avg >= 300000: return 5
    if claims_4w_avg >= 250000: return 3
    if claims_4w_avg >= 220000: return 1
    return 0


def _simplified_sentiment_score(val: float | None) -> int:
    """消費者信頼感スコア (5点)"""
    if val is None: return 0
    if val >= 80: return 0
    if val >= 70: return 1
    if val >= 60: return 3
    return 5


def _simplified_delinquency_score(current: float | None, year_ago: float | None) -> int:
    """クレカ延滞率スコア (5点)"""
    if current is None or year_ago is None: return 0
    change = current - year_ago
    if change >= 1.0: return 5
    if change >= 0.5: return 3
    if change >= 0.2: return 1
    return 0


def _simplified_inflation_disc_score() -> int:
    """インフレ乖離スコア (5点): 履歴用は0点固定（手動データの履歴取得は複雑すぎるため）"""
    return 0


def _simplified_income_score(current: float | None, year_ago: float | None) -> int:
    """実質個人所得スコア (10点)"""
    if current is None or year_ago is None or year_ago == 0: return 0
    yoy = ((current - year_ago) / abs(year_ago)) * 100
    if yoy >= 3.0: return 0
    if yoy >= 1.0: return 3
    if yoy >= 0.0: return 6
    return 10


def _simplified_job_ratio_score(jolts_val: float | None, unemploy_val: float | None) -> int:
    """求人倍率スコア (15点)"""
    if not jolts_val or not unemploy_val or unemploy_val == 0: return 0
    ratio = jolts_val / unemploy_val
    if ratio >= 1.2: return 0
    if ratio >= 1.0: return 5
    if ratio >= 0.8: return 10
    return 15


def _simplified_u6u3_score(u3: float | None, u6: float | None) -> int:
    """U6-U3スプレッドスコア (5点)"""
    if u3 is None or u6 is None: return 0
    spread = u6 - u3
    if spread >= 5.0: return 5
    if spread >= 4.5: return 3
    if spread >= 4.0: return 1
    return 0


def _simplified_lfpr_score(lfpr: float | None) -> int:
    """労働参加率スコア (3点): Demo準拠"""
    if lfpr is None: return 0
    if lfpr < 62.0: return 3
    if lfpr < 62.5: return 2
    if lfpr < 63.0: return 1
    return 0


@router.get("/risk-history")
async def get_risk_history(months: int = Query(120, description="取得月数")):
    """
    月次リスクスコア履歴を動的計算。
    各月について雇用(50)+消費(25)+構造(25)=100点のスコアを算出。
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # ===== バルクデータ取得 =====
        nfp_all = supabase.table("economic_indicators") \
            .select("*").eq("indicator", "NFP") \
            .order("reference_period").limit(months + 24).execute()
        nfp_rows = nfp_all.data or []

        claims_all = supabase.table("weekly_claims") \
            .select("week_ending,initial_claims,initial_claims_4w_avg") \
            .order("week_ending").limit(months * 5).execute()
        claims_rows = claims_all.data or []

        consumer_all = supabase.table("economic_indicators") \
            .select("indicator,reference_period,current_value") \
            .in_("indicator", ["W875RX1", "UMCSENT", "DRCCLACBS", "UNEMPLOY", "JOLTS"]) \
            .order("reference_period").limit(months * 6).execute()
        consumer_rows = consumer_all.data or []

        # NFPの日付範囲に合わせてSP500を取得（古い順）
        nfp_start_date = nfp_rows[0]["reference_period"] if nfp_rows else "2020-01-01"
        sp500_all = supabase.table("market_indicators") \
            .select("date,sp500") \
            .gte("date", nfp_start_date) \
            .order("date").limit(months * 22).execute()
        sp500_rows = sp500_all.data or []

        # ===== データをインデックス化 =====
        nfp_by_month: dict[str, list[dict]] = {}
        for row in nfp_rows:
            key = row["reference_period"][:7]
            nfp_by_month.setdefault(key, []).append(row)

        # Carry-forward辞書: 指標が月次でない場合、直近の値を引き継ぐ
        umcsent_by_month: dict[str, float] = {}
        w875_by_month: dict[str, float] = {}
        drc_by_month: dict[str, float] = {}
        jolts_by_month: dict[str, float] = {}
        unemploy_by_month: dict[str, float] = {}
        for row in consumer_rows:
            key = row["reference_period"][:7]
            val = row.get("current_value")
            if val is None:
                continue
            ind = row["indicator"]
            if ind == "UMCSENT": umcsent_by_month[key] = val
            elif ind == "W875RX1": w875_by_month[key] = val
            elif ind == "DRCCLACBS": drc_by_month[key] = val
            elif ind == "JOLTS": jolts_by_month[key] = val
            elif ind == "UNEMPLOY": unemploy_by_month[key] = val

        claims_by_month: dict[str, float] = {}
        for row in claims_rows:
            key = row["week_ending"][:7]
            val = row.get("initial_claims_4w_avg") or row.get("initial_claims")
            if val is not None:
                claims_by_month[key] = val

        sp500_by_month: dict[str, float] = {}
        for row in sp500_rows:
            key = row["date"][:7]
            val = row.get("sp500")
            if val is not None:
                sp500_by_month[key] = val

        # Carry-forward: 各辞書を全月にわたって直近値で埋める
        def carry_forward(d: dict[str, float], all_keys: list[str]) -> dict[str, float]:
            filled: dict[str, float] = {}
            last_val = None
            for k in all_keys:
                if k in d:
                    last_val = d[k]
                if last_val is not None:
                    filled[k] = last_val
            return filled

        all_month_keys = sorted(nfp_by_month.keys())
        umcsent_by_month = carry_forward(umcsent_by_month, all_month_keys)
        w875_by_month = carry_forward(w875_by_month, all_month_keys)
        drc_by_month = carry_forward(drc_by_month, all_month_keys)
        jolts_by_month = carry_forward(jolts_by_month, all_month_keys)
        unemploy_by_month = carry_forward(unemploy_by_month, all_month_keys)
        claims_by_month = carry_forward(claims_by_month, all_month_keys)

        # ===== 月次スコア計算 =====
        all_months = sorted(nfp_by_month.keys())
        history = []
        all_u3_values: list[float] = []

        for idx, month_key in enumerate(all_months):
            nfp_month_rows = nfp_by_month.get(month_key, [])
            if not nfp_month_rows:
                continue
            latest_nfp = nfp_month_rows[-1]

            u3 = latest_nfp.get("u3_rate")
            if u3 is not None:
                all_u3_values.append(u3)

            # Employment (50)
            recent_months = all_months[max(0, idx - 2):idx + 1]
            recent_nfp = []
            for m in recent_months:
                rows = nfp_by_month.get(m, [])
                if rows:
                    recent_nfp.append(rows[-1])
            nfp_s = _simplified_nfp_score(recent_nfp[::-1])
            sahm_s = _simplified_sahm_score(all_u3_values.copy())
            claims_s = _simplified_claims_score(claims_by_month.get(month_key))
            employment = min(nfp_s + sahm_s + claims_s, 50)

            # Consumer (25)
            try:
                yr, mo = int(month_key[:4]), int(month_key[5:7])
                prev_yr_key = f"{yr - 1}-{mo:02d}"
            except (ValueError, IndexError):
                prev_yr_key = ""
            sent_s = _simplified_sentiment_score(umcsent_by_month.get(month_key))
            income_s = _simplified_income_score(w875_by_month.get(month_key), w875_by_month.get(prev_yr_key))
            drc_s = _simplified_delinquency_score(drc_by_month.get(month_key), drc_by_month.get(prev_yr_key))
            infl_disc_s = _simplified_inflation_disc_score()
            consumer = min(sent_s + income_s + drc_s + infl_disc_s, 25)

            # Structure (25): 求人倍率(15) + U6-U3(5) + 労働参加率(3) + K字型(2)
            job_s = _simplified_job_ratio_score(jolts_by_month.get(month_key), unemploy_by_month.get(month_key))
            u6u3_s = _simplified_u6u3_score(u3, latest_nfp.get("u6_rate"))
            lfpr_s = _simplified_lfpr_score(latest_nfp.get("labor_force_participation"))
            k_shape_s = 0  # K字型Proxy: 将来実装予定
            structure = min(job_s + u6u3_s + lfpr_s + k_shape_s, 25)

            total = employment + consumer + structure

            # サームルール強制オーバーライド廃止（Demo準拠）
            # 理由: 2009-2010年の回復初動を殺してしまうため
            sahm_value = None
            if len(all_u3_values) >= 3:
                avgs_3m = [statistics.mean(all_u3_values[i-2:i+1]) for i in range(2, len(all_u3_values))]
                c3m = avgs_3m[-1]
                low_12m = min(avgs_3m[-12:]) if len(avgs_3m) >= 12 else min(avgs_3m)
                sahm_value = round(c3m - low_12m, 2)

            total = min(total, 100)
            phase = _get_phase(total)

            history.append({
                "date": latest_nfp["reference_period"],
                "total_score": total,
                "employment_score": employment,
                "consumer_score": consumer,
                "structure_score": structure,
                "phase": phase.code,
                "sahm_value": sahm_value,
            })

        sp500_list = [{"date": f"{k}-01", "close": v} for k, v in sorted(sp500_by_month.items())]

        return {"history": history, "sp500": sp500_list}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
