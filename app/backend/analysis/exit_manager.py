"""
Exit Manager - V13 Exit System (2モード対応)

Exit モード:
- stable: V13フル (highest base + drawdown tighten + profit tiers) — 安定重視
- standard: Hybrid_30 (含み益≤30%→V13, >30%→V12緩トレイル) — バランス最強、デフォルト

5年150銘柄5,480トレード検証:
  stable:   勝率73.0%, PF 6.59, 平均+6.1%, 取逃し9.4%
  standard: 勝率73.0%, PF 8.59, 平均+8.3%, 取逃し12.3%

4層Exit:
1. ATR_Floor: entry_price - ATR×3.0, Close確定
2. Mirror: Bearish CHoCH → 50%記録, EMA8<EMA21 → 残り50%
3. Trail_Stop: EMA21×1.05超で有効化, モードに応じたadaptive trail
4. Time_Stop: 252営業日
"""

from dataclasses import dataclass
from typing import Optional

import pandas as pd

from analysis.choch_detector import CHoCHType


# Exit モード定数
EXIT_MODE_STABLE = "stable"
EXIT_MODE_STANDARD = "standard"
_EXIT_MODES = {EXIT_MODE_STABLE, EXIT_MODE_STANDARD}


@dataclass
class TradeResult:
    """evaluate_trade の戻り値"""
    exit_idx: int
    exit_price: float
    exit_reason: str  # ATR_Floor, Mirror_Full, Trail_Stop, Time_Stop etc.
    partial_exit_idx: Optional[int] = None      # CHoCH 50%売却日の index
    partial_exit_price: Optional[float] = None   # CHoCH 50%売却時の価格


@dataclass
class HoldingStatus:
    """evaluate_current の戻り値（保有中ポジションの状態）"""
    # ATR Floor
    atr_floor_price: float
    atr_floor_triggered: bool

    # Mirror（部分利確）
    partial_exit_done: bool
    bearish_choch_detected: bool
    choch_exit_idx: Optional[int]  # CHoCH検出日のインデックス（50%売却日）
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
                   *, stop_at=None, exit_mode=EXIT_MODE_STANDARD):
    """
    4層Exitの共通ループ。

    stop_at=None: 最後まで走り TradeResult を返す (evaluate_trade用)
    stop_at=int:  そのインデックスで打ち切り HoldingStatus を返す (evaluate_current用)

    exit_mode:
      stable:   V13フル — タイトなトレイルで安定重視
      standard: Hybrid_30 — 含み益>30%でV12緩トレイルに切替、バランス最強
    """
    base_trail_mult = TRAIL_MULT.get(regime, 3.0)
    atr_floor = entry_price - entry_atr * 3.0
    max_day = min(entry_idx + 252, len(df) - 1)
    highest = entry_price
    trail_active = False
    choch_exit_price = None
    choch_exit_idx = None
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
                return _build_holding_status(
                    atr_floor, True, choch_exit_price, choch_exit_idx, False,
                    trail_active, trail_stop_price, highest,
                    entry_price, close, d - entry_idx, "ATR_Floor")
            if choch_exit_price is not None:
                return TradeResult(d, close, "ATR_Floor", choch_exit_idx, choch_exit_price)
            return TradeResult(d, close, "ATR_Floor")

        # CHoCH + Mirror チェック
        mirror_triggered = False
        for c in choch_signals:
            if c.type == CHoCHType.BEARISH and c.index == d:
                # Fix3: Bearish CHoCHで50%記録
                if choch_exit_price is None:
                    choch_exit_price = close
                    choch_exit_idx = d

                e8 = df['EMA_8'].iloc[d]
                e21 = df['EMA_21'].iloc[d]
                if not pd.isna(e8) and not pd.isna(e21) and e8 < e21:
                    if stop_at is not None and d == stop_at:
                        return _build_holding_status(
                            atr_floor, False, choch_exit_price, choch_exit_idx, True,
                            trail_active, trail_stop_price, highest,
                            entry_price, close, d - entry_idx, "Mirror_Partial")
                    if choch_exit_price is not None:
                        return TradeResult(d, close, "Mirror_Full", choch_exit_idx, choch_exit_price)
                    return TradeResult(d, close, "Mirror_Full")
                mirror_triggered = True

        if not trail_active:
            e21 = df['EMA_21'].iloc[d]
            if not pd.isna(e21) and close > e21 * 1.05:
                trail_active = True

        if trail_active:
            pnl_pct = (close - entry_price) / entry_price * 100 if entry_price > 0 else 0

            # Hybrid_30: 含み益>30%でV12緩トレイルに切替
            use_v12_trail = (exit_mode == EXIT_MODE_STANDARD and pnl_pct > 30)

            if use_v12_trail:
                # V12: EMA10ブレンド + 固定mult（緩い＝大波に乗る）
                ema10 = df['Close'].iloc[max(0, d - 10):d + 1].ewm(span=10, adjust=False).mean().iloc[-1]
                trail_base = ema10 * 0.7 + highest * 0.3
                trail_mult = base_trail_mult
            else:
                # V13: highest base + drawdown tighten + profit tiers（タイト＝安定）
                trail_base = highest
                trail_mult = base_trail_mult
                dd_pct = (highest - close) / highest * 100 if highest > 0 else 0
                if dd_pct > 15:
                    trail_mult *= 0.4
                elif dd_pct > 10:
                    trail_mult *= 0.6
                elif dd_pct > 5:
                    trail_mult *= 0.8

                if pnl_pct > 50:
                    trail_mult = min(trail_mult, 1.0)
                elif pnl_pct > 30:
                    trail_mult = min(trail_mult, 1.5)
                elif pnl_pct > 15:
                    trail_mult = min(trail_mult, 2.0)

            trail_stop_price = trail_base - atr_now * trail_mult
            if low <= trail_stop_price:
                exit_price = max(trail_stop_price, low)
                if stop_at is not None and d == stop_at:
                    return _build_holding_status(
                        atr_floor, False, choch_exit_price, choch_exit_idx, False,
                        trail_active, trail_stop_price, highest,
                        entry_price, close, d - entry_idx, "Trail_Stop")
                if choch_exit_price is not None:
                    return TradeResult(d, exit_price, "Trail_Stop", choch_exit_idx, choch_exit_price)
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

        # 最も近いExit条件を判定（実際に252日以上保有した場合のみ）
        nearest = None
        if stop_at - entry_idx >= 252:
            nearest = "Time_Stop"
        return _build_holding_status(
            atr_floor, False, choch_exit_price, choch_exit_idx, ema_death,
            trail_active, trail_stop_price, highest,
            entry_price, current_close, min(stop_at, max_day) - entry_idx, nearest)

    # trade mode: Time Stop
    # Guard: データが252日分に満たない場合はトレード未完了（データ末尾到達≠Time Stop）
    if max_day - entry_idx < 252:
        return None
    exit_price = df['Close'].iloc[max_day]
    if choch_exit_price is not None:
        return TradeResult(max_day, exit_price, "Time_Stop", choch_exit_idx, choch_exit_price)
    return TradeResult(max_day, exit_price, "Time_Stop")


