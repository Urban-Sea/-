"""
/api/exit - Exit判定API
5層Exit Systemに基づくExit判定を提供
"""
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from analysis.asset_class import AssetClass, normalize_ticker_yfinance
from auth import require_proxy
from redis_cache import cache_get as _cache_get, cache_set as _cache_set

router = APIRouter(dependencies=[Depends(require_proxy)])

_EXIT_TTL = 86400  # 24時間 (日足ベースの 5 層 Exit 判定)


def _detect_asset_class(ticker: str) -> AssetClass:
    """ティッカー形式から資産クラスを自動判定"""
    if re.match(r'^\d+(\.T)?$', ticker, re.IGNORECASE):
        return AssetClass.JP_STOCK
    return AssetClass.US_STOCK


class ExitLayerStatus(BaseModel):
    """各Exit層の状態"""
    layer: int
    name: str
    status: str  # "SAFE", "WARNING", "TRIGGERED"
    detail: Optional[str] = None
    trigger_price: Optional[float] = None


class ExitAnalysisResponse(BaseModel):
    """Exit分析レスポンス"""
    ticker: str
    current_price: float
    entry_price: float
    pnl_pct: float
    should_exit: bool
    exit_type: Optional[str] = None
    exit_pct: int = 0
    exit_reason: Optional[str] = None
    urgency: str  # "LOW", "MEDIUM", "HIGH", "CRITICAL"
    layers: List[ExitLayerStatus]
    targets: List[dict]
    structure_stop: float
    ema_status: dict
    updated_at: str


def calculate_emas(prices: pd.Series) -> dict:
    """EMA計算"""
    return {
        "ema_8": float(prices.ewm(span=8, adjust=False).mean().iloc[-1]),
        "ema_13": float(prices.ewm(span=13, adjust=False).mean().iloc[-1]),
        "ema_21": float(prices.ewm(span=21, adjust=False).mean().iloc[-1]),
    }


def find_swing_points(df: pd.DataFrame, lookback: int = 5) -> tuple:
    """スイングハイ・ローを検出"""
    highs = df["High"].values
    lows = df["Low"].values

    swing_highs = []
    swing_lows = []

    for i in range(lookback, len(df) - lookback):
        # Swing High
        if highs[i] == max(highs[i-lookback:i+lookback+1]):
            swing_highs.append(float(highs[i]))
        # Swing Low
        if lows[i] == min(lows[i-lookback:i+lookback+1]):
            swing_lows.append(float(lows[i]))

    return swing_highs[-5:] if swing_highs else [], swing_lows[-5:] if swing_lows else []


def calculate_targets(entry_price: float, bos_grade: str = "NONE") -> List[dict]:
    """利確ターゲットを計算"""
    targets_by_grade = {
        "EXTENSION": [
            {"pct": 20, "type": "T1", "exit_pct": 25},
            {"pct": 35, "type": "T2", "exit_pct": 25},
            {"pct": 50, "type": "T3", "exit_pct": 50},
        ],
        "REVERSAL": [
            {"pct": 15, "type": "T1", "exit_pct": 25},
            {"pct": 25, "type": "T2", "exit_pct": 25},
            {"pct": 40, "type": "T3", "exit_pct": 50},
        ],
        "CONTINUATION": [
            {"pct": 15, "type": "T1", "exit_pct": 33},
            {"pct": 25, "type": "T2", "exit_pct": 33},
            {"pct": 35, "type": "T3", "exit_pct": 34},
        ],
        "NONE": [
            {"pct": 15, "type": "T1", "exit_pct": 50},
            {"pct": 25, "type": "T2", "exit_pct": 50},
        ],
    }

    grade_targets = targets_by_grade.get(bos_grade.upper(), targets_by_grade["NONE"])

    return [
        {
            "type": t["type"],
            "price": entry_price * (1 + t["pct"] / 100),
            "pct": t["pct"],
            "exit_pct": t["exit_pct"],
        }
        for t in grade_targets
    ]


