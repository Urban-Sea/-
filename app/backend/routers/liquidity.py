"""
/api/liquidity - 配管タブデータ
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
import asyncio
import main

from analysis.liquidity_score import (
    calculate_layer1_stress,
    calculate_layer2a_stress,
    calculate_layer2b_stress,
    calculate_credit_pressure,
    determine_market_state,
    detect_market_events,
    events_to_dict,
    detect_policy_regime,
    policy_regime_to_dict,
    generate_fed_action_comment,
    rolling_zscore,
    MARKET_STATE_DEFINITIONS,
)

router = APIRouter()

# ============================================================
# 並列実行 + インメモリキャッシュ
# ============================================================
_executor = ThreadPoolExecutor(max_workers=8)
_plumbing_cache: dict = {"data": None, "expires": None}
_backtest_cache: dict = {}  # key: limit → {"data": ..., "expires": ...}
_events_cache: dict = {"data": None, "expires": None}
_policy_cache: dict = {"data": None, "expires": None}


# ============================================================
# ヘルパー: FRBデータのforward-fill
# fed_balance_sheetはRRP(日次)とSOMA/TGA/reserves(週次)が混在するため、
# 最新行でnullのフィールドを直近の非null値で補完する
# ============================================================

def _forward_fill_fed(rows: List[dict], fields: List[str]) -> dict:
    """rows は date DESC 順。各fieldについて最新の非null値を返す。"""
    if not rows:
        return {}
    result = dict(rows[0])
    for field in fields:
        if result.get(field) is None:
            for row in rows[1:]:
                if row.get(field) is not None:
                    result[field] = row[field]
                    break
    return result


def _find_nth_nonnull(rows: List[dict], field: str, n: int):
    """rows(date DESC)からfield!=Noneの行をn個目まで集め、値を返す。0-indexed."""
    found = []
    for row in rows:
        if row.get(field) is not None:
            found.append(row[field])
            if len(found) > n:
                return found[n]
    return None


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
        loop = asyncio.get_event_loop()

        # 4クエリ並列実行
        fed, rates, spreads, indicators = await asyncio.gather(
            loop.run_in_executor(_executor, lambda: supabase.table("fed_balance_sheet").select("*").order("date", desc=True).limit(1).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("interest_rates").select("*").order("date", desc=True).limit(1).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("credit_spreads").select("*").order("date", desc=True).limit(1).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("market_indicators").select("*").order("date", desc=True).limit(1).execute()),
        )

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

    最適化: 11クエリ並列実行 + 30分キャッシュ
    """
    # キャッシュチェック
    now = datetime.now()
    if _plumbing_cache["data"] and _plumbing_cache["expires"] and _plumbing_cache["expires"] > now:
        return _plumbing_cache["data"]

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

        loop = asyncio.get_event_loop()

        # ============================================================
        # データ取得（11クエリ並列実行）
        # ============================================================
        def q_fed_all():
            return supabase.table("fed_balance_sheet") \
                .select("date,reserves,rrp,tga,soma_assets") \
                .order("date", desc=False).execute()

        def q_fed_latest():
            return supabase.table("fed_balance_sheet") \
                .select("*").order("date", desc=True).limit(30).execute()

        def q_indicators():
            return supabase.table("market_indicators") \
                .select("*").order("date", desc=True).limit(1).execute()

        def q_kre():
            return supabase.table("bank_sector") \
                .select("date,kre_52w_change").order("date", desc=True).limit(1).execute()

        def q_srf():
            return supabase.table("srf_usage") \
                .select("date,amount").order("date", desc=True).limit(90).execute()

        def q_spreads():
            return supabase.table("credit_spreads") \
                .select("*").order("date", desc=True).limit(1).execute()

        def q_rates():
            return supabase.table("interest_rates") \
                .select("*").order("date", desc=True).limit(1).execute()

        def q_margin():
            return supabase.table("margin_debt") \
                .select("date,debit_balance,change_2y").order("date", desc=True).limit(2).execute()

        def q_mmf():
            return supabase.table("mmf_assets") \
                .select("date,total_assets,change_3m").order("date", desc=True).limit(1).execute()

        (fed_all, fed_latest_q, indicators_q, kre_q, srf_q,
         spreads_q, rates_q, margin_q, mmf_q) = await asyncio.gather(
            loop.run_in_executor(_executor, q_fed_all),
            loop.run_in_executor(_executor, q_fed_latest),
            loop.run_in_executor(_executor, q_indicators),
            loop.run_in_executor(_executor, q_kre),
            loop.run_in_executor(_executor, q_srf),
            loop.run_in_executor(_executor, q_spreads),
            loop.run_in_executor(_executor, q_rates),
            loop.run_in_executor(_executor, q_margin),
            loop.run_in_executor(_executor, q_mmf),
        )

        if indicators_q.data:
            result["market_indicators"] = indicators_q.data[0]

        # Margin Debt 1年前（margin_qから2行取得済み、または日付ベースで取得）
        margin_1y_q = None
        if margin_q.data:
            latest_margin_date = margin_q.data[0]['date']
            def q_margin_1y():
                return supabase.table("margin_debt") \
                    .select("debit_balance") \
                    .lte("date", latest_margin_date.replace(latest_margin_date[:4], str(int(latest_margin_date[:4]) - 1)) if isinstance(latest_margin_date, str) else latest_margin_date) \
                    .order("date", desc=True).limit(1).execute()
            margin_1y_q = await loop.run_in_executor(_executor, q_margin_1y)

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

                # FRBデータの詳細を追加（forward-fill: 各フィールドの最新非null値）
                if fed_latest_q.data:
                    filled_fed = _forward_fill_fed(
                        fed_latest_q.data,
                        ['soma_assets', 'reserves', 'rrp', 'tga']
                    )
                    layer1['fed_data'] = {
                        'date': fed_latest_q.data[0].get('date'),
                        'soma_assets': filled_fed.get('soma_assets'),
                        'reserves': filled_fed.get('reserves'),
                        'rrp': filled_fed.get('rrp'),
                        'tga': filled_fed.get('tga'),
                    }

                result["layers"]["layer1"] = layer1

        # ============================================================
        # Layer 2A: 銀行システム
        # ============================================================
        # 準備預金変化率
        reserves_change_mom = None
        reserves_value = None
        if fed_latest_q.data:
            # forward-fill: 最新2つの非null reserves値を使用
            current = _find_nth_nonnull(fed_latest_q.data, 'reserves', 0)
            previous = _find_nth_nonnull(fed_latest_q.data, 'reserves', 1)
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
            today = datetime.now().date()
            for row in srf_q.data:
                amount = row.get('amount', 0) or 0
                try:
                    row_date = datetime.strptime(row['date'], '%Y-%m-%d').date() if isinstance(row['date'], str) else row['date']
                    if (today - row_date).days <= 30:
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

        # キャッシュ保存 (30分TTL)
        _plumbing_cache["data"] = result
        _plumbing_cache["expires"] = now + timedelta(minutes=30)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class MarginDebtInput(BaseModel):
    """信用取引残高データ入力"""
    date: str  # "2026-01-01"
    debit_balance: float  # FINRA値（百万ドル単位）例: 1279042
    free_credit: Optional[float] = None


