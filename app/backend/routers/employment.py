"""
/api/employment - 景気警戒タブデータ
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
import asyncio
import main
import math
import statistics
from auth import require_proxy, require_auth
from redis_cache import cache_get as _cache_get, cache_set as _cache_set

router = APIRouter(dependencies=[Depends(require_proxy)])

# ============================================================
# Phase 3: ThreadPoolExecutor (DB並列実行用)
# Phase 4: インメモリTTLキャッシュ
# ============================================================

_executor = ThreadPoolExecutor(max_workers=5)
_RISK_SCORE_TTL = 21600   # 6時間 (BLS月次更新)
_RISK_HISTORY_TTL = 21600  # 6時間


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
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/indicators")
async def get_economic_indicators(
    indicator: Optional[str] = Query(None, description="指標名でフィルタ: NFP, GDP, CPI等"),
    limit: int = Query(12, ge=1, le=500, description="取得件数"),
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
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/weekly-claims")
async def get_weekly_claims(
    limit: int = Query(12, ge=1, le=500, description="取得件数"),
):
    """週次失業保険履歴"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("weekly_claims").select("*").order("week_ending", desc=True).limit(limit).execute()
        return {"data": result.data, "count": len(result.data)}

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


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
        raise HTTPException(status_code=500, detail="Internal server error")


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


@router.post("/indicators", dependencies=[Depends(require_auth)])
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
        raise HTTPException(status_code=500, detail="Internal server error")


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
        detail=f"3M平均 {avg:+.0f}K（150K超で健全、50K以下で警戒）" if changes else "データなし",
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

    # 前月Sahm値を計算（2ヶ月連続条件用）
    prev_sahm = None
    if len(avgs_3m) >= 2:
        prev_low_for_prev = min(avgs_3m[-13:-1]) if len(avgs_3m) >= 13 else min(avgs_3m[:-1])
        prev_sahm = round(avgs_3m[-2] - prev_low_for_prev, 2)

    # 閾値（2ヶ月連続条件付き）
    if sahm_value >= 1.0:
        score = 15  # 極端値は即MAX
    elif sahm_value >= 0.5:
        if prev_sahm is not None and prev_sahm >= 0.5:
            score = 15  # 2ヶ月連続で確認済み
        else:
            score = 10  # 単月、未確認
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

    detail = f"Sahm値: {sahm_value:.2f}（0.50で不況シグナル発動）"
    if triggered:
        if peak_out:
            detail = f"Sahm値: {sahm_value:.2f}（発動中・ピークアウト兆候）"
        else:
            detail = f"Sahm値: {sahm_value:.2f}（⚠️ 不況シグナル発動中）"

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
    """失業保険水準 (2点): 週次ショック検知専用 — 4W平均の絶対水準のみ"""
    avgs = [d.get("initial_claims_4w_avg") or d.get("initial_claims")
            for d in claims_data[:4]]
    avgs = [v for v in avgs if v is not None]

    if not avgs:
        return RiskSubScore(name="失業保険", score=0, max_score=2, detail="データ不足", status="normal")

    level = avgs[0]  # 最新の4W avg

    if level >= 300000:
        score = 2
    elif level >= 250000:
        score = 1
    else:
        score = 0

    detail = f"4W平均 {level/1000:.0f}K（250K未満で健全、300K超で危険）"
    status = "danger" if score >= 2 else "warning" if score >= 1 else "normal"
    return RiskSubScore(
        name="失業保険", score=score, max_score=2,
        detail=detail,
        status=status,
    )


