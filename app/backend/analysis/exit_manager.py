"""
Exit Manager - PatB Exit System

バックテスト実績（PF 10.21, win% 67.7%）を本番で再現するため、
exit_patternB ロジックを1行単位で移植。

4層Exit:
1. ATR_Floor: entry_price - ATR×3.0, Close確定（Fix1）
2. Mirror: Bearish CHoCH → 50%記録, EMA8<EMA21 → 残り50%（Fix3）
3. Trail_Stop: EMA21×1.05超で有効化, trail_base = EMA10×0.7 + highest×0.3 - ATR×regime_mult
4. Time_Stop: 252営業日
"""

from dataclasses import dataclass
from typing import Optional

import pandas as pd

from analysis.choch_detector import CHoCHType


@dataclass
class TradeResult:
    """evaluate_trade の戻り値"""
    exit_idx: int
    exit_price: float
    exit_reason: str  # ATR_Floor, Mirror_Full, Mirror_Partial, Trail_Stop, Time_Stop etc.


@dataclass
class HoldingStatus:
    """evaluate_current の戻り値（保有中ポジションの状態）"""
    # ATR Floor
    atr_floor_price: float
    atr_floor_triggered: bool

    # Mirror（部分利確）
    partial_exit_done: bool
    bearish_choch_detected: bool
    ema_death_cross: bool

    # Trail Stop
    trail_active: bool
    trail_stop_price: Optional[float]
    highest_price: float

    # 全体
    unrealized_pct: float
    holding_days: int
    nearest_exit_reason: Optional[str]


# Regime別Trail倍率
TRAIL_MULT = {"BULL": 3.0, "WEAKENING": 2.7, "BEAR": 2.5, "RECOVERY": 3.5}