@router.post("/margin-debt")
async def upsert_margin_debt(data: MarginDebtInput):
    """
    信用取引残高をupsert。FINRA公表値（百万ドル単位）を受け取り、
    2年前データからchange_2yを自動計算して保存する。
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 実データはドル単位で保存（FINRA百万ドル × 1,000,000）
        debit_dollars = data.debit_balance * 1_000_000

        # 2年前のデータを取得してchange_2y計算
        two_years_ago = data.date[:4]
        two_years_ago = str(int(two_years_ago) - 2) + data.date[4:]
        prev_q = supabase.table("margin_debt") \
            .select("debit_balance") \
            .lte("date", two_years_ago) \
            .order("date", desc=True).limit(1).execute()

        change_2y = None
        if prev_q.data and prev_q.data[0].get('debit_balance'):
            prev_val = prev_q.data[0]['debit_balance']
            change_2y = ((debit_dollars - prev_val) / prev_val) * 100

        row = {
            'date': data.date,
            'debit_balance': debit_dollars,
            'change_2y': change_2y,
            'updated_at': datetime.now().isoformat(),
        }
        if data.free_credit is not None:
            row['free_credit'] = data.free_credit * 1_000_000

        supabase.table("margin_debt").upsert(row, on_conflict="date").execute()

        return {
            "status": "ok",
            "date": data.date,
            "debit_balance": debit_dollars,
            "change_2y": round(change_2y, 2) if change_2y else None,
        }
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


def _pct_change(current, previous):
    """安全なパーセント変化率計算"""
    if current is None or previous is None or previous == 0:
        return None
    return ((current - previous) / abs(previous)) * 100


@router.get("/events")
async def get_market_events_endpoint():
    """
    配管タブ：イベント検出
    6種のイベント（FUNDING_STRESS, LIQUIDITY_DRAIN, BANK_STRESS,
    VOLATILITY_SHOCK, CREDIT_SPIKE, REPO_STRESS）をリアルタイム検出
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # キャッシュチェック (30分)
        now = datetime.now()
        if _events_cache["data"] and _events_cache["expires"] and _events_cache["expires"] > now:
            return _events_cache["data"]

        loop = asyncio.get_event_loop()

        # 4クエリ並列実行
        fed_q, bank_q, mkt_q, spread_q = await asyncio.gather(
            loop.run_in_executor(_executor, lambda: supabase.table("fed_balance_sheet")
                .select("date,reserves,soma_assets,rrp,tga")
                .order("date", desc=True).limit(100).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("bank_sector")
                .select("date,kre_close")
                .order("date", desc=True).limit(45).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("market_indicators")
                .select("date,vix")
                .order("date", desc=True).limit(23).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("credit_spreads")
                .select("date,hy_spread,ig_spread")
                .order("date", desc=True).limit(23).execute()),
        )

        fed = fed_q.data or []
        bank = bank_q.data or []
        mkt = mkt_q.data or []
        sprd = spread_q.data or []

        # 週次フィールドのみの行を抽出（SOMA/TGA/reservesが非null）
        def _fed_weekly(field):
            """指定fieldが非nullの行だけ抽出（date DESC順を維持）"""
            return [r for r in fed if r.get(field) is not None]

        fed_soma_rows = _fed_weekly('soma_assets')

        # 準備預金変化率（forward-fill: 最新2つの非null値）
        reserves_change_1m = _pct_change(
            _find_nth_nonnull(fed, 'reserves', 0),
            _find_nth_nonnull(fed, 'reserves', 1)
        )
        reserves_change_1w = reserves_change_1m  # reservesは週次以下なので同等

        # Net Liquidity変化率（SOMA/TGAが非nullの行ベースで計算）
        def net_liq_val(rows, idx):
            if idx < len(rows):
                s = rows[idx].get('soma_assets')
                r = rows[idx].get('rrp', 0) or 0  # RRPはfallback 0
                t = rows[idx].get('tga')
                if s is not None and t is not None:
                    return s - r - t
            return None

        nl_now = net_liq_val(fed_soma_rows, 0)
        nl_1m = net_liq_val(fed_soma_rows, 4)   # ~4週前
        nl_3m = net_liq_val(fed_soma_rows, 12)  # ~12週前
        net_liquidity_change_1m = _pct_change(nl_now, nl_1m)
        net_liquidity_change_3m = _pct_change(nl_now, nl_3m)

        # RRP変化率（日次データなのでそのまま）
        rrp_change_1w = _pct_change(
            fed[0].get('rrp') if len(fed) > 0 else None,
            fed[4].get('rrp') if len(fed) > 4 else None  # ~1週間前
        )

        # KRE変化率
        kre_change_1m = _pct_change(
            bank[0].get('kre_close') if len(bank) > 0 else None,
            bank[21].get('kre_close') if len(bank) > 21 else None
        )
        kre_change_2m = _pct_change(
            bank[0].get('kre_close') if len(bank) > 0 else None,
            bank[43].get('kre_close') if len(bank) > 43 else None
        )

        # VIX
        vix_current = mkt[0].get('vix') if len(mkt) > 0 else None
        vix_1w_ago = mkt[4].get('vix') if len(mkt) > 4 else None
        vix_1m_ago = mkt[21].get('vix') if len(mkt) > 21 else None

        # スプレッド
        hy_spread_current = sprd[0].get('hy_spread') if len(sprd) > 0 else None
        hy_spread_1m_ago = sprd[21].get('hy_spread') if len(sprd) > 21 else None
        ig_spread_current = sprd[0].get('ig_spread') if len(sprd) > 0 else None
        ig_spread_1m_ago = sprd[21].get('ig_spread') if len(sprd) > 21 else None

        events = detect_market_events(
            reserves_change_1m=reserves_change_1m,
            reserves_change_1w=reserves_change_1w,
            net_liquidity_change_3m=net_liquidity_change_3m,
            net_liquidity_change_1m=net_liquidity_change_1m,
            kre_change_2m=kre_change_2m,
            kre_change_1m=kre_change_1m,
            vix_current=vix_current,
            vix_1m_ago=vix_1m_ago,
            vix_1w_ago=vix_1w_ago,
            hy_spread_current=hy_spread_current,
            hy_spread_1m_ago=hy_spread_1m_ago,
            ig_spread_current=ig_spread_current,
            ig_spread_1m_ago=ig_spread_1m_ago,
            sofr_ff_spread=None,
            rrp_change_1w=rrp_change_1w,
        )

        severity_order = {'CRITICAL': 0, 'ALERT': 1, 'WARNING': 2}
        highest = None
        if events:
            highest = min(events, key=lambda e: severity_order.get(e.severity, 3)).severity

        event_result = {
            "events": events_to_dict(events),
            "event_count": len(events),
            "highest_severity": highest,
            "timestamp": datetime.now().isoformat(),
        }

        _events_cache["data"] = event_result
        _events_cache["expires"] = now + timedelta(minutes=30)

        return event_result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/policy-regime")