def _calc_employment_discrepancy(supabase, nfp_data: list[dict], claims_data: list[dict]) -> RiskSubScore:
    """雇用乖離 (8点): ADP/Challenger/ICSA vs 公式NFP の乖離をシグモイド変換
    Challenger適応閾値（3M平均×1.3）、ADP重み0.6、Challenger重み0.8(trend時1.0)"""
    # NFP 3ヶ月平均
    changes = [d["nfp_change"] for d in nfp_data[:3] if d.get("nfp_change") is not None]
    if not changes:
        return RiskSubScore(name="雇用乖離", score=0, max_score=8, detail="NFPデータなし", status="normal")
    nfp_3m_avg = statistics.mean(changes)

    gaps: list[tuple[str, float, float]] = []  # (name, gap, weight)

    # ADP（manual_inputsテーブルから取得）— 重み0.6
    try:
        adp_result = supabase.table("manual_inputs") \
            .select("value").eq("metric", "ADP_CHANGE") \
            .order("reference_date", desc=True).limit(3).execute()
        if adp_result.data and len(adp_result.data) >= 3:
            adp_values = [r["value"] for r in adp_result.data[:3]]
            adp_3m_avg = statistics.mean(adp_values)
            gap_adp = nfp_3m_avg - adp_3m_avg
            gaps.append(("ADP", gap_adp, 0.6))
    except Exception:
        pass

    # Challenger（適応閾値: 3M平均×1.3）— 重み0.8、trend時1.0
    try:
        challenger_result = supabase.table("manual_inputs") \
            .select("reference_date,value").eq("metric", "CHALLENGER_CUTS") \
            .order("reference_date", desc=True).limit(15).execute()
        if challenger_result.data and len(challenger_result.data) >= 1:
            ch_current = challenger_result.data[0]["value"]

            # 3ヶ月平均（直近を除く過去3ヶ月）
            ch_history = [r["value"] for r in challenger_result.data[1:4]] if len(challenger_result.data) >= 4 else []
            ch_3m_avg = statistics.mean(ch_history) if len(ch_history) >= 3 else 80000  # フォールバック

            # 適応閾値: 3M平均 × 1.3
            adaptive_threshold = ch_3m_avg * 1.3
            trend_flag = ch_current > adaptive_threshold

            # YoY 3ヶ月平均（12ヶ月前の3ヶ月）
            ch_yoy_flag = False
            if len(challenger_result.data) >= 13:
                recent_3 = [r["value"] for r in challenger_result.data[:3]]
                year_ago_3 = [r["value"] for r in challenger_result.data[12:15]] if len(challenger_result.data) >= 15 else []
                if recent_3 and year_ago_3:
                    recent_avg = statistics.mean(recent_3)
                    year_ago_avg = statistics.mean(year_ago_3)
                    if year_ago_avg > 0:
                        ch_yoy = ((recent_avg - year_ago_avg) / year_ago_avg) * 100
                        ch_yoy_flag = ch_yoy > 50  # YoY +50%超でフラグ

            # 乖離発動条件: 適応閾値超え AND NFP正
            if (trend_flag or ch_yoy_flag) and nfp_3m_avg > 0:
                gap_ch = min(50, (ch_current - ch_3m_avg) / 1000)
                weight = 1.0 if trend_flag else 0.8
                gaps.append(("Challenger", max(0, gap_ch), weight))
    except Exception:
        pass

    # ICSA逆指標（自動: weekly_claimsから）— 重み0.3
    icsa_avgs = [d.get("initial_claims_4w_avg") or d.get("initial_claims")
                 for d in claims_data[:1]]
    icsa_avgs = [v for v in icsa_avgs if v is not None]
    if icsa_avgs:
        icsa_val = icsa_avgs[0]
        if icsa_val > 250000 and nfp_3m_avg > 50:
            gap_icsa = min(30, (icsa_val - 220000) / 5000)
            gaps.append(("ICSA", gap_icsa, 0.3))

    if not gaps:
        return RiskSubScore(name="雇用乖離", score=0, max_score=8, detail="代替データ不足", status="normal")

    # 加重平均 → シグモイド変換(0-100)
    total_weight = sum(w for _, _, w in gaps)
    weighted_gap = sum(g * w for _, g, w in gaps) / total_weight
    disc_score = 100 / (1 + math.exp(-weighted_gap / 30))

    # 8点変換（ADP単独MAX制限: 確認ソースなしなら5pt上限）
    if disc_score >= 70:
        has_confirming = any(n != "ADP" for n, _, _ in gaps)
        score = 8 if has_confirming else 5
    elif disc_score >= 60:
        score = 5
    elif disc_score >= 50:
        score = 3
    else:
        score = 0

    sources = ", ".join(n for n, _, _ in gaps)
    status = "danger" if score >= 8 else "warning" if score >= 3 else "normal"
    return RiskSubScore(
        name="雇用乖離", score=score, max_score=8,
        detail=f"ADP等とNFPの乖離度 {disc_score:.0f}%（70%超で警戒、参照: {sources}）",
        status=status,
    )