def _run_exit_loop(df, entry_idx, entry_price, entry_atr, regime, choch_signals,
                   *, stop_at=None):
    """
    PatBロジックの共通ループ。

    stop_at=None: 最後まで走り TradeResult を返す (evaluate_trade用)
    stop_at=int:  そのインデックスで打ち切り HoldingStatus を返す (evaluate_current用)

    ループ本体は evaluate_trade (バックテスト一致確認済み) と完全同一。
    分岐は戻り値の構築部分のみ。
    """
    trail_mult = TRAIL_MULT.get(regime, 3.0)
    atr_floor = entry_price - entry_atr * 3.0
    max_day = min(entry_idx + 252, len(df) - 1)
    highest = entry_price
    trail_active = False
    choch_exit_price = None
    trail_stop_price = None

    # current mode の場合、ループ範囲を制限
    loop_end = stop_at if stop_at is not None else max_day

    for d in range(entry_idx + 1, loop_end + 1):
        if d >= len(df):
            break

        close = df['Close'].iloc[d]
        high = df['High'].iloc[d]
        low = df['Low'].iloc[d]
        atr_now = df['ATR'].iloc[d] if pd.notna(df['ATR'].iloc[d]) else entry_atr
        if pd.isna(close):
            continue
        highest = max(highest, high)

        # Fix1: Close確定
        if close <= atr_floor:
            if stop_at is not None and d == stop_at:
                # current mode: トリガーされた状態を返す
                return _build_holding_status(
                    atr_floor, True, choch_exit_price, False,
                    trail_active, trail_stop_price, highest,
                    entry_price, close, d - entry_idx, "ATR_Floor")
            if choch_exit_price is not None:
                blended = choch_exit_price * 0.5 + close * 0.5
                return TradeResult(d, blended, "ATR_Floor(partial)")
            return TradeResult(d, close, "ATR_Floor")

        # CHoCH + Mirror チェック
        mirror_triggered = False
        for c in choch_signals:
            if c.type == CHoCHType.BEARISH and c.index == d:
                # Fix3: Bearish CHoCHで50%記録
                if choch_exit_price is None:
                    choch_exit_price = close

                e8 = df['EMA_8'].iloc[d]
                e21 = df['EMA_21'].iloc[d]
                if not pd.isna(e8) and not pd.isna(e21) and e8 < e21:
                    if stop_at is not None and d == stop_at:
                        return _build_holding_status(
                            atr_floor, False, choch_exit_price, True,
                            trail_active, trail_stop_price, highest,
                            entry_price, close, d - entry_idx, "Mirror_Partial")
                    if choch_exit_price is not None:
                        blended = choch_exit_price * 0.5 + close * 0.5
                        return TradeResult(d, blended, "Mirror_Partial")
                    return TradeResult(d, close, "Mirror_Full")
                mirror_triggered = True

        if not trail_active:
            e21 = df['EMA_21'].iloc[d]
            if not pd.isna(e21) and close > e21 * 1.05:
                trail_active = True

        if trail_active:
            ema10 = df['Close'].iloc[max(0, d - 10):d + 1].ewm(span=10, adjust=False).mean().iloc[-1]
            trail_base = ema10 * 0.7 + highest * 0.3
            trail_stop_price = trail_base - atr_now * trail_mult
            if low <= trail_stop_price:
                exit_price = max(trail_stop_price, low)
                if stop_at is not None and d == stop_at:
                    return _build_holding_status(
                        atr_floor, False, choch_exit_price, False,
                        trail_active, trail_stop_price, highest,
                        entry_price, close, d - entry_idx, "Trail_Stop")
                if choch_exit_price is not None:
                    blended = choch_exit_price * 0.5 + exit_price * 0.5
                    return TradeResult(d, blended, "Trail_Stop(partial)")
                return TradeResult(d, exit_price, "Trail_Stop")

    # ループ完了
    if stop_at is not None:
        # current mode: まだExitしてない状態
        current_close = df['Close'].iloc[min(stop_at, len(df) - 1)]
        if pd.isna(current_close):
            current_close = entry_price
        ema_death = False
        if stop_at < len(df):
            e8 = df['EMA_8'].iloc[stop_at]
            e21 = df['EMA_21'].iloc[stop_at]
            if not pd.isna(e8) and not pd.isna(e21):
                ema_death = e8 < e21

        # 最も近いExit条件を判定
        nearest = None
        if stop_at >= max_day:
            nearest = "Time_Stop"
        return _build_holding_status(
            atr_floor, False, choch_exit_price, ema_death,
            trail_active, trail_stop_price, highest,
            entry_price, current_close, min(stop_at, max_day) - entry_idx, nearest)

    # trade mode: Time Stop
    # Guard: エントリーがデータ末尾付近でループ未実行の場合はトレード未完了
    if max_day <= entry_idx:
        return None
    exit_price = df['Close'].iloc[max_day]
    if choch_exit_price is not None:
        blended = choch_exit_price * 0.5 + exit_price * 0.5
        return TradeResult(max_day, blended, "Time_Stop(partial)")
    return TradeResult(max_day, exit_price, "Time_Stop")


def _build_holding_status(atr_floor, atr_triggered, choch_exit_price, ema_death,
                          trail_active, trail_stop_price, highest,
                          entry_price, current_close, holding_days, nearest):
    return HoldingStatus(
        atr_floor_price=atr_floor,
        atr_floor_triggered=atr_triggered,
        partial_exit_done=choch_exit_price is not None,
        bearish_choch_detected=choch_exit_price is not None,
        ema_death_cross=ema_death,
        trail_active=trail_active,
        trail_stop_price=trail_stop_price,
        highest_price=highest,
        unrealized_pct=(current_close / entry_price - 1) * 100 if entry_price > 0 else 0,
        holding_days=holding_days,
        nearest_exit_reason=nearest,
    )


def evaluate_trade(df, entry_idx, entry_price, entry_atr, regime, choch_signals):
    """
    バックテスト exit_patternB と同一のループ。
    完了トレードの結果を TradeResult で返す。
    """
    return _run_exit_loop(df, entry_idx, entry_price, entry_atr, regime, choch_signals)


def evaluate_current(df, entry_idx, entry_price, entry_atr, regime, choch_signals, current_idx):
    """
    保有中ポジションの現在状態を評価。
    evaluate_trade と同じループだが current_idx で打ち切り HoldingStatus を返す。
    """
    return _run_exit_loop(df, entry_idx, entry_price, entry_atr, regime, choch_signals,
                          stop_at=current_idx)
