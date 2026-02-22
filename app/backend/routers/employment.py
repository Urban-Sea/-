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

    status = "danger" if triggered else "warning" if score >= 4 else "normal"
    return (
        RiskSubScore(
            name="サームルール", score=score, max_score=15,
            detail=f"Sahm値: {sahm_value:.2f}" + (" (発動)" if triggered else ""),
            status=status,
        ),
        SahmRuleData(
            current_u3=round(u3_values[-1], 1),
            u3_3m_avg=round(current_3m_avg, 2),
            u3_12m_low_3m_avg=round(low_12m_3m_avg, 2),
            sahm_value=sahm_value, triggered=triggered,
        ),
    )


def _calc_claims_level(claims_data: list[dict]) -> RiskSubScore:
    """失業保険水準 (5点): 4W平均の絶対水準"""
    avgs = [d.get("initial_claims_4w_avg") or d.get("initial_claims")
            for d in claims_data[:4]]
    avgs = [v for v in avgs if v is not None]

    if not avgs:
        return RiskSubScore(name="失業保険", score=0, max_score=5, detail="データ不足", status="normal")

    level = avgs[0]  # 最新の4W avg

    if level >= 300000:
        score = 5
    elif level >= 250000:
        score = 3
    elif level >= 220000:
        score = 1
    else:
        score = 0

    status = "danger" if score >= 5 else "warning" if score >= 1 else "normal"
    return RiskSubScore(
        name="失業保険", score=score, max_score=5,
        detail=f"4W平均: {level/1000:.0f}K",
        status=status,
    )


def _calc_employment_discrepancy(supabase, nfp_data: list[dict]) -> RiskSubScore:
    """雇用矛盾 (5点): NFP修正パターンによる信頼性評価"""
    recent_ids = [d["id"] for d in nfp_data[:3] if d.get("id")]
    if not recent_ids:
        return RiskSubScore(name="雇用矛盾", score=0, max_score=5, detail="データなし", status="normal")

    down_count = 0
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

    if total_checked == 0:
        return RiskSubScore(name="雇用矛盾", score=0, max_score=5, detail="修正履歴なし", status="normal")

    if down_count >= 2:
        score, status = 5, "danger"
        detail = f"直近{total_checked}ヶ月中{down_count}回下方修正"
    elif down_count >= 1:
        score, status = 2, "warning"
        detail = f"直近{total_checked}ヶ月中{down_count}回下方修正"
    else:
        score, status = 0, "normal"
        detail = "修正パターン良好"

    return RiskSubScore(name="雇用矛盾", score=score, max_score=5, detail=detail, status=status)


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


def _calc_wage_pressure(nfp_data: list[dict]) -> RiskSubScore:
    """賃金圧力 (5点)"""
    latest = nfp_data[0] if nfp_data else {}
    wage_mom = latest.get("wage_mom")

    if wage_mom is None:
        return RiskSubScore(name="賃金圧力", score=0, max_score=5, detail="データなし", status="normal")

    if wage_mom < 0:
        score, detail, status = 3, f"賃金下落: {wage_mom:+.2f}% MoM", "warning"
    elif wage_mom > 0.5:
        score, detail, status = 2, f"賃金過熱: {wage_mom:+.2f}% MoM", "warning"
    else:
        score, detail, status = 0, f"賃金安定: {wage_mom:+.2f}% MoM", "normal"

    return RiskSubScore(name="賃金圧力", score=score, max_score=5, detail=detail, status=status)


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
    """労働参加率 (5点)"""
    latest = nfp_data[0] if nfp_data else {}
    lfpr = latest.get("labor_force_participation")

    if lfpr is None:
        return RiskSubScore(name="労働参加率", score=0, max_score=5, detail="データなし", status="normal")

    if lfpr < 62.0:
        score = 5
    elif lfpr < 62.5:
        score = 3
    elif lfpr < 63.0:
        score = 1
    else:
        score = 0

    status = "danger" if score >= 5 else "warning" if score >= 1 else "normal"
    return RiskSubScore(name="労働参加率", score=score, max_score=5, detail=f"{lfpr:.1f}%", status=status)


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

        # 消費者・構造系列を一括取得
        consumer_indicators = ["W875RX1", "UMCSENT", "DRCCLACBS"]
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
        discrepancy = _calc_employment_discrepancy(supabase, nfp_data)

        employment_score = nfp_trend.score + sahm_sub.score + claims.score + discrepancy.score
        employment_cat = RiskScoreCategory(
            name="雇用", score=employment_score, max_score=50,
            components=[nfp_trend, sahm_sub, claims, discrepancy],
        )

        # ===== 消費カテゴリ (25点) =====
        real_income = _calc_real_income(consumer_data)
        sentiment = _calc_consumer_sentiment(consumer_data)
        delinquency = _calc_credit_delinquency(consumer_data)
        wage = _calc_wage_pressure(nfp_data)

        consumer_score = real_income.score + sentiment.score + delinquency.score + wage.score
        consumer_cat = RiskScoreCategory(
            name="消費", score=consumer_score, max_score=25,
            components=[real_income, sentiment, delinquency, wage],
        )

        # ===== 構造カテゴリ (25点) =====
        job_ratio = _calc_job_openings_ratio(jolts_data, unemploy_data)
        u6u3 = _calc_u6_u3_spread(nfp_data)
        lfpr = _calc_labor_participation(nfp_data)

        structure_score = job_ratio.score + u6u3.score + lfpr.score
        structure_cat = RiskScoreCategory(
            name="構造", score=structure_score, max_score=25,
            components=[job_ratio, u6u3, lfpr],
        )

        # ===== 総合スコア =====
        total_score = employment_score + consumer_score + structure_score

        # サームルール発動時: スコアを最低60に引き上げ
        if sahm_data.triggered and total_score < 60:
            total_score = 60

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