def _calc_employment_discrepancy_v2(nfp_data: list[dict], claims_data: list[dict], manual_by_metric: dict[str, list[dict]]) -> RiskSubScore:
    """雇用乖離 (8点) — Phase1最適化版: manual_inputs を事前取得済みデータから参照"""
    changes = [d["nfp_change"] for d in nfp_data[:3] if d.get("nfp_change") is not None]
    if not changes:
        return RiskSubScore(name="雇用乖離", score=0, max_score=8, detail="NFPデータなし", status="normal")
    nfp_3m_avg = statistics.mean(changes)

    gaps: list[tuple[str, float, float]] = []

    # ADP — 重み0.6
    adp_rows = manual_by_metric.get("ADP_CHANGE", [])
    if len(adp_rows) >= 3:
        adp_values = [r["value"] for r in adp_rows[:3]]
        adp_3m_avg = statistics.mean(adp_values)
        gap_adp = nfp_3m_avg - adp_3m_avg
        gaps.append(("ADP", gap_adp, 0.6))

    # Challenger — 重み0.8、trend時1.0
    ch_rows = manual_by_metric.get("CHALLENGER_CUTS", [])
    if ch_rows:
        ch_current = ch_rows[0]["value"]
        ch_history = [r["value"] for r in ch_rows[1:4]] if len(ch_rows) >= 4 else []
        ch_3m_avg = statistics.mean(ch_history) if len(ch_history) >= 3 else 80000

        adaptive_threshold = ch_3m_avg * 1.3
        trend_flag = ch_current > adaptive_threshold

        ch_yoy_flag = False
        if len(ch_rows) >= 13:
            recent_3 = [r["value"] for r in ch_rows[:3]]
            year_ago_3 = [r["value"] for r in ch_rows[12:15]] if len(ch_rows) >= 15 else []
            if recent_3 and year_ago_3:
                recent_avg = statistics.mean(recent_3)
                year_ago_avg = statistics.mean(year_ago_3)
                if year_ago_avg > 0:
                    ch_yoy = ((recent_avg - year_ago_avg) / year_ago_avg) * 100
                    ch_yoy_flag = ch_yoy > 50

        if (trend_flag or ch_yoy_flag) and nfp_3m_avg > 0:
            gap_ch = min(50, (ch_current - ch_3m_avg) / 1000)
            weight = 1.0 if trend_flag else 0.8
            gaps.append(("Challenger", max(0, gap_ch), weight))

    # ICSA逆指標 — 重み0.3
    icsa_avgs = [d.get("initial_claims_4w_avg") or d.get("initial_claims") for d in claims_data[:1]]
    icsa_avgs = [v for v in icsa_avgs if v is not None]
    if icsa_avgs:
        icsa_val = icsa_avgs[0]
        if icsa_val > 250000 and nfp_3m_avg > 50:
            gap_icsa = min(30, (icsa_val - 220000) / 5000)
            gaps.append(("ICSA", gap_icsa, 0.3))

    if not gaps:
        return RiskSubScore(name="雇用乖離", score=0, max_score=8, detail="代替データなし", status="normal")

    total_weight = sum(w for _, _, w in gaps)
    weighted_gap = sum(g * w for _, g, w in gaps) / total_weight
    disc_score = 100 / (1 + math.exp(-weighted_gap / 30))

    if disc_score >= 70:
        has_confirming = any(n != "ADP" for n, _, _ in gaps)
        score = 8 if has_confirming else 5
    elif disc_score >= 60:
        score = 5
    elif disc_score >= 50:
        score = 3
    else:
        score = 0

    sources = ", ".join(n for n, _, _ in gaps)
    status = "danger" if score >= 8 else "warning" if score >= 3 else "normal"
    return RiskSubScore(
        name="雇用乖離", score=score, max_score=8,
        detail=f"ADP等とNFPの乖離度 {disc_score:.0f}%（70%超で警戒、参照: {sources}）",
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
        detail=f"実質所得 YoY {yoy:+.1f}%（3%超で健全、マイナスで危険）",
        status=status,
    )


def _calc_consumer_sentiment(indicator_data: list[dict]) -> RiskSubScore:
    """消費者信頼感 (5点): UMCSENT YoY方向性 — 政治バイアス排除のため水準ではなく変化率で判定"""
    umcsent_data = sorted(
        [d for d in indicator_data if d.get("indicator") == "UMCSENT" and d.get("current_value") is not None],
        key=lambda x: x.get("reference_period", ""), reverse=True,
    )

    if not umcsent_data:
        return RiskSubScore(name="消費者信頼感", score=0, max_score=5, detail="データなし", status="normal")

    current_val = umcsent_data[0]["current_value"]

    if len(umcsent_data) < 13:
        return RiskSubScore(name="消費者信頼感", score=0, max_score=5,
                            detail=f"UMCSENT: {current_val:.1f} (YoY算出不可)", status="normal")

    year_ago_val = umcsent_data[12]["current_value"]
    if year_ago_val == 0:
        return RiskSubScore(name="消費者信頼感", score=0, max_score=5, detail="ゼロ除算回避", status="normal")

    yoy = ((current_val - year_ago_val) / abs(year_ago_val)) * 100

    if yoy <= -15:
        score = 5
    elif yoy <= -10:
        score = 3
    elif yoy <= -5:
        score = 1
    else:
        score = 0

    status = "danger" if score >= 5 else "warning" if score >= 1 else "normal"
    return RiskSubScore(
        name="消費者信頼感", score=score, max_score=5,
        detail=f"消費者信頼感 {current_val:.1f}（YoY {yoy:+.1f}%、-15%超低下で警戒）",
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
        detail = f"延滞率 {current:.2f}%（YoY {yoy_change:+.2f}pp、+0.5pp超で警戒）"
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
        detail=f"CPI {cpi_yoy:.1f}% vs Truflation {truflation_value:.1f}%（差 {gap:+.1f}%、+1%超で隠れインフレ）",
        status=status,
    )


