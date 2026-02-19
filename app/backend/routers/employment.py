"""
/api/employment - 景気警戒タブデータ
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date
import main

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
