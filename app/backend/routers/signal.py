"""
/api/signal/{ticker} - V10シグナル計算
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import yfinance as yf
import pandas as pd
import numpy as np

router = APIRouter()


class SignalConditions(BaseModel):
    """V10シグナル条件"""
    market_regime: str  # BULL, BEAR, RECOVERY, WEAKENING
    ema_convergence: bool
    ema_convergence_value: float
    rs_trend: str  # UP, FLAT, DOWN
    rs_value: float
    bos_detected: bool
    choch_detected: bool
    volume_confirm: bool


class SignalResponse(BaseModel):
    """シグナルレスポンス"""
    ticker: str
    timestamp: str
    entry_allowed: bool
    signal_strength: int  # 0-100
    conditions: SignalConditions
    current_price: float
    price_category: str


def calculate_ema(prices: pd.Series, period: int) -> pd.Series:
    """EMAを計算"""
    return prices.ewm(span=period, adjust=False).mean()


def calculate_relative_strength(ticker_data: pd.DataFrame, spy_data: pd.DataFrame) -> float:
    """相対強度を計算（対SPY）"""
    if len(ticker_data) < 20 or len(spy_data) < 20:
        return 0.0

    ticker_return = (ticker_data['Close'].iloc[-1] / ticker_data['Close'].iloc[-20] - 1) * 100
    spy_return = (spy_data['Close'].iloc[-1] / spy_data['Close'].iloc[-20] - 1) * 100

    return ticker_return - spy_return


def get_rs_trend(rs_value: float, price_category: str) -> str:
    """RS TrendをカテゴリベースThresholdsで判定"""
    thresholds = {
        "penny": {"up": 5.0, "down": -8.0},
        "mid": {"up": 3.0, "down": -5.0},
        "large": {"up": 2.0, "down": -3.0},
    }

    th = thresholds.get(price_category, thresholds["mid"])

    if rs_value >= th["up"]:
        return "UP"
    elif rs_value <= th["down"]:
        return "DOWN"
    else:
        return "FLAT"


def get_price_category(price: float) -> str:
    """株価カテゴリを判定"""
    if price < 20:
        return "penny"
    elif price < 100:
        return "mid"
    else:
        return "large"


def calculate_ema_convergence(df: pd.DataFrame) -> tuple[bool, float]:
    """EMA収束を計算"""
    if len(df) < 50:
        return False, 0.0

    ema8 = calculate_ema(df['Close'], 8).iloc[-1]
    ema13 = calculate_ema(df['Close'], 13).iloc[-1]
    ema21 = calculate_ema(df['Close'], 21).iloc[-1]
    ema50 = calculate_ema(df['Close'], 50).iloc[-1]

    current_price = df['Close'].iloc[-1]

    # 収束度 = 全EMAの価格に対する標準偏差
    emas = [ema8, ema13, ema21, ema50]
    convergence_value = (np.std(emas) / current_price) * 100

    # 収束判定（1.5%以内）
    is_converged = convergence_value < 1.5

    return is_converged, round(convergence_value, 2)


def detect_bos(df: pd.DataFrame) -> bool:
    """簡易BOS検出（直近高値ブレイク）"""
    if len(df) < 20:
        return False

    recent_high = df['High'].iloc[-20:-1].max()
    current_close = df['Close'].iloc[-1]

    return current_close > recent_high


def detect_choch(df: pd.DataFrame) -> bool:
    """簡易CHoCH検出（トレンド転換）"""
    if len(df) < 10:
        return False

    # 直近5日のトレンドが反転したか
    prev_trend = df['Close'].iloc[-10:-5].mean()
    recent_trend = df['Close'].iloc[-5:].mean()

    return recent_trend > prev_trend


@router.get("/{ticker}", response_model=SignalResponse)
async def get_signal(
    ticker: str,
    mode: str = Query("balanced", description="取引モード: aggressive, balanced, conservative"),
):
    """
    V10シグナルを計算

    - **ticker**: 銘柄コード (例: NVDA)
    - **mode**: aggressive=攻め, balanced=バランス, conservative=守り
    """
    ticker = ticker.upper()

    try:
        # 株価データ取得
        stock = yf.Ticker(ticker)
        df = stock.history(period="6mo")

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {ticker}")

        # SPYデータ取得（相対強度計算用）
        spy = yf.Ticker("SPY")
        spy_df = spy.history(period="6mo")

        # 現在価格とカテゴリ
        current_price = df['Close'].iloc[-1]
        price_category = get_price_category(current_price)

        # Market Regime判定（簡易版）
        spy_ema200 = calculate_ema(spy_df['Close'], 200).iloc[-1] if len(spy_df) >= 200 else spy_df['Close'].mean()
        spy_current = spy_df['Close'].iloc[-1]
        spy_ema21_slope = (calculate_ema(spy_df['Close'], 21).iloc[-1] - calculate_ema(spy_df['Close'], 21).iloc[-5]) / 5

        if spy_current > spy_ema200 and spy_ema21_slope > 0:
            market_regime = "BULL"
        elif spy_current > spy_ema200 and spy_ema21_slope <= 0:
            market_regime = "WEAKENING"
        elif spy_current <= spy_ema200 and spy_ema21_slope > 0:
            market_regime = "RECOVERY"
        else:
            market_regime = "BEAR"

        # EMA収束
        ema_convergence, ema_convergence_value = calculate_ema_convergence(df)

        # 相対強度
        rs_value = calculate_relative_strength(df, spy_df)
        rs_trend = get_rs_trend(rs_value, price_category)

        # BOS/CHoCH
        bos_detected = detect_bos(df)
        choch_detected = detect_choch(df)

        # ボリューム確認
        avg_volume = df['Volume'].iloc[-20:].mean()
        current_volume = df['Volume'].iloc[-1]
        volume_confirm = current_volume > avg_volume * 1.2

        # シグナル強度計算
        signal_strength = 0

        if market_regime in ["BULL", "RECOVERY"]:
            signal_strength += 20
        if ema_convergence:
            signal_strength += 20
        if rs_trend == "UP":
            signal_strength += 20
        elif rs_trend == "FLAT":
            signal_strength += 10
        if bos_detected:
            signal_strength += 15
        if choch_detected:
            signal_strength += 15
        if volume_confirm:
            signal_strength += 10

        # エントリー可否判定
        entry_threshold = {
            "aggressive": 40,
            "balanced": 60,
            "conservative": 80,
        }.get(mode, 60)

        entry_allowed = signal_strength >= entry_threshold

        conditions = SignalConditions(
            market_regime=market_regime,
            ema_convergence=ema_convergence,
            ema_convergence_value=ema_convergence_value,
            rs_trend=rs_trend,
            rs_value=round(rs_value, 2),
            bos_detected=bos_detected,
            choch_detected=choch_detected,
            volume_confirm=volume_confirm,
        )

        return SignalResponse(
            ticker=ticker,
            timestamp=datetime.now().isoformat(),
            entry_allowed=entry_allowed,
            signal_strength=signal_strength,
            conditions=conditions,
            current_price=round(current_price, 2),
            price_category=price_category,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