def _calc_inflation_discrepancy_v2(indicator_data: list[dict], manual_by_metric: dict[str, list[dict]]) -> RiskSubScore:
    """インフレ乖離 (5点) — Phase1最適化版: manual_inputs を事前取得済みデータから参照"""
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

    truflation_rows = manual_by_metric.get("TRUFLATION", [])
    truflation_value = truflation_rows[0]["value"] if truflation_rows else None

    if truflation_value is None:
        return RiskSubScore(
            name="インフレ乖離", score=0, max_score=5,
            detail=f"コアCPI YoY: {cpi_yoy:.1f}% (代替データなし)",
            status="normal",
        )

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
        detail=f"CPI {cpi_yoy:.1f}% vs Truflation {truflation_value:.1f}%（差 {gap:+.1f}%、+1%超で隠れインフレ）",
        status=status,
    )


# ----- 構造カテゴリ (25点) -----

def _calc_job_openings_ratio(jolts_data: list[dict], unemploy_data: list[dict]) -> RiskSubScore:
    """求人倍率 (10点): JTSJOL / UNEMPLOY — 2ヶ月遅延リスク軽減のため15→10点に減配"""
    if not jolts_data or not unemploy_data:
        return RiskSubScore(name="求人倍率", score=0, max_score=10, detail="データなし", status="normal")

    jolts_val = jolts_data[0].get("current_value")
    unemploy_val = unemploy_data[0].get("current_value")

    if not jolts_val or not unemploy_val or unemploy_val == 0:
        return RiskSubScore(name="求人倍率", score=0, max_score=10, detail="データ不足", status="normal")

    ratio = jolts_val / unemploy_val

    if ratio >= 1.2:
        score = 0
    elif ratio >= 1.0:
        score = 3
    elif ratio >= 0.8:
        score = 7
    else:
        score = 10

    status = "danger" if score >= 10 else "warning" if score >= 3 else "normal"
    return RiskSubScore(
        name="求人倍率", score=score, max_score=10,
        detail=f"求人/失業者 {ratio:.2f}倍（1.0倍超で労働者有利、0.8倍未満で深刻）",
        status=status,
    )


def _calc_u6_u3_spread(nfp_data: list[dict]) -> RiskSubScore:
    """U6-U3スプレッド (7点)"""
    latest = nfp_data[0] if nfp_data else {}
    u3 = latest.get("u3_rate")
    u6 = latest.get("u6_rate")

    if u3 is None or u6 is None:
        return RiskSubScore(name="U6-U3スプレッド", score=0, max_score=7, detail="データなし", status="normal")

    spread = u6 - u3

    if spread >= 5.0:
        score = 7
    elif spread >= 4.5:
        score = 4
    elif spread >= 4.0:
        score = 2
    else:
        score = 0

    status = "danger" if score >= 7 else "warning" if score >= 2 else "normal"
    return RiskSubScore(
        name="U6-U3スプレッド", score=score, max_score=7,
        detail=f"U6-U3 {spread:.1f}%（4.0%未満で健全、5.0%超で隠れ失業拡大）",
        status=status,
    )


