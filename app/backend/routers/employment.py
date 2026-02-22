"""
/api/employment - 景気警戒タブデータ
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
import main
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
# リスクスコア計算（100点満点・5フェーズ）
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


PHASES = [
    {"code": "EXPANSION", "label": "拡大期", "color": "green", "position_limit": 100,
     "description": "雇用市場は力強く拡大中。過熱リスクに注意しつつ積極的に投資可能。",
     "action": "フルポジション可。過熱警戒しながら利確・回転を意識"},
    {"code": "SLOWDOWN", "label": "減速期", "color": "cyan", "position_limit": 80,
     "description": "拡大ペースが鈍化。まだ健全だが変化の兆候を注視。",
     "action": "慎重に新規投資OK。ポジション上限80%"},
    {"code": "CAUTION", "label": "警戒期", "color": "yellow", "position_limit": 70,
     "description": "複数の指標が悪化傾向。景気後退リスクが高まっている。",
     "action": "現物のみ。新規ポジション抑制。ポジション上限70%"},
    {"code": "CONTRACTION", "label": "収縮期", "color": "orange", "position_limit": 40,
     "description": "景気後退入りの可能性が高い。信用取引禁止。",
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


def _calc_nfp_trend_score(nfp_data: list[dict]) -> RiskSubScore:
    """NFPトレンド (25点): 直近3ヶ月のNFP変化平均"""
    changes = []
    for d in nfp_data[:6]:
        if d.get("nfp_change") is not None:
            changes.append(d["nfp_change"])
    if len(changes) < 3:
        avg = changes[0] if changes else 0
    else:
        avg = statistics.mean(changes[:3])

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
        name="NFPトレンド",
        score=score, max_score=25,
        detail=f"3ヶ月平均: {avg:+.0f}K" if changes else "データなし",
        status=status,
    )


def _calc_sahm_rule(nfp_data: list[dict]) -> tuple[RiskSubScore, SahmRuleData]:
    """サームルール (20点): U3 3ヶ月平均 − 12ヶ月最小の3ヶ月平均"""
    u3_values = []
    for d in sorted(nfp_data, key=lambda x: x.get("reference_period", "")):
        if d.get("u3_rate") is not None:
            u3_values.append(d["u3_rate"])

    if len(u3_values) < 3:
        return (
            RiskSubScore(name="サームルール", score=0, max_score=20, detail="データ不足", status="normal"),
            SahmRuleData(current_u3=u3_values[-1] if u3_values else None,
                         u3_3m_avg=None, u3_12m_low_3m_avg=None, sahm_value=None, triggered=False),
        )

    # 3ヶ月移動平均のリストを計算
    avgs_3m = []
    for i in range(2, len(u3_values)):
        avgs_3m.append(statistics.mean(u3_values[i-2:i+1]))

    current_3m_avg = avgs_3m[-1]
    low_12m_3m_avg = min(avgs_3m[-12:]) if len(avgs_3m) >= 12 else min(avgs_3m)
    sahm_value = round(current_3m_avg - low_12m_3m_avg, 2)
    triggered = sahm_value >= 0.5

    if sahm_value >= 0.5:
        score = 20
    elif sahm_value >= 0.3:
        score = 12
    elif sahm_value >= 0.1:
        score = 5
    else:
        score = 0

    status = "danger" if triggered else "warning" if score >= 5 else "normal"

    return (
        RiskSubScore(
            name="サームルール",
            score=score, max_score=20,
            detail=f"Sahm値: {sahm_value:.2f}" + (" (発動)" if triggered else ""),
            status=status,
        ),
        SahmRuleData(
            current_u3=round(u3_values[-1], 1),
            u3_3m_avg=round(current_3m_avg, 2),
            u3_12m_low_3m_avg=round(low_12m_3m_avg, 2),
            sahm_value=sahm_value,
            triggered=triggered,
        ),
    )


def _calc_claims_trend(claims_data: list[dict]) -> RiskSubScore:
    """失業保険トレンド (10点): 4W avg vs 12W avg"""
    avgs = []
    for d in claims_data[:12]:
        v = d.get("initial_claims_4w_avg") or d.get("initial_claims")
        if v is not None:
            avgs.append(v)

    if len(avgs) < 2:
        return RiskSubScore(name="失業保険トレンド", score=0, max_score=10, detail="データ不足", status="normal")

    recent = statistics.mean(avgs[:4]) if len(avgs) >= 4 else avgs[0]
    older = statistics.mean(avgs) if avgs else recent

    if older == 0:
        pct_change = 0
    else:
        pct_change = ((recent - older) / older) * 100

    if pct_change > 10:
        score = 10
    elif pct_change > 5:
        score = 6
    elif pct_change > 0:
        score = 3
    else:
        score = 0

    status = "danger" if score >= 10 else "warning" if score >= 3 else "normal"
    return RiskSubScore(
        name="失業保険トレンド",
        score=score, max_score=10,
        detail=f"4W/12W変化: {pct_change:+.1f}%",
        status=status,
    )


def _calc_wage_pressure(nfp_data: list[dict]) -> RiskSubScore:
    """賃金圧力 (10点)"""
    latest = nfp_data[0] if nfp_data else {}
    wage_mom = latest.get("wage_mom")

    if wage_mom is None:
        return RiskSubScore(name="賃金圧力", score=0, max_score=10, detail="データなし", status="normal")

    if wage_mom < 0:
        score = 5
        detail = f"賃金下落: {wage_mom:+.2f}% MoM"
        status = "warning"
    elif wage_mom > 0.5:
        score = 3
        detail = f"賃金過熱: {wage_mom:+.2f}% MoM"
        status = "warning"
    else:
        score = 0
        detail = f"賃金安定: {wage_mom:+.2f}% MoM"
        status = "normal"

    return RiskSubScore(name="賃金圧力", score=score, max_score=10, detail=detail, status=status)


def _calc_u6_u3_spread(nfp_data: list[dict]) -> RiskSubScore:
    """U6-U3スプレッド (15点)"""
    latest = nfp_data[0] if nfp_data else {}
    u3 = latest.get("u3_rate")
    u6 = latest.get("u6_rate")

    if u3 is None or u6 is None:
        return RiskSubScore(name="U6-U3スプレッド", score=0, max_score=15, detail="データなし", status="normal")

    spread = u6 - u3

    if spread > 4.0:
        score = 15
    elif spread > 3.5:
        score = 10
    elif spread > 3.0:
        score = 5
    else:
        score = 0

    status = "danger" if score >= 15 else "warning" if score >= 5 else "normal"
    return RiskSubScore(
        name="U6-U3スプレッド",
        score=score, max_score=15,
        detail=f"スプレッド: {spread:.1f}% (U6={u6:.1f}% − U3={u3:.1f}%)",
        status=status,
    )


def _calc_labor_participation(nfp_data: list[dict]) -> RiskSubScore:
    """労働参加率 (10点)"""
    latest = nfp_data[0] if nfp_data else {}
    lfpr = latest.get("labor_force_participation")

    if lfpr is None:
        return RiskSubScore(name="労働参加率", score=0, max_score=10, detail="データなし", status="normal")

    if lfpr < 62.0:
        score = 10
    elif lfpr < 62.5:
        score = 6
    elif lfpr < 63.0:
        score = 3
    else:
        score = 0

    status = "danger" if score >= 10 else "warning" if score >= 3 else "normal"
    return RiskSubScore(
        name="労働参加率",
        score=score, max_score=10,
        detail=f"{lfpr:.1f}%",
        status=status,
    )


def _calc_revision_pattern(supabase, nfp_data: list[dict]) -> RiskSubScore:
    """NFP修正パターン (10点): 直近3ヶ月の修正方向"""
    recent_ids = [d["id"] for d in nfp_data[:3] if d.get("id")]
    if not recent_ids:
        return RiskSubScore(name="NFP修正パターン", score=0, max_score=10, detail="データなし", status="normal")

    down_count = 0
    up_count = 0
    total_checked = 0

    for ind_id in recent_ids:
        revs = supabase.table("economic_indicator_revisions") \
            .select("change_from_prev") \
            .eq("indicator_id", ind_id) \
            .order("revision_number", desc=True) \
            .limit(1).execute()

        if revs.data and revs.data[0].get("change_from_prev") is not None:
            total_checked += 1
            if revs.data[0]["change_from_prev"] < 0:
                down_count += 1
            elif revs.data[0]["change_from_prev"] > 0:
                up_count += 1

    if total_checked == 0:
        return RiskSubScore(name="NFP修正パターン", score=0, max_score=10, detail="修正履歴なし", status="normal")

    if down_count >= 2:
        score = 10
        detail = f"直近{total_checked}ヶ月中{down_count}回下方修正"
        status = "danger"
    elif down_count >= 1:
        score = 5
        detail = f"直近{total_checked}ヶ月中{down_count}回下方修正"
        status = "warning"
    else:
        score = 0
        detail = f"修正パターン良好 ({up_count}回上方修正)"
        status = "normal"

    return RiskSubScore(name="NFP修正パターン", score=score, max_score=10, detail=detail, status=status)


@router.get("/risk-score")
async def get_risk_score():
    """
    景気警戒タブ：100点満点のリセッションリスクスコア
    雇用(65点) + 構造(35点) → 5フェーズ分類
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

        # ===== 雇用カテゴリ (65点) =====
        nfp_trend = _calc_nfp_trend_score(nfp_data)
        sahm_sub, sahm_data = _calc_sahm_rule(nfp_data)
        claims_trend = _calc_claims_trend(claims_data)
        wage_pressure = _calc_wage_pressure(nfp_data)

        employment_score = nfp_trend.score + sahm_sub.score + claims_trend.score + wage_pressure.score
        employment_cat = RiskScoreCategory(
            name="雇用",
            score=employment_score,
            max_score=65,
            components=[nfp_trend, sahm_sub, claims_trend, wage_pressure],
        )

        # ===== 構造カテゴリ (35点) =====
        u6u3 = _calc_u6_u3_spread(nfp_data)
        lfpr = _calc_labor_participation(nfp_data)
        revision = _calc_revision_pattern(supabase, nfp_data)

        structure_score = u6u3.score + lfpr.score + revision.score
        structure_cat = RiskScoreCategory(
            name="構造",
            score=structure_score,
            max_score=35,
            components=[u6u3, lfpr, revision],
        )

        # ===== 総合スコア =====
        total_score = employment_score + structure_score

        # サームルール発動時: スコアを最低60に引き上げ
        if sahm_data.triggered and total_score < 60:
            total_score = 60

        total_score = min(total_score, 100)

        # ===== アラート生成 =====
        alert_factors = []
        for cat in [employment_cat, structure_cat]:
            for comp in cat.components:
                if comp.status == "danger":
                    alert_factors.append(f"{comp.name}: {comp.detail}")
                elif comp.status == "warning":
                    alert_factors.append(f"{comp.name}: {comp.detail}")
        if sahm_data.triggered:
            alert_factors.insert(0, f"サームルール発動: Sahm値 {sahm_data.sahm_value:.2f} ≥ 0.50")

        # ===== レスポンス =====
        return EmploymentRiskScore(
            total_score=total_score,
            phase=_get_phase(total_score),
            categories=[employment_cat, structure_cat],
            sahm_rule=sahm_data,
            alert_factors=alert_factors,
            timestamp=datetime.now().isoformat(),
            latest_nfp=nfp_data[0] if nfp_data else None,
            latest_claims=claims_data[0] if claims_data else None,
            nfp_history=nfp_data,
            claims_history=claims_data,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