def _build_holding_status(atr_floor, atr_triggered, choch_exit_price, choch_exit_idx, ema_death,
                          trail_active, trail_stop_price, highest,
                          entry_price, current_close, holding_days, nearest):
    return HoldingStatus(
        atr_floor_price=atr_floor,
        atr_floor_triggered=atr_triggered,
        partial_exit_done=choch_exit_price is not None,
        bearish_choch_detected=choch_exit_price is not None,
        choch_exit_idx=choch_exit_idx,
        ema_death_cross=ema_death,
        trail_active=trail_active,
        trail_stop_price=trail_stop_price,
        highest_price=highest,
        unrealized_pct=(current_close / entry_price - 1) * 100 if entry_price > 0 else 0,
        holding_days=holding_days,
        nearest_exit_reason=nearest,
    )


def evaluate_trade(df, entry_idx, entry_price, entry_atr, regime, choch_signals,
                   exit_mode=EXIT_MODE_STANDARD):
    """
    完了トレードの結果を TradeResult で返す。
    exit_mode: "stable" (V13安定) or "standard" (Hybrid_30バランス, デフォルト)
    """
    return _run_exit_loop(df, entry_idx, entry_price, entry_atr, regime, choch_signals,
                          exit_mode=exit_mode)


def evaluate_current(df, entry_idx, entry_price, entry_atr, regime, choch_signals, current_idx,
                     exit_mode=EXIT_MODE_STANDARD):
    """
    保有中ポジションの現在状態を評価。
    evaluate_trade と同じループだが current_idx で打ち切り HoldingStatus を返す。
    exit_mode: "stable" (V13安定) or "standard" (Hybrid_30バランス, デフォルト)
    """
    return _run_exit_loop(df, entry_idx, entry_price, entry_atr, regime, choch_signals,
                          stop_at=current_idx, exit_mode=exit_mode)