def _calc_labor_participation(nfp_data: list[dict]) -> RiskSubScore:
    """労働参加率 (5点): YoY方向性 — 構造シフト耐性のため絶対水準ではなく変化で判定"""
    # nfp_dataは新しい順（limit=24で取得済み）
    lfpr_values = [(d.get("reference_period", ""), d.get("labor_force_participation"))
                   for d in nfp_data if d.get("labor_force_participation") is not None]

    if not lfpr_values:
        return RiskSubScore(name="労働参加率", score=0, max_score=5, detail="データなし", status="normal")

    current_lfpr = lfpr_values[0][1]

    if len(lfpr_values) < 13:
        return RiskSubScore(name="労働参加率", score=0, max_score=5,
                            detail=f"LFPR: {current_lfpr:.1f}% (YoY算出不可)", status="normal")

    year_ago_lfpr = lfpr_values[12][1]
    yoy_change = current_lfpr - year_ago_lfpr  # pp（ポイント）

    if yoy_change <= -0.5:
        score = 5
    elif yoy_change <= -0.3:
        score = 3
    elif yoy_change <= -0.2:
        score = 1
    else:
        score = 0

    status = "danger" if score >= 5 else "warning" if score >= 1 else "normal"
    return RiskSubScore(
        name="労働参加率", score=score, max_score=5,
        detail=f"参加率 {current_lfpr:.1f}%（YoY {yoy_change:+.1f}pp、-0.3pp超低下で警戒）",
        status=status,
    )


def _calc_k_shape_proxy(market_data: list[dict]) -> RiskSubScore:
    """K字型Proxy (3点): RUT/SPX比率の絶対水準で格差を検出
    歴史的にRUT/SPXは0.55-0.63が健全圏。0.50以下はK字型拡大。
    2024-2025は0.36-0.39と過去最低水準。
    """
    if not market_data:
        return RiskSubScore(
            name="K字型Proxy", score=0, max_score=3,
            detail="市場データなし",
            status="normal",
        )

    # market_dataは日付降順 — 直近のRUT/SPX比率を取得
    ratio = None
    for row in market_data:
        sp = row.get("sp500")
        rut = row.get("russell2000")
        if sp and rut and sp > 0:
            ratio = rut / sp
            break

    if ratio is None:
        return RiskSubScore(
            name="K字型Proxy", score=0, max_score=3,
            detail="RUT/SPXデータなし",
            status="normal",
        )

    # 絶対水準判定: 歴史的分布(2011-2026)から設定
    # P50=0.56, P25=0.46, P10=0.39, P5=0.37
    if ratio < 0.40:
        score = 3
    elif ratio < 0.45:
        score = 2
    elif ratio < 0.50:
        score = 1
    else:
        score = 0

    status = "danger" if score >= 3 else "warning" if score >= 1 else "normal"
    return RiskSubScore(
        name="K字型Proxy", score=score, max_score=3,
        detail=f"RUT/SPX {ratio:.3f}（0.50超で健全、0.40未満で格差極大）",
        status=status,
    )


# ----- メインエンドポイント -----