@router.get("/{ticker}", response_model=ExitAnalysisResponse)
async def analyze_exit(
    ticker: str,
    entry_price: float = Query(..., description="エントリー価格"),
    entry_date: Optional[str] = Query(None, description="エントリー日 (YYYY-MM-DD)"),
    bos_grade: str = Query("NONE", description="BOS Grade: EXTENSION, REVERSAL, CONTINUATION, NONE"),
    structure_stop_pct: float = Query(8.0, description="Structure Stop% (デフォルト8%)"),
):
    """
    特定銘柄のExit判定を分析

    5層Exit System:
    - L1: 利確ターゲット
    - L2: CHoCH警戒（Lower High）
    - L3: Structure Stop（スイングロー割れ）
    - L4: EMA Cascade（8/13/21 EMA）
    - L5: Time Stop（新高値なし日数）
    """
    cache_key = f"exit:{ticker.upper()}:{entry_price}:{entry_date or 'none'}:{bos_grade}:{structure_stop_pct}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return ExitAnalysisResponse(**cached)

    try:
        # 株価データ取得（日本株対応: 7203 → 7203.T）
        ticker_upper = ticker.upper()
        asset_class = _detect_asset_class(ticker_upper)
        yf_ticker = normalize_ticker_yfinance(ticker_upper, asset_class)
        stock = yf.Ticker(yf_ticker)
        df = stock.history(period="6mo")

        if df.empty:
            raise HTTPException(status_code=404, detail=f"Stock data not found for {ticker}")

        current_price = float(df["Close"].iloc[-1])
        current_high = float(df["High"].iloc[-1])
        current_low = float(df["Low"].iloc[-1])

        # PnL計算
        pnl_pct = (current_price / entry_price - 1) * 100

        # EMA計算
        emas = calculate_emas(df["Close"])
        ema_8 = emas["ema_8"]
        ema_13 = emas["ema_13"]
        ema_21 = emas["ema_21"]

        # スイングポイント検出
        swing_highs, swing_lows = find_swing_points(df)

        # Structure Stop計算
        structure_stop = entry_price * (1 - structure_stop_pct / 100)
        if swing_lows:
            # 直近のスイングローが高ければそちらを使用
            recent_swing_low = swing_lows[-1] if swing_lows else structure_stop
            if recent_swing_low > structure_stop:
                structure_stop = recent_swing_low

        # ターゲット計算
        targets = calculate_targets(entry_price, bos_grade)

        # 各層の状態を評価
        layers = []
        should_exit = False
        exit_type = None
        exit_pct = 0
        exit_reason = None
        urgency = "LOW"

        # Layer 1: 利確ターゲット
        l1_status = "SAFE"
        l1_detail = None
        l1_trigger = None
        for t in targets:
            if current_high >= t["price"]:
                l1_status = "TRIGGERED"
                l1_detail = f"T{t['type'][-1]}到達: ${t['price']:.2f} (+{t['pct']:.1f}%)"
                l1_trigger = t["price"]
                should_exit = True
                exit_type = f"PROFIT_{t['type']}"
                exit_pct = t["exit_pct"]
                exit_reason = l1_detail
                urgency = "HIGH"
                break
            elif current_price >= t["price"] * 0.95:
                l1_status = "WARNING"
                l1_detail = f"T{t['type'][-1]}接近中: ${t['price']:.2f}"
                l1_trigger = t["price"]
                break

        layers.append(ExitLayerStatus(
            layer=1,
            name="利確ターゲット",
            status=l1_status,
            detail=l1_detail,
            trigger_price=l1_trigger
        ))

        # Layer 2: CHoCH警戒
        l2_status = "SAFE"
        l2_detail = None
        if len(swing_highs) >= 2:
            if swing_highs[-1] < swing_highs[-2]:
                diff_pct = (swing_highs[-2] - swing_highs[-1]) / swing_highs[-2] * 100
                if diff_pct >= 1.5:
                    l2_status = "WARNING"
                    l2_detail = f"Lower High検出: ${swing_highs[-1]:.2f} < ${swing_highs[-2]:.2f} (-{diff_pct:.1f}%)"

        layers.append(ExitLayerStatus(
            layer=2,
            name="CHoCH警戒",
            status=l2_status,
            detail=l2_detail,
            trigger_price=swing_highs[-1] if swing_highs else None
        ))

        # Layer 3: Structure Stop
        l3_status = "SAFE"
        l3_detail = f"Structure: ${structure_stop:.2f}"
        if current_low <= structure_stop:
            l3_status = "TRIGGERED"
            l3_detail = f"Structure Stop発動: ${current_low:.2f} <= ${structure_stop:.2f}"
            if not should_exit:
                should_exit = True
                exit_type = "STRUCTURE_STOP"
                exit_pct = 100
                exit_reason = l3_detail
                urgency = "CRITICAL"
        elif current_price <= structure_stop * 1.02:
            l3_status = "WARNING"
            l3_detail = f"Structure接近: ${structure_stop:.2f}"

        layers.append(ExitLayerStatus(
            layer=3,
            name="Structure Stop",
            status=l3_status,
            detail=l3_detail,
            trigger_price=float(structure_stop) if structure_stop else None
        ))

        # Layer 4: EMA Cascade
        ema_broken_8 = current_price < ema_8
        ema_broken_13 = current_price < ema_13
        ema_broken_21 = current_price < ema_21

        l4_status = "SAFE"
        l4_detail = None
        if ema_broken_21:
            l4_status = "TRIGGERED"
            l4_detail = "21EMA割れ"
        elif ema_broken_13:
            l4_status = "WARNING"
            l4_detail = "13EMA割れ（21EMAはホールド）"
        elif ema_broken_8:
            l4_status = "WARNING"
            l4_detail = "8EMA割れ（13EMAはホールド）"

        layers.append(ExitLayerStatus(
            layer=4,
            name="EMA Cascade",
            status=l4_status,
            detail=l4_detail,
            trigger_price=float(ema_8) if ema_8 else None
        ))

        # Layer 5: Time Stop
        l5_status = "SAFE"
        l5_detail = None
        days_since_high = 0

        if entry_date:
            try:
                entry_dt = pd.Timestamp(entry_date)
                if df.index.tz is not None:
                    entry_dt = entry_dt.tz_localize(df.index.tz)
                entry_df = df[df.index >= entry_dt]
                if not entry_df.empty:
                    highest_idx = entry_df["High"].idxmax()
                    days_since_high = (df.index[-1] - highest_idx).days
                    l5_detail = f"最高値から{days_since_high}日経過"

                    if days_since_high >= 30:
                        l5_status = "TRIGGERED"
                        if not should_exit:
                            should_exit = True
                            exit_type = "TIME_STOP"
                            exit_pct = 100
                            exit_reason = f"Time Stop: {days_since_high}日間新高値なし"
                            urgency = "HIGH"
                    elif days_since_high >= 20:
                        l5_status = "WARNING"
            except Exception:
                l5_detail = "日付形式エラー"

        layers.append(ExitLayerStatus(
            layer=5,
            name="Time Stop",
            status=l5_status,
            detail=l5_detail,
            trigger_price=None
        ))

        # EMA状態
        ema_status = {
            "ema_8": round(ema_8, 2),
            "ema_13": round(ema_13, 2),
            "ema_21": round(ema_21, 2),
            "above_ema_8": current_price > ema_8,
            "above_ema_13": current_price > ema_13,
            "above_ema_21": current_price > ema_21,
        }

        response = ExitAnalysisResponse(
            ticker=ticker.upper(),
            current_price=round(current_price, 2),
            entry_price=entry_price,
            pnl_pct=round(pnl_pct, 2),
            should_exit=should_exit,
            exit_type=exit_type,
            exit_pct=exit_pct,
            exit_reason=exit_reason,
            urgency=urgency,
            layers=layers,
            targets=targets,
            structure_stop=round(structure_stop, 2),
            ema_status=ema_status,
            updated_at=datetime.now().isoformat(),
        )
        _cache_set(cache_key, response.model_dump(), ttl=_EXIT_TTL)
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{ticker}/quick")
async def quick_exit_check(
    ticker: str,
    entry_price: float = Query(..., description="エントリー価格"),
):
    """
    シンプルなExit判定（Structure Stopのみ）

    8%の固定ストップロス判定
    """
    cache_key = f"exit:quick:{ticker.upper()}:{entry_price}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        ticker_upper = ticker.upper()
        asset_class = _detect_asset_class(ticker_upper)
        yf_ticker = normalize_ticker_yfinance(ticker_upper, asset_class)
        stock = yf.Ticker(yf_ticker)
        info = stock.info
        current_price = info.get("regularMarketPrice") or info.get("previousClose")

        if not current_price:
            df = stock.history(period="5d")
            if df.empty:
                raise HTTPException(status_code=404, detail=f"Stock data not found for {ticker}")
            current_price = df["Close"].iloc[-1]

        structure_stop = entry_price * 0.92  # 8%
        pnl_pct = (current_price / entry_price - 1) * 100

        should_exit = current_price <= structure_stop
        urgency = "CRITICAL" if should_exit else ("WARNING" if pnl_pct < -5 else "SAFE")

        result = {
            "ticker": ticker.upper(),
            "current_price": round(current_price, 2),
            "entry_price": entry_price,
            "pnl_pct": round(pnl_pct, 2),
            "structure_stop": round(structure_stop, 2),
            "should_exit": should_exit,
            "urgency": urgency,
        }
        _cache_set(cache_key, result, ttl=_EXIT_TTL)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


