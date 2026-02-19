"""
/api/liquidity - 配管タブデータ
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date
import main

router = APIRouter()


class FedBalanceSheet(BaseModel):
    """FRBバランスシート"""
    date: date
    reserves: Optional[float]
    rrp: Optional[float]
    tga: Optional[float]
    soma_assets: Optional[float]


class InterestRates(BaseModel):
    """金利データ"""
    date: date
    fed_funds: Optional[float]
    treasury_2y: Optional[float]
    treasury_10y: Optional[float]
    treasury_spread: Optional[float]


class CreditSpreads(BaseModel):
    """クレジットスプレッド"""
    date: date
    hy_spread: Optional[float]
    ig_spread: Optional[float]
    ted_spread: Optional[float]


class MarketIndicators(BaseModel):
    """市場指標"""
    date: date
    vix: Optional[float]
    dxy: Optional[float]
    sp500: Optional[float]
    nasdaq: Optional[float]


class LiquidityOverview(BaseModel):
    """流動性概要"""
    fed_balance_sheet: Optional[FedBalanceSheet]
    interest_rates: Optional[InterestRates]
    credit_spreads: Optional[CreditSpreads]
    market_indicators: Optional[MarketIndicators]

    # ストレス判定
    liquidity_stress: str  # Low, Medium, High
    stress_factors: list[str]


@router.get("/overview", response_model=LiquidityOverview)
async def get_liquidity_overview():
    """
    配管タブ：流動性概要（最新データ）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 各テーブルの最新データを取得
        fed = supabase.table("fed_balance_sheet").select("*").order("date", desc=True).limit(1).execute()
        rates = supabase.table("interest_rates").select("*").order("date", desc=True).limit(1).execute()
        spreads = supabase.table("credit_spreads").select("*").order("date", desc=True).limit(1).execute()
        indicators = supabase.table("market_indicators").select("*").order("date", desc=True).limit(1).execute()

        fed_data = FedBalanceSheet(**fed.data[0]) if fed.data else None
        rates_data = InterestRates(**rates.data[0]) if rates.data else None
        spreads_data = CreditSpreads(**spreads.data[0]) if spreads.data else None
        indicators_data = MarketIndicators(**indicators.data[0]) if indicators.data else None

        # ストレス判定
        stress_factors = []
        stress_level = 0

        if indicators_data and indicators_data.vix:
            if indicators_data.vix > 30:
                stress_factors.append(f"VIX高水準: {indicators_data.vix}")
                stress_level += 2
            elif indicators_data.vix > 20:
                stress_factors.append(f"VIX警戒水準: {indicators_data.vix}")
                stress_level += 1

        if spreads_data and spreads_data.hy_spread:
            if spreads_data.hy_spread > 5:
                stress_factors.append(f"HYスプレッド拡大: {spreads_data.hy_spread}%")
                stress_level += 2
            elif spreads_data.hy_spread > 4:
                stress_factors.append(f"HYスプレッド警戒: {spreads_data.hy_spread}%")
                stress_level += 1

        if rates_data and rates_data.treasury_spread:
            if rates_data.treasury_spread < 0:
                stress_factors.append(f"イールドカーブ逆転: {rates_data.treasury_spread}%")
                stress_level += 2

        # ストレスレベル判定
        if stress_level >= 4:
            liquidity_stress = "High"
        elif stress_level >= 2:
            liquidity_stress = "Medium"
        else:
            liquidity_stress = "Low"

        return LiquidityOverview(
            fed_balance_sheet=fed_data,
            interest_rates=rates_data,
            credit_spreads=spreads_data,
            market_indicators=indicators_data,
            liquidity_stress=liquidity_stress,
            stress_factors=stress_factors,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fed-balance-sheet")
async def get_fed_balance_sheet(
    limit: int = Query(30, description="取得件数"),
):
    """FRBバランスシート履歴"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("fed_balance_sheet").select("*").order("date", desc=True).limit(limit).execute()
        return {"data": result.data, "count": len(result.data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/interest-rates")
async def get_interest_rates(
    limit: int = Query(30, description="取得件数"),
):
    """金利履歴"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("interest_rates").select("*").order("date", desc=True).limit(limit).execute()
        return {"data": result.data, "count": len(result.data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/credit-spreads")
async def get_credit_spreads(
    limit: int = Query(30, description="取得件数"),
):
    """クレジットスプレッド履歴"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("credit_spreads").select("*").order("date", desc=True).limit(limit).execute()
        return {"data": result.data, "count": len(result.data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/market-indicators")
async def get_market_indicators(
    limit: int = Query(30, description="取得件数"),
):
    """市場指標履歴"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("market_indicators").select("*").order("date", desc=True).limit(limit).execute()
        return {"data": result.data, "count": len(result.data)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