@router.get("/risk-score")
async def get_risk_score():
    """
    景気警戒タブ：100点満点のリセッションリスクスコア
    雇用(50点) + 消費(25点) + 構造(25点) → 5フェーズ分類

    最適化: Phase1(クエリ統合9→5) + Phase3(並列実行) + Phase4(1hキャッシュ)
    高速パス: バッチ事前計算結果があれば即座に返す
    """
    # 高速パス: 事前計算結果をチェック
    from precomputed import get_precomputed
    precomputed = get_precomputed("risk_score")
    if precomputed is not None:
        return precomputed

    # キャッシュチェック（L1 インメモリ → L2 Redis）
    cached = _cache_get("employment:risk_score")
    if cached is not None:
        return cached

    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        loop = asyncio.get_event_loop()

        # Phase 1: クエリ統合 (9→5)
        # 1. NFP (変更なし)
        # 2. weekly_claims (変更なし)
        # 3. JOLTS+UNEMPLOY を consumer クエリに統合
        # 4. manual_inputs を1回のバッチクエリに統合
        # 5. market_indicators limit 300→2

        def fetch_nfp():
            return supabase.table("economic_indicators") \
                .select("*").eq("indicator", "NFP") \
                .order("reference_period", desc=True).limit(24).execute()

        def fetch_claims():
            return supabase.table("weekly_claims") \
                .select("*").order("week_ending", desc=True).limit(52).execute()

        def fetch_all_indicators():
            """Phase 1-2: JOLTS+UNEMPLOY を consumer系と統合 (3クエリ→1)"""
            all_indicators = ["W875RX1", "UMCSENT", "DRCCLACBS", "CPILFESL", "JOLTS", "UNEMPLOY"]
            return supabase.table("economic_indicators") \
                .select("*").in_("indicator", all_indicators) \
                .order("reference_period", desc=True).limit(150).execute()

        def fetch_market():
            """Phase 1-1: limit 300→2 (K字型は最新1行で十分)"""
            return supabase.table("market_indicators") \
                .select("date,sp500,russell2000") \
                .order("date", desc=True).limit(2).execute()

        def fetch_manual_inputs():
            """Phase 1-3: ADP+Challenger+Truflation を1回で取得"""
            return supabase.table("manual_inputs") \
                .select("metric,reference_date,value") \
                .in_("metric", ["ADP_CHANGE", "CHALLENGER_CUTS", "TRUFLATION"]) \
                .order("reference_date", desc=True).limit(30).execute()

        # Phase 3: 5クエリを並列実行
        nfp_fut = loop.run_in_executor(_executor, fetch_nfp)
        claims_fut = loop.run_in_executor(_executor, fetch_claims)
        indicators_fut = loop.run_in_executor(_executor, fetch_all_indicators)
        market_fut = loop.run_in_executor(_executor, fetch_market)
        manual_fut = loop.run_in_executor(_executor, fetch_manual_inputs)

        nfp_result, claims_result, indicators_result, market_result, manual_result = await asyncio.gather(
            nfp_fut, claims_fut, indicators_fut, market_fut, manual_fut
        )

        nfp_data = nfp_result.data or []
        claims_data = claims_result.data or []
        market_data = market_result.data or []

        # Phase 1-2: 統合結果をPython側で振り分け
        all_indicators_data = indicators_result.data or []
        consumer_data = [d for d in all_indicators_data if d.get("indicator") in ("W875RX1", "UMCSENT", "DRCCLACBS", "CPILFESL")]
        jolts_data = [d for d in all_indicators_data if d.get("indicator") == "JOLTS"]
        unemploy_data = [d for d in all_indicators_data if d.get("indicator") == "UNEMPLOY"]

        # Phase 1-3: manual_inputs振り分け
        all_manual = manual_result.data or []
        manual_by_metric: dict[str, list[dict]] = {}
        for row in all_manual:
            manual_by_metric.setdefault(row["metric"], []).append(row)

        # ===== 雇用カテゴリ (50点) =====
        nfp_trend = _calc_nfp_trend(nfp_data)
        sahm_sub, sahm_data = _calc_sahm_rule(nfp_data)
        claims = _calc_claims_level(claims_data)
        discrepancy = _calc_employment_discrepancy_v2(nfp_data, claims_data, manual_by_metric)

        employment_score = nfp_trend.score + sahm_sub.score + claims.score + discrepancy.score
        employment_cat = RiskScoreCategory(
            name="雇用", score=employment_score, max_score=50,
            components=[nfp_trend, sahm_sub, discrepancy, claims],
        )

        # ===== 消費カテゴリ (25点) =====
        real_income = _calc_real_income(consumer_data)
        sentiment = _calc_consumer_sentiment(consumer_data)
        delinquency = _calc_credit_delinquency(consumer_data)
        inflation_disc = _calc_inflation_discrepancy_v2(consumer_data, manual_by_metric)

        consumer_score = real_income.score + sentiment.score + delinquency.score + inflation_disc.score
        consumer_cat = RiskScoreCategory(
            name="消費", score=consumer_score, max_score=25,
            components=[real_income, sentiment, delinquency, inflation_disc],
        )

        # ===== 構造カテゴリ (25点) =====
        job_ratio = _calc_job_openings_ratio(jolts_data, unemploy_data)
        u6u3 = _calc_u6_u3_spread(nfp_data)
        lfpr = _calc_labor_participation(nfp_data)
        k_shape = _calc_k_shape_proxy(market_data)

        structure_score = job_ratio.score + u6u3.score + lfpr.score + k_shape.score
        structure_cat = RiskScoreCategory(
            name="構造", score=structure_score, max_score=25,
            components=[job_ratio, u6u3, lfpr, k_shape],
        )

        # ===== 総合スコア（除外按分で100点正規化） =====
        raw_total = employment_score + consumer_score + structure_score

        inactive_max = 0
        for cat in [employment_cat, consumer_cat, structure_cat]:
            for comp in cat.components:
                if comp.score == 0 and ("未実装" in comp.detail or "代替データなし" in comp.detail):
                    inactive_max += comp.max_score
        active_max = 100 - inactive_max

        if active_max > 0 and active_max < 100:
            total_score = min(round(raw_total / active_max * 100), 100)
        else:
            total_score = min(raw_total, 100)

        # ===== アラート生成 =====
        alert_factors = []
        if sahm_data.triggered:
            alert_factors.append(f"サームルール発動: Sahm値 {sahm_data.sahm_value:.2f} ≥ 0.50")
        for cat in [employment_cat, consumer_cat, structure_cat]:
            for comp in cat.components:
                if comp.status in ("danger", "warning"):
                    alert_factors.append(f"{comp.name}: {comp.detail}")

        # ===== レスポンス =====
        result = EmploymentRiskScore(
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

        # キャッシュ保存 (1時間TTL)
        _cache_set("employment:risk_score", result, ttl=_RISK_SCORE_TTL)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


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
    """サームルール簡易スコア (15点満点、2ヶ月連続条件付き)"""
    if len(u3_values) < 3:
        return 0
    avgs_3m = [statistics.mean(u3_values[i-2:i+1]) for i in range(2, len(u3_values))]
    current_3m = avgs_3m[-1]
    low_12m = min(avgs_3m[-12:]) if len(avgs_3m) >= 12 else min(avgs_3m)
    sahm = current_3m - low_12m
    # 前月Sahm計算（2ヶ月連続条件用）
    prev_sahm = None
    if len(avgs_3m) >= 2:
        prev_low = min(avgs_3m[-13:-1]) if len(avgs_3m) >= 13 else min(avgs_3m[:-1])
        prev_sahm = avgs_3m[-2] - prev_low
    if sahm >= 1.0: return 15
    if sahm >= 0.5:
        return 15 if (prev_sahm is not None and prev_sahm >= 0.5) else 10
    if sahm >= 0.3: return 8
    if sahm >= 0.15: return 4
    return 0


def _simplified_claims_score(claims_4w_avg: float | None) -> int:
    """失業保険簡易スコア (2点満点): 週次ショック検知専用"""
    if claims_4w_avg is None:
        return 0
    if claims_4w_avg >= 300000: return 2
    if claims_4w_avg >= 250000: return 1
    return 0


def _simplified_sentiment_score(current: float | None, year_ago: float | None) -> int:
    """消費者信頼感スコア (5点): YoY方向性"""
    if current is None or year_ago is None or year_ago == 0: return 0
    yoy = ((current - year_ago) / abs(year_ago)) * 100
    if yoy <= -15: return 5
    if yoy <= -10: return 3
    if yoy <= -5: return 1
    return 0


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
    """求人倍率スコア (10点)"""
    if not jolts_val or not unemploy_val or unemploy_val == 0: return 0
    ratio = jolts_val / unemploy_val
    if ratio >= 1.2: return 0
    if ratio >= 1.0: return 3
    if ratio >= 0.8: return 7
    return 10


def _simplified_u6u3_score(u3: float | None, u6: float | None) -> int:
    """U6-U3スプレッドスコア (7点)"""
    if u3 is None or u6 is None: return 0
    spread = u6 - u3
    if spread >= 5.0: return 7
    if spread >= 4.5: return 4
    if spread >= 4.0: return 2
    return 0


def _simplified_lfpr_score(current_lfpr: float | None, year_ago_lfpr: float | None) -> int:
    """労働参加率スコア (5点): YoY方向性"""
    if current_lfpr is None or year_ago_lfpr is None: return 0
    yoy_change = current_lfpr - year_ago_lfpr  # pp
    if yoy_change <= -0.5: return 5
    if yoy_change <= -0.3: return 3
    if yoy_change <= -0.2: return 1
    return 0


def _simplified_k_shape_score(ratio: float | None) -> int:
    """K字型Proxyスコア (3点): RUT/SPX比率の絶対水準"""
    if ratio is None:
        return 0
    if ratio < 0.40: return 3
    if ratio < 0.45: return 2
    if ratio < 0.50: return 1
    return 0


@router.get("/risk-history")
async def get_risk_history(months: int = Query(120, description="取得月数")):
    """
    月次リスクスコア履歴を動的計算。
    各月について雇用(50)+消費(25)+構造(25)=100点のスコアを算出。
    未実装項目(K字型3点, インフレ乖離5点)は除外按分で100点正規化。

    最適化: Phase2(ページネ除去) + Phase3(並列実行) + Phase4(1hキャッシュ)
    """
    # キャッシュチェック（L1 インメモリ → L2 Redis）
    cache_key = f"employment:risk_history:{months}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        loop = asyncio.get_event_loop()

        # Phase 2: 日付フィルタで取得行数を削減 (ページネーション除去)
        start_date = (now - timedelta(days=months * 31 + 365)).strftime("%Y-%m-%d")

        def fetch_nfp():
            return supabase.table("economic_indicators") \
                .select("*").eq("indicator", "NFP") \
                .order("reference_period", desc=True).limit(months + 24).execute()

        def fetch_claims():
            """Phase 2-1: 日付フィルタで1回取得 (ページネーション除去)"""
            return supabase.table("weekly_claims") \
                .select("week_ending,initial_claims,initial_claims_4w_avg") \
                .gte("week_ending", start_date) \
                .order("week_ending", desc=False).limit(1000).execute()

        def fetch_consumer():
            """Phase 2-2: 日付フィルタで1回取得 (ページネーション除去)"""
            return supabase.table("economic_indicators") \
                .select("indicator,reference_period,current_value") \
                .in_("indicator", ["W875RX1", "UMCSENT", "DRCCLACBS", "UNEMPLOY", "JOLTS"]) \
                .gte("reference_period", start_date) \
                .order("reference_period", desc=False).limit(1000).execute()

        def fetch_market():
            """Phase 2-3: S&P500は日次→ページネーションで全行取得"""
            all_rows = []
            page_size = 1000
            offset = 0
            while True:
                result = supabase.table("market_indicators") \
                    .select("date,sp500,russell2000") \
                    .gte("date", start_date) \
                    .order("date", desc=False) \
                    .range(offset, offset + page_size - 1).execute()
                rows = result.data or []
                all_rows.extend(rows)
                if len(rows) < page_size:
                    break
                offset += page_size
            return type('R', (), {'data': all_rows})()

        # Phase 3: 4クエリを並列実行
        nfp_fut = loop.run_in_executor(_executor, fetch_nfp)
        claims_fut = loop.run_in_executor(_executor, fetch_claims)
        consumer_fut = loop.run_in_executor(_executor, fetch_consumer)
        market_fut = loop.run_in_executor(_executor, fetch_market)

        nfp_result, claims_result, consumer_result, market_result = await asyncio.gather(
            nfp_fut, claims_fut, consumer_fut, market_fut
        )

        nfp_rows = list(reversed(nfp_result.data or []))
        claims_rows = claims_result.data or []
        consumer_rows = consumer_result.data or []
        sp500_rows = market_result.data or []

        # ===== データをインデックス化 =====
        nfp_by_month: dict[str, list[dict]] = {}
        for row in nfp_rows:
            key = row["reference_period"][:7]
            nfp_by_month.setdefault(key, []).append(row)

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
        rut_spx_ratio_by_month: dict[str, float] = {}
        for row in sp500_rows:
            key = row["date"][:7]
            val = row.get("sp500")
            if val is not None:
                sp500_by_month[key] = val
            rut = row.get("russell2000")
            if val and rut and val > 0:
                rut_spx_ratio_by_month[key] = rut / val

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
            sent_s = _simplified_sentiment_score(umcsent_by_month.get(month_key), umcsent_by_month.get(prev_yr_key))
            income_s = _simplified_income_score(w875_by_month.get(month_key), w875_by_month.get(prev_yr_key))
            drc_s = _simplified_delinquency_score(drc_by_month.get(month_key), drc_by_month.get(prev_yr_key))
            infl_disc_s = _simplified_inflation_disc_score()
            consumer = min(sent_s + income_s + drc_s + infl_disc_s, 25)

            # Structure (25)
            job_s = _simplified_job_ratio_score(jolts_by_month.get(month_key), unemploy_by_month.get(month_key))
            u6u3_s = _simplified_u6u3_score(u3, latest_nfp.get("u6_rate"))
            current_lfpr = latest_nfp.get("labor_force_participation")
            year_ago_lfpr = None
            if idx >= 12:
                prev_yr_month = all_months[idx - 12]
                prev_yr_nfp = nfp_by_month.get(prev_yr_month, [])
                if prev_yr_nfp:
                    year_ago_lfpr = prev_yr_nfp[-1].get("labor_force_participation")
            lfpr_s = _simplified_lfpr_score(current_lfpr, year_ago_lfpr)
            current_ratio = rut_spx_ratio_by_month.get(month_key)
            k_shape_s = _simplified_k_shape_score(current_ratio)
            structure = min(job_s + u6u3_s + lfpr_s + k_shape_s, 25)

            raw_total = employment + consumer + structure

            k_inactive = 3 if current_ratio is None else 0
            active_max = 100 - k_inactive - 5
            total = min(round(raw_total / active_max * 100), 100) if active_max > 0 else raw_total

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

        result = {"history": history, "sp500": sp500_list}

        # キャッシュ保存 (1時間TTL)
        _cache_set(cache_key, result, ttl=_RISK_HISTORY_TTL)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