def compute_exit_summary(df: pd.DataFrame, entry_price: float) -> dict:
    """
    バッチ用の軽量 Exit サマリー。
    EMA 位置関係 + CHoCH 警戒 + Structure Stop から
    SAFE / WARNING / DANGER を判定。
    """
    current_price = float(df["Close"].iloc[-1])
    emas = calculate_emas(df["Close"])
    swing_highs, swing_lows = find_swing_points(df)

    # Structure Stop
    structure_stop = entry_price * 0.92
    if swing_lows:
        recent_sl = swing_lows[-1]
        if recent_sl > structure_stop:
            structure_stop = recent_sl

    above_8 = current_price > emas["ema_8"]
    above_13 = current_price > emas["ema_13"]
    above_21 = current_price > emas["ema_21"]

    # CHoCH 警戒 (Lower High)
    choch_warning = False
    if len(swing_highs) >= 2:
        diff_pct = (swing_highs[-2] - swing_highs[-1]) / swing_highs[-2] * 100
        if diff_pct >= 1.5:
            choch_warning = True

    # 総合判定
    if current_price <= structure_stop or not above_21:
        status = "DANGER"
    elif choch_warning or not above_8 or not above_13:
        status = "WARNING"
    else:
        status = "SAFE"

    return {
        "exit_status": status,
        "exit_structure_stop": round(structure_stop, 2),
        "exit_ema_above": {"ema8": above_8, "ema13": above_13, "ema21": above_21},
        "exit_choch_warning": choch_warning,
    }
