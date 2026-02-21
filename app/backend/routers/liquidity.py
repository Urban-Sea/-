"""
/api/liquidity - 配管タブデータ
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
import main

from analysis.liquidity_score import (
    calculate_layer1_stress,
    calculate_layer2a_stress,
    calculate_layer2b_stress,
    calculate_credit_pressure,
    determine_market_state,
)

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


@router.get("/plumbing-summary")
async def get_plumbing_summary():
    """
    配管タブ：全Layer統合サマリー（demoから移植）

    Layer 1: 政策流動性（Net Liquidity Z-score）
    Layer 2A: 銀行システム（準備預金、KRE、SRF、IGスプレッド）
    Layer 2B: リスク許容度（信用取引残高2年変化率、MMF）
    Credit Pressure: 信用圧力センサー（HY、IG、イールドカーブ、DXY）
    Market State: 統合市場状態判定
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = {
            "timestamp": datetime.now().isoformat(),
            "layers": {"layer1": None, "layer2a": None, "layer2b": None},
            "credit_pressure": None,
            "market_state": None,
            "market_indicators": None,
        }

        # ============================================================
        # データ取得
        # ============================================================

        # FRB Balance Sheet（Net Liquidity計算用 - 履歴含む）
        fed_all = supabase.table("fed_balance_sheet") \
            .select("date,reserves,rrp,tga,soma_assets") \
            .order("date", desc=False) \
            .execute()
        fed_latest_q = supabase.table("fed_balance_sheet") \
            .select("*") \
            .order("date", desc=True) \
            .limit(2) \
            .execute()

        # Market Indicators（最新）
        indicators_q = supabase.table("market_indicators") \
            .select("*") \
            .order("date", desc=True) \
            .limit(1) \
            .execute()
        if indicators_q.data:
            result["market_indicators"] = indicators_q.data[0]

        # Bank Sector（KRE）
        kre_q = supabase.table("bank_sector") \
            .select("date,kre_52w_change") \
            .order("date", desc=True) \
            .limit(1) \
            .execute()

        # SRF Usage（過去90日）
        srf_q = supabase.table("srf_usage") \
            .select("date,amount") \
            .order("date", desc=True) \
            .limit(90) \
            .execute()

        # Credit Spreads（最新）
        spreads_q = supabase.table("credit_spreads") \
            .select("*") \
            .order("date", desc=True) \
            .limit(1) \
            .execute()

        # Interest Rates（最新）
        rates_q = supabase.table("interest_rates") \
            .select("*") \
            .order("date", desc=True) \
            .limit(1) \
            .execute()

        # Margin Debt
        margin_q = supabase.table("margin_debt") \
            .select("date,debit_balance,change_2y") \
            .order("date", desc=True) \
            .limit(1) \
            .execute()

        # Margin Debt 1年前（1年変化率計算用）
        margin_1y_q = None
        if margin_q.data:
            latest_margin_date = margin_q.data[0]['date']
            margin_1y_q = supabase.table("margin_debt") \
                .select("debit_balance") \
                .lte("date", latest_margin_date.replace(latest_margin_date[:4], str(int(latest_margin_date[:4]) - 1)) if isinstance(latest_margin_date, str) else latest_margin_date) \
                .order("date", desc=True) \
                .limit(1) \
                .execute()

        # MMF Assets
        mmf_q = supabase.table("mmf_assets") \
            .select("date,total_assets,change_3m") \
            .order("date", desc=True) \
            .limit(1) \
            .execute()

        # ============================================================
        # Layer 1: 政策流動性（Net Liquidity Z-score）
        # ============================================================
        if fed_all.data:
            # Net Liquidity履歴を構築
            historical_values = []
            for row in fed_all.data:
                soma = row.get('soma_assets')
                rrp = row.get('rrp')
                tga = row.get('tga')
                if soma is not None and rrp is not None and tga is not None:
                    historical_values.append(soma - rrp - tga)

            if historical_values:
                current_net_liq = historical_values[-1]
                layer1 = calculate_layer1_stress(current_net_liq, historical_values)

                # FRBデータの詳細を追加
                if fed_latest_q.data:
                    latest_fed = fed_latest_q.data[0]
                    layer1['fed_data'] = {
                        'date': latest_fed.get('date'),
                        'soma_assets': latest_fed.get('soma_assets'),
                        'reserves': latest_fed.get('reserves'),
                        'rrp': latest_fed.get('rrp'),
                        'tga': latest_fed.get('tga'),
                    }

                result["layers"]["layer1"] = layer1

        # ============================================================
        # Layer 2A: 銀行システム
        # ============================================================
        # 準備預金変化率
        reserves_change_mom = None
        reserves_value = None
        if fed_latest_q.data and len(fed_latest_q.data) >= 2:
            current = fed_latest_q.data[0].get('reserves')
            previous = fed_latest_q.data[1].get('reserves')
            reserves_value = current
            if current and previous and previous != 0:
                reserves_change_mom = ((current - previous) / previous) * 100

        # KRE
        kre_52w_change = None
        if kre_q.data:
            kre_52w_change = kre_q.data[0].get('kre_52w_change')

        # SRF集計
        srf_usage_30d = 0
        srf_days_30d = 0
        srf_days_90d = 0
        if srf_q.data:
            from datetime import timedelta
            now = datetime.now().date()
            for row in srf_q.data:
                amount = row.get('amount', 0) or 0
                try:
                    row_date = datetime.strptime(row['date'], '%Y-%m-%d').date() if isinstance(row['date'], str) else row['date']
                    if (now - row_date).days <= 30:
                        srf_usage_30d += amount
                        if amount > 0:
                            srf_days_30d += 1
                    if amount > 0:
                        srf_days_90d += 1
                except (ValueError, TypeError):
                    pass

        # IGスプレッド
        ig_spread = None
        if spreads_q.data:
            ig_spread = spreads_q.data[0].get('ig_spread')

        layer2a = calculate_layer2a_stress(
            reserves_change_mom=reserves_change_mom,
            kre_52w_change=kre_52w_change,
            srf_usage=srf_usage_30d,
            ig_spread=ig_spread,
            srf_consecutive_days=srf_days_30d,
            srf_days_90d=srf_days_90d,
        )
        # コンポーネントに追加データ
        layer2a['components']['reserves_value'] = reserves_value
        result["layers"]["layer2a"] = layer2a

        # ============================================================
        # Layer 2B: リスク許容度（信用取引残高）
        # ============================================================
        if margin_q.data:
            margin_data = margin_q.data[0]
            change_2y = margin_data.get('change_2y')

            # 1年変化率計算
            change_1y = None
            if margin_1y_q and margin_1y_q.data:
                prev_balance = margin_1y_q.data[0].get('debit_balance')
                current_balance = margin_data.get('debit_balance')
                if prev_balance and current_balance and prev_balance != 0:
                    change_1y = ((current_balance - prev_balance) / prev_balance) * 100

            # MMFデータ
            mmf_change = None
            if mmf_q.data:
                mmf_change = mmf_q.data[0].get('change_3m')

            # VIX
            vix = None
            if indicators_q.data:
                vix = indicators_q.data[0].get('vix')

            if change_2y is not None:
                layer2b = calculate_layer2b_stress(
                    margin_debt_2y=change_2y,
                    margin_debt_1y=change_1y,
                    mmf_change=mmf_change,
                    vix=vix,
                )
                layer2b['data_date'] = margin_data.get('date')
                result["layers"]["layer2b"] = layer2b

        # ============================================================
        # Credit Pressure（信用圧力センサー）
        # ============================================================
        hy_spread = None
        yield_curve = None
        dxy = None

        if spreads_q.data:
            hy_spread = spreads_q.data[0].get('hy_spread')
        if rates_q.data:
            yield_curve = rates_q.data[0].get('treasury_spread')
        if indicators_q.data:
            dxy = indicators_q.data[0].get('dxy')

        credit = calculate_credit_pressure(
            hy_spread=hy_spread,
            ig_spread=ig_spread,
            yield_curve=yield_curve,
            dxy=dxy,
        )
        result["credit_pressure"] = credit

        # ============================================================
        # Market State（統合状態判定）
        # ============================================================
        l1 = result["layers"]["layer1"]
        l2a = result["layers"]["layer2a"]
        l2b = result["layers"]["layer2b"]

        if l1 and l2a and l2b:
            market_state = determine_market_state(
                layer1_stress=l1['stress_score'],
                layer2a_stress=l2a['stress_score'],
                layer2b_stress=l2b['stress_score'],
                l2a_interpretation_type=l2a.get('interpretation_type'),
            )
            result["market_state"] = market_state

        # Interest Rates（フロントエンド表示用）
        if rates_q.data:
            result["interest_rates"] = rates_q.data[0]
        if spreads_q.data:
            result["credit_spreads"] = spreads_q.data[0]

        return result

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