async def get_policy_regime_endpoint():
    """
    配管タブ：Policy Regime検出
    SOMA変化/RRP水準/FFレート等からFedの政策状態を判定
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # キャッシュチェック (30分)
        now = datetime.now()
        if _policy_cache["data"] and _policy_cache["expires"] and _policy_cache["expires"] > now:
            return _policy_cache["data"]

        loop = asyncio.get_event_loop()
        six_months_ago = (now - timedelta(days=182)).strftime('%Y-%m-%d')

        # 4クエリ並列実行
        def q_fed():
            return supabase.table("fed_balance_sheet") \
                .select("date,soma_assets,rrp,tga") \
                .order("date", desc=True).limit(200).execute()

        def q_rates():
            return supabase.table("interest_rates") \
                .select("date,fed_funds,treasury_spread") \
                .order("date", desc=True).limit(200).execute()

        def q_cpi():
            return supabase.table("economic_indicators") \
                .select("current_value") \
                .eq("indicator", "CPI_YOY") \
                .order("reference_period", desc=True).limit(1).execute()

        fed_q, rates_q, cpi_q = await asyncio.gather(
            loop.run_in_executor(_executor, q_fed),
            loop.run_in_executor(_executor, q_rates),
            loop.run_in_executor(_executor, q_cpi),
        )

        fed = fed_q.data or []

        # SOMA/TGAが非nullの行だけ抽出（週次ベース）
        fed_soma = [r for r in fed if r.get('soma_assets') is not None]

        soma_now = fed_soma[0].get('soma_assets') if len(fed_soma) > 0 else None
        soma_3m = fed_soma[12].get('soma_assets') if len(fed_soma) > 12 else None
        soma_6m = fed_soma[25].get('soma_assets') if len(fed_soma) > 25 else None
        soma_change_3m = _pct_change(soma_now, soma_3m)
        soma_change_6m = _pct_change(soma_now, soma_6m)

        rrp_level = fed[0].get('rrp') if len(fed) > 0 else None
        rrp_3m = fed[60].get('rrp') if len(fed) > 60 else None
        rrp_change_3m = _pct_change(rrp_level, rrp_3m)

        tga_level = _find_nth_nonnull(fed, 'tga', 0)

        # 金利: 200行取得済みから6ヶ月前も抽出（追加クエリ不要）
        rates_rows = rates_q.data or []
        ff_rate = _find_nth_nonnull(rates_rows, 'fed_funds', 0)
        yield_curve = _find_nth_nonnull(rates_rows, 'treasury_spread', 0)
        ff_date = rates_rows[0].get('date') if rates_rows else None

        ff_rate_change_6m = None
        if ff_rate is not None:
            rates_6m_rows = [r for r in rates_rows if r.get('date', '') <= six_months_ago]
            ff_rate_6m = _find_nth_nonnull(rates_6m_rows, 'fed_funds', 0)
            if ff_rate_6m is not None:
                ff_rate_change_6m = ff_rate - ff_rate_6m

        inflation_rate = None
        if cpi_q.data and cpi_q.data[0].get('current_value') is not None:
            inflation_rate = cpi_q.data[0]['current_value']

        regime = detect_policy_regime(
            soma_change_3m=soma_change_3m,
            soma_change_6m=soma_change_6m,
            rrp_level=rrp_level,
            rrp_change_3m=rrp_change_3m,
            tga_level=tga_level,
            ff_rate=ff_rate,
            ff_rate_change_6m=ff_rate_change_6m,
            yield_curve=yield_curve,
            inflation_rate=inflation_rate,
        )

        policy_result = policy_regime_to_dict(regime)
        policy_result['fed_comment'] = generate_fed_action_comment(regime)
        policy_result['timestamp'] = datetime.now().isoformat()

        _policy_cache["data"] = policy_result
        _policy_cache["expires"] = now + timedelta(minutes=30)

        return policy_result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history-charts")
async def get_history_charts(
    period: str = Query("2y", description="期間: 1y, 2y, 5y, 10y, all"),
    start_date: Optional[str] = Query(None, description="開始日 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="終了日 YYYY-MM-DD"),
):
    """
    履歴グラフ用データ（6テーブル一括取得）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        from datetime import timedelta

        # 期間 → 日付範囲
        if start_date and end_date:
            sd, ed = start_date, end_date
        else:
            period_days = {
                '1y': 365, '2y': 730, '5y': 1825, '10y': 3650, 'all': 36500
            }
            days = period_days.get(period, 730)
            ed = datetime.now().strftime('%Y-%m-%d')
            sd = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        # 各テーブルクエリ（日付昇順）— 7クエリ並列実行
        loop = asyncio.get_event_loop()
        fed_q, margin_q, bank_q, spreads_q, indicators_q, rates_q, layer_stress_q = await asyncio.gather(
            loop.run_in_executor(_executor, lambda: supabase.table("fed_balance_sheet")
                .select("date,soma_assets,rrp,tga")
                .gte("date", sd).lte("date", ed)
                .order("date", desc=False).limit(2000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("margin_debt")
                .select("date,debit_balance,change_2y")
                .gte("date", sd).lte("date", ed)
                .order("date", desc=False).limit(500).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("bank_sector")
                .select("date,kre_close,kre_52w_change")
                .gte("date", sd).lte("date", ed)
                .order("date", desc=False).limit(2000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("credit_spreads")
                .select("date,hy_spread,ig_spread")
                .gte("date", sd).lte("date", ed)
                .order("date", desc=False).limit(2000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("market_indicators")
                .select("date,vix,sp500,nasdaq,dxy")
                .gte("date", sd).lte("date", ed)
                .order("date", desc=False).limit(2000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("interest_rates")
                .select("date,fed_funds,treasury_2y,treasury_10y,treasury_spread")
                .gte("date", sd).lte("date", ed)
                .order("date", desc=False).limit(2000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("layer_stress_history")
                .select("date,layer,stress_score")
                .gte("date", sd).lte("date", ed)
                .order("date", desc=False).limit(3000).execute()),
        )

        # Net Liquidity計算
        net_liq_data = []
        for row in (fed_q.data or []):
            soma = row.get('soma_assets')
            rrp = row.get('rrp')
            tga = row.get('tga')
            nl = None
            if soma is not None and rrp is not None and tga is not None:
                nl = soma - rrp - tga
            net_liq_data.append({
                'date': row['date'],
                'net_liquidity': nl,
                'soma_assets': soma,
                'rrp': rrp,
                'tga': tga,
            })

        # ============================================================
        # Layer Stress History（並列で取得済み）
        # ============================================================
        from collections import defaultdict
        layer_by_date = defaultdict(dict)
        for row in (layer_stress_q.data or []):
            layer_by_date[row['date']][row['layer']] = row['stress_score']

        layer_scores_data = [
            {
                'date': d,
                'layer1': vals.get('layer1'),
                'layer2a': vals.get('layer2a'),
                'layer2b': vals.get('layer2b'),
            }
            for d, vals in sorted(layer_by_date.items())
        ]

        # ============================================================
        # 乖離分析: z(L2B) - z(S&P500)
        # ============================================================
        # SP500を月次にダウンサンプル
        sp500_monthly = {}
        for row in (indicators_q.data or []):
            mk = row['date'][:7]
            if row.get('sp500') is not None:
                sp500_monthly[mk] = row['sp500']

        # L2Bスコアを月次で取得
        l2b_monthly = {}
        for row in (layer_stress_q.data or []):
            if row.get('layer') == 'layer2b' and row.get('stress_score') is not None:
                l2b_monthly[row['date'][:7]] = row['stress_score']

        # 共通月でアライン
        common_months = sorted(set(l2b_monthly.keys()) & set(sp500_monthly.keys()))
        divergence_data = []
        if len(common_months) >= 3:
            l2b_vals = [l2b_monthly[m] for m in common_months]
            sp_vals = [sp500_monthly[m] for m in common_months]
            z_l2b = rolling_zscore(l2b_vals, 24)
            z_sp = rolling_zscore(sp_vals, 24)
            for i, m in enumerate(common_months):
                div = None
                if z_l2b[i] is not None and z_sp[i] is not None:
                    div = round(z_l2b[i] - z_sp[i], 3)
                divergence_data.append({
                    'date': f"{m}-01",
                    'divergence': div,
                    'z_l2b': z_l2b[i],
                    'z_sp500': z_sp[i],
                })

        return {
            "period": period,
            "start_date": sd,
            "end_date": ed,
            "data": {
                "net_liquidity": net_liq_data,
                "margin_debt": margin_q.data or [],
                "bank_sector": bank_q.data or [],
                "credit_spreads": spreads_q.data or [],
                "market_indicators": indicators_q.data or [],
                "interest_rates": rates_q.data or [],
                "layer_scores": layer_scores_data,
                "layer_divergence": divergence_data,
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# 歴史的クライシスイベント定義
# ============================================================
CRISIS_EVENTS = [
    ('2011-08-31', '2011年欧州債務危機', 'S&P格下げ、欧州危機深刻化'),
    ('2018-12-31', '2018年12月急落', 'FRB利上げ + QT'),
    ('2019-09-30', '2019年9月レポ危機', 'レポ金利急騰'),
    ('2020-03-31', 'コロナショック', 'パンデミック'),
    ('2022-10-31', '2022年ベア相場', 'インフレ対応利上げ'),
    ('2023-03-31', '2023年銀行危機', 'SVB破綻'),
]


@router.get("/backtest-states")
async def get_backtest_states(
    limit: int = Query(120, description="月数（最大）"),
):
    """
    バックテスト：月次の状態判定 + 統計

    既存テーブルから月末データを集約し、各月のLayer Stress → State を計算。
    SP500の6ヶ月後リターンも算出。
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # キャッシュチェック（1時間TTL）
        now = datetime.now()
        cache_key = str(limit)
        if cache_key in _backtest_cache and _backtest_cache[cache_key]["expires"] > now:
            return _backtest_cache[cache_key]["data"]

        # 7クエリ並列実行
        loop = asyncio.get_event_loop()
        fed_all, sp500_q, margin_q, bank_q, spreads_q, srf_q, mmf_q = await asyncio.gather(
            loop.run_in_executor(_executor, lambda: supabase.table("fed_balance_sheet")
                .select("date,soma_assets,rrp,tga,reserves")
                .order("date", desc=False).limit(5000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("market_indicators")
                .select("date,sp500,vix")
                .order("date", desc=False).limit(5000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("margin_debt")
                .select("date,debit_balance,change_2y")
                .order("date", desc=False).limit(500).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("bank_sector")
                .select("date,kre_52w_change")
                .order("date", desc=False).limit(500).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("credit_spreads")
                .select("date,ig_spread,hy_spread")
                .order("date", desc=False).limit(5000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("srf_usage")
                .select("date,amount")
                .order("date", desc=False).limit(5000).execute()),
            loop.run_in_executor(_executor, lambda: supabase.table("mmf_assets")
                .select("date,change_3m")
                .order("date", desc=False).limit(500).execute()),
        )

        # ============================================================
        # 月末データをマップ化
        # ============================================================
        def to_month_map(rows, key_fields):
            """各月の最終レコードをマップ化"""
            m = {}
            for row in (rows or []):
                d = row.get('date', '')
                month_key = d[:7]  # YYYY-MM
                m[month_key] = {k: row.get(k) for k in key_fields}
                m[month_key]['date'] = d
            return m

        # SP500を月次マップ化
        sp500_map = to_month_map(sp500_q.data, ['sp500', 'vix'])

        # Margin月次
        margin_map = to_month_map(margin_q.data, ['debit_balance', 'change_2y'])

        # Bank月次
        bank_map = to_month_map(bank_q.data, ['kre_52w_change'])

        # Spreads月次
        spreads_map = to_month_map(spreads_q.data, ['ig_spread', 'hy_spread'])

        # MMF月次
        mmf_map = to_month_map(mmf_q.data, ['change_3m'])

        # FRBデータ（Net Liquidity + 月次マップ）
        fed_map = to_month_map(fed_all.data, ['soma_assets', 'rrp', 'tga', 'reserves'])

        # Net Liquidity履歴（Z-score計算用）
        nl_history = []
        for row in (fed_all.data or []):
            s = row.get('soma_assets')
            r = row.get('rrp')
            t = row.get('tga')
            if s is not None and r is not None and t is not None:
                nl_history.append(s - r - t)

        # SRF月次集計
        srf_monthly = {}
        for row in (srf_q.data or []):
            d = row.get('date', '')
            month_key = d[:7]
            amount = row.get('amount', 0) or 0
            if month_key not in srf_monthly:
                srf_monthly[month_key] = {'usage': 0, 'days': 0}
            srf_monthly[month_key]['usage'] += amount
            if amount > 0:
                srf_monthly[month_key]['days'] += 1

        # SP500月次キーをソート（6Mリターン計算用）
        sp500_months_sorted = sorted(sp500_map.keys())

        # ============================================================
        # 各月のストレス計算
        # ============================================================
        # 対象月 = FRBデータがある月（最大limit件）
        all_months = sorted(set(fed_map.keys()))
        target_months = all_months[-limit:] if len(all_months) > limit else all_months

        states = []
        for mk in target_months:
            fed_row = fed_map.get(mk, {})
            soma = fed_row.get('soma_assets')
            rrp_ = fed_row.get('rrp')
            tga_ = fed_row.get('tga')
            reserves = fed_row.get('reserves')

            # Layer 1
            l1_score = 50  # default
            if soma is not None and rrp_ is not None and tga_ is not None and nl_history:
                current_nl = soma - rrp_ - tga_
                l1 = calculate_layer1_stress(current_nl, nl_history)
                l1_score = l1['stress_score']

            # Layer 2A
            margin_row = margin_map.get(mk, {})
            bank_row = bank_map.get(mk, {})
            spread_row = spreads_map.get(mk, {})
            srf_row = srf_monthly.get(mk, {'usage': 0, 'days': 0})

            # 準備預金変化率（前月比）
            prev_mk_list = [m for m in all_months if m < mk]
            reserves_mom = None
            if prev_mk_list and reserves is not None:
                prev_fed = fed_map.get(prev_mk_list[-1], {})
                prev_res = prev_fed.get('reserves')
                if prev_res and prev_res != 0:
                    reserves_mom = ((reserves - prev_res) / prev_res) * 100

            l2a = calculate_layer2a_stress(
                reserves_change_mom=reserves_mom,
                kre_52w_change=bank_row.get('kre_52w_change'),
                srf_usage=srf_row['usage'],
                ig_spread=spread_row.get('ig_spread'),
                srf_consecutive_days=srf_row['days'],
                srf_days_90d=srf_row['days'],
            )
            l2a_score = l2a['stress_score']

            # Layer 2B
            change_2y = margin_row.get('change_2y')
            mmf_row = mmf_map.get(mk, {})
            sp500_row = sp500_map.get(mk, {})

            l2b_score = 40  # default
            if change_2y is not None:
                l2b = calculate_layer2b_stress(
                    margin_debt_2y=change_2y,
                    margin_debt_1y=None,
                    mmf_change=mmf_row.get('change_3m'),
                    vix=sp500_row.get('vix'),
                )
                l2b_score = l2b['stress_score']

            # State判定
            ms = determine_market_state(l1_score, l2a_score, l2b_score,
                                        l2a.get('interpretation_type'))

            # 6ヶ月後リターン
            return_6m = None
            sp500_now = sp500_row.get('sp500')
            if sp500_now:
                # 6ヶ月後の月キーを探す
                idx_candidates = [
                    m for m in sp500_months_sorted
                    if m >= mk[:5] + str(int(mk[5:7]) + 6).zfill(2)
                    if int(mk[5:7]) + 6 <= 12
                ]
                if not idx_candidates and int(mk[5:7]) + 6 > 12:
                    target_year = int(mk[:4]) + 1
                    target_month = int(mk[5:7]) + 6 - 12
                    idx_candidates = [
                        m for m in sp500_months_sorted
                        if m >= f"{target_year}-{str(target_month).zfill(2)}"
                    ]
                if idx_candidates:
                    future_row = sp500_map.get(idx_candidates[0], {})
                    sp500_future = future_row.get('sp500')
                    if sp500_future and sp500_now > 0:
                        return_6m = round(((sp500_future - sp500_now) / sp500_now) * 100, 2)

            states.append({
                'date': fed_row.get('date', mk + '-28'),
                'state_code': ms['code'],
                'state_label': ms['label'],
                'color': ms['color'],
                'action': ms['action'],
                'layer1_stress': l1_score,
                'layer2a_stress': l2a_score,
                'layer2b_stress': l2b_score,
                'sp500': sp500_now,
                'return_6m': return_6m,
            })

        # ============================================================
        # 統計計算
        # ============================================================
        from collections import defaultdict
        stat_buckets = defaultdict(list)
        for s in states:
            if s['return_6m'] is not None:
                stat_buckets[s['state_code']].append(s['return_6m'])

        state_stats = {}
        for code, returns in stat_buckets.items():
            if not returns:
                continue
            wins = [r for r in returns if r > 0]
            state_stats[code] = {
                'avg_return_6m': round(sum(returns) / len(returns), 2),
                'win_rate': round(len(wins) / len(returns) * 100, 1),
                'max_drawdown': round(min(returns), 2),
                'best_return': round(max(returns), 2),
                'sample_count': len(returns),
                'occurrence_pct': round(len(returns) / max(len(states), 1) * 100, 1),
            }

        # ============================================================
        # イベントタイムライン（歴史的クライシス）
        # ============================================================
        event_timeline = []
        for event_date, event_name, event_desc in CRISIS_EVENTS:
            candidates = [s for s in states if s['date'] <= event_date]
            if candidates:
                matched = candidates[-1]
                event_timeline.append({
                    'event': event_name,
                    'description': event_desc,
                    'event_date': event_date,
                    'actual_date': matched['date'],
                    'state_code': matched['state_code'],
                    'state_label': matched['state_label'],
                    'color': matched['color'],
                    'layer1_stress': matched['layer1_stress'],
                    'layer2a_stress': matched['layer2a_stress'],
                    'layer2b_stress': matched['layer2b_stress'],
                    'sp500': matched.get('sp500'),
                    'return_6m': matched.get('return_6m'),
                })

        # State定義
        state_defs = []
        for code in ['LIQUIDITY_SHOCK', 'CREDIT_CONTRACTION', 'POLICY_TIGHTENING',
                      'SPLIT_BUBBLE', 'MARKET_OVERSHOOT', 'FINANCIAL_RALLY', 'HEALTHY', 'NEUTRAL']:
            d = MARKET_STATE_DEFINITIONS[code]
            conditions_map = {
                'LIQUIDITY_SHOCK': 'L2A >= 65',
                'CREDIT_CONTRACTION': 'L2A >= 50',
                'POLICY_TIGHTENING': 'L1 >= 45',
                'SPLIT_BUBBLE': 'L2A >= 40 AND L2B >= 70',
                'MARKET_OVERSHOOT': 'L2B >= 80 AND L2A < 35',
                'FINANCIAL_RALLY': 'L1 < 30 AND L2B > 60',
                'HEALTHY': 'L1 < 35 AND L2A < 35 AND L2B < 40',
                'NEUTRAL': 'いずれにも該当しない',
            }
            state_defs.append({
                'code': code,
                'label': d['label'],
                'description': d['description'],
                'conditions': conditions_map.get(code, ''),
                'action': d['action'],
                'color': d['color'],
            })

        result = {
            "states": states,
            "state_definitions": state_defs,
            "state_stats": state_stats,
            "total_months": len(states),
            "event_timeline": event_timeline,
        }

        _backtest_cache[cache_key] = {"data": result, "expires": now + timedelta(hours=1)}
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
