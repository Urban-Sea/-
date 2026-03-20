"""
CHoCH (Change of Character) Detector V2

バックテスト結果に基づく最適化:
- CHoCH強度 2-5% が最良 (+45.7%, 勝率85%)
- 2連続CHoCH が勝率87%
- CHoCH後6-10本でBOS が勝率97%
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple
from enum import Enum
import pandas as pd
import numpy as np


class CHoCHType(Enum):
    BULLISH = "BULLISH"   # Higher Low
    BEARISH = "BEARISH"   # Lower High


class CHoCHQuality(Enum):
    EXCELLENT = "EXCELLENT"  # 強度2-5%, 2連続
    GOOD = "GOOD"           # 強度2-5% or 2連続
    WEAK = "WEAK"           # 条件不足
    INVALID = "INVALID"     # 強度<2%


@dataclass
class SwingPoint:
    index: int
    price: float
    type: str  # 'HIGH' or 'LOW'
    date: Optional[str] = None


@dataclass
class CHoCHSignal:
    """CHoCHシグナル"""
    index: int
    type: CHoCHType
    price: float
    previous_swing: float
    strength_pct: float
    consecutive_count: int = 1
    quality: CHoCHQuality = CHoCHQuality.WEAK
    date: Optional[str] = None

    # 追加情報（後から設定）
    bars_to_next_bos: int = 999
    has_fvg_nearby: bool = False


class CHoCHDetector:
    """CHoCH検出器"""

    def __init__(self, swing_lookback: int = 3):
        self.swing_lookback = swing_lookback

    def detect_swing_points(self, df: pd.DataFrame) -> List[SwingPoint]:
        """スイングポイント検出"""
        swings = []
        highs = df['High'].values
        lows = df['Low'].values
        dates = df['Date'].values if 'Date' in df.columns else [None] * len(df)

        lookback = self.swing_lookback

        for i in range(lookback, len(df) - lookback):
            # Swing High
            if highs[i] == max(highs[i-lookback:i+lookback+1]):
                swings.append(SwingPoint(
                    index=i,
                    price=highs[i],
                    type='HIGH',
                    date=str(dates[i]) if dates[i] is not None else None
                ))

            # Swing Low
            if lows[i] == min(lows[i-lookback:i+lookback+1]):
                swings.append(SwingPoint(
                    index=i,
                    price=lows[i],
                    type='LOW',
                    date=str(dates[i]) if dates[i] is not None else None
                ))

        return sorted(swings, key=lambda x: x.index)

    def detect_choch(self, df: pd.DataFrame, swings: Optional[List[SwingPoint]] = None) -> List[CHoCHSignal]:
        """
        CHoCH検出

        Bullish CHoCH = Higher Low（前回より高い安値）
        Bearish CHoCH = Lower High（前回より低い高値）
        """
        if swings is None:
            swings = self.detect_swing_points(df)

        choch_signals = []
        dates = df['Date'].values if 'Date' in df.columns else [None] * len(df)

        swing_highs = [s for s in swings if s.type == 'HIGH']
        swing_lows = [s for s in swings if s.type == 'LOW']

        # Bullish CHoCH: Higher Low
        for i in range(1, len(swing_lows)):
            if swing_lows[i].price > swing_lows[i-1].price:
                strength = (swing_lows[i].price - swing_lows[i-1].price) / swing_lows[i-1].price * 100

                # 連続カウント
                consecutive = 1
                for j in range(i-1, 0, -1):
                    if swing_lows[j].price > swing_lows[j-1].price:
                        consecutive += 1
                    else:
                        break

                quality = self._calculate_quality(strength, consecutive)

                choch_signals.append(CHoCHSignal(
                    index=swing_lows[i].index,
                    type=CHoCHType.BULLISH,
                    price=swing_lows[i].price,
                    previous_swing=swing_lows[i-1].price,
                    strength_pct=strength,
                    consecutive_count=consecutive,
                    quality=quality,
                    date=str(dates[swing_lows[i].index]) if dates[swing_lows[i].index] is not None else None
                ))

        # Bearish CHoCH: Lower High
        for i in range(1, len(swing_highs)):
            if swing_highs[i].price < swing_highs[i-1].price:
                strength = (swing_highs[i-1].price - swing_highs[i].price) / swing_highs[i-1].price * 100

                consecutive = 1
                for j in range(i-1, 0, -1):
                    if swing_highs[j].price < swing_highs[j-1].price:
                        consecutive += 1
                    else:
                        break

                quality = self._calculate_quality(strength, consecutive)

                choch_signals.append(CHoCHSignal(
                    index=swing_highs[i].index,
                    type=CHoCHType.BEARISH,
                    price=swing_highs[i].price,
                    previous_swing=swing_highs[i-1].price,
                    strength_pct=strength,
                    consecutive_count=consecutive,
                    quality=quality,
                    date=str(dates[swing_highs[i].index]) if dates[swing_highs[i].index] is not None else None
                ))

        return sorted(choch_signals, key=lambda x: x.index)

    def _calculate_quality(self, strength: float, consecutive: int) -> CHoCHQuality:
        """
        CHoCH品質計算

        バックテスト結果:
        - 強度2-5%が最良 (+45.7%)
        - 2連続が勝率87%
        """
        # 強度が弱すぎる
        if strength < 2.0:
            return CHoCHQuality.INVALID

        # 最良条件
        is_optimal_strength = 2.0 <= strength <= 5.0
        is_consecutive = consecutive >= 2

        if is_optimal_strength and is_consecutive:
            return CHoCHQuality.EXCELLENT
        elif is_optimal_strength or is_consecutive:
            return CHoCHQuality.GOOD
        else:
            return CHoCHQuality.WEAK

    def get_latest_bullish_choch(
        self,
        choch_signals: List[CHoCHSignal],
        current_idx: int,
        lookback: int = 20
    ) -> Optional[CHoCHSignal]:
        """直近のBullish CHoCHを取得"""
        for choch in reversed(choch_signals):
            if choch.type == CHoCHType.BULLISH:
                if current_idx - lookback <= choch.index < current_idx:
                    return choch
        return None

    def get_latest_bearish_choch(
        self,
        choch_signals: List[CHoCHSignal],
        current_idx: int,
        lookback: int = 10
    ) -> Optional[CHoCHSignal]:
        """直近のBearish CHoCHを取得（Exit警告用）"""
        for choch in reversed(choch_signals):
            if choch.type == CHoCHType.BEARISH:
                if current_idx - lookback <= choch.index < current_idx:
                    return choch
        return None

    def is_in_optimal_bos_window(
        self,
        choch: CHoCHSignal,
        current_idx: int
    ) -> Tuple[bool, int]:
        """
        CHoCH後のBOS最適ウィンドウ判定

        バックテスト結果: CHoCH後6-10本でBOSが勝率97%
        """
        bars_since_choch = current_idx - choch.index

        # 最適ウィンドウ: 6-10本
        if 6 <= bars_since_choch <= 10:
            return True, bars_since_choch
        # 許容ウィンドウ: 11-15本
        elif 11 <= bars_since_choch <= 15:
            return False, bars_since_choch  # まだEntry可能だが最適ではない
        else:
            return False, bars_since_choch


    def detect_choch_from_structure(self, ms) -> List[CHoCHSignal]:
        """
        MarketStructure経由でCHoCH検出（V11）。

        既存ロジック（detect_choch）と完全同一の判定。
        swingの計算をMarketStructureに委譲する点のみ異なる。

        Args:
            ms: MarketStructure インスタンス

        Returns:
            CHoCHSignalリスト（時系列順）
        """
        # MarketStructure.all_swingsはfine粒度の全swingをindex昇順で返す
        swings = ms.all_swings
        return self.detect_choch(ms.df, swings)


def create_choch_detector(swing_lookback: int = 3) -> CHoCHDetector:
    """CHoCH Detector作成"""
    return CHoCHDetector(swing_lookback=swing_lookback)
