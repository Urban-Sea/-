"""
Order Block (OB) Detector — V11 Phase 2

SMC/ICT概念: 構造転換（BOS/CHoCH）の起点となった最後の逆方向キャンドル。
大口プレイヤーのポジションが集中する価格帯を検出する。

設計: concurrent-coalescing-torvalds.md Phase 2
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd


@dataclass
class OrderBlock:
    """Order Block"""
    index: int              # OB足のindex
    direction: str          # 'BULLISH' or 'BEARISH'
    zone_high: float        # ゾーン上端
    zone_low: float         # ゾーン下端
    date: Optional[str] = None
    freshness: float = 1.0  # 鮮度 (0.3〜1.0)
    cisd_confirmed: bool = False  # CISD確認済みか
    status: str = 'ACTIVE'  # ACTIVE / INVALIDATED
    created_at: int = 0     # 作成時のindex


# 定数
MAX_OB_LOOKBACK = 5     # ブレイク足から最大何本遡るか
CISD_MAX_BARS = 5       # CISD確認の最大本数
MIN_BODY_ATR_RATIO = 0.5  # OB足の最小実体サイズ（ATR比）


class OrderBlockDetector:
    """
    Order Block検出器。

    BOS/CHoCHイベントのbreak_indexを受け取り、
    その起点となったOB足を探索・検出する。
    """

    def __init__(
        self,
        max_ob_lookback: int = MAX_OB_LOOKBACK,
        cisd_max_bars: int = CISD_MAX_BARS,
        min_body_atr_ratio: float = MIN_BODY_ATR_RATIO,
    ):
        self.max_ob_lookback = max_ob_lookback
        self.cisd_max_bars = cisd_max_bars
        self.min_body_atr_ratio = min_body_atr_ratio

    def detect(
        self,
        df: pd.DataFrame,
        break_events: List[dict],
        atr: Optional[np.ndarray] = None,
    ) -> List[OrderBlock]:
        """
        OHLCデータとBOS/CHoCHブレイクイベントからOBを検出。

        Args:
            df: OHLCV DataFrame
            break_events: [{'index': int, 'direction': 'BULLISH'|'BEARISH'}, ...]
                         BOS/CHoCHのブレイク足情報
            atr: ATR配列（Noneなら内部で計算）

        Returns:
            OrderBlockリスト（アクティブなもののみ）
        """
        opens = df['Open'].values
        highs = df['High'].values
        lows = df['Low'].values
        closes = df['Close'].values
        dates = df['Date'].values if 'Date' in df.columns else [None] * len(df)

        if atr is None:
            atr = self._compute_atr(highs, lows, closes)

        obs: List[OrderBlock] = []

        for event in break_events:
            break_idx = event['index']
            direction = event['direction']

            if break_idx < 1 or break_idx >= len(df):
                continue

            ob = self._find_ob_candle(
                opens, highs, lows, closes, dates, atr,
                break_idx, direction,
            )
            if ob is not None:
                # CISD確認
                ob.cisd_confirmed = self._check_cisd(
                    highs, lows, closes, ob, break_idx, direction,
                )
                obs.append(ob)

        # 無効化判定: 価格がOBゾーンを実体で完全貫通
        current_idx = len(df) - 1
        active_obs = []
        for ob in obs:
            invalidated = False
            for j in range(ob.index + 1, len(df)):
                if ob.direction == 'BULLISH':
                    # 価格がOBゾーン下端を実体で下抜け → 無効
                    if closes[j] < ob.zone_low:
                        invalidated = True
                        break
                else:
                    # 価格がOBゾーン上端を実体で上抜け → 無効
                    if closes[j] > ob.zone_high:
                        invalidated = True
                        break

            if invalidated:
                ob.status = 'INVALIDATED'
            else:
                # 鮮度計算
                age = current_idx - ob.created_at
                if age <= 5:
                    ob.freshness = 1.0
                elif age <= 10:
                    ob.freshness = 0.8
                elif age <= 20:
                    ob.freshness = 0.5
                else:
                    ob.freshness = 0.3
                active_obs.append(ob)

        return active_obs

    def _find_ob_candle(
        self,
        opens: np.ndarray,
        highs: np.ndarray,
        lows: np.ndarray,
        closes: np.ndarray,
        dates,
        atr: np.ndarray,
        break_idx: int,
        direction: str,
    ) -> Optional[OrderBlock]:
        """ブレイク足から遡り、OB足を探す"""
        start = max(0, break_idx - self.max_ob_lookback)

        for i in range(break_idx - 1, start - 1, -1):
            body = abs(closes[i] - opens[i])
            atr_val = atr[i] if i < len(atr) and not np.isnan(atr[i]) else 0

            # 実体サイズフィルタ
            if atr_val > 0 and body < atr_val * self.min_body_atr_ratio:
                continue

            if direction == 'BULLISH':
                # Bullish OB: 最後の陰線を探す
                if closes[i] < opens[i]:
                    return OrderBlock(
                        index=i,
                        direction='BULLISH',
                        zone_high=float(opens[i]),   # 実体上端
                        zone_low=float(lows[i]),
                        date=str(dates[i]) if dates[i] is not None else None,
                        created_at=i,
                    )
            else:
                # Bearish OB: 最後の陽線を探す
                if closes[i] > opens[i]:
                    return OrderBlock(
                        index=i,
                        direction='BEARISH',
                        zone_high=float(highs[i]),
                        zone_low=float(closes[i]),   # 実体下端
                        date=str(dates[i]) if dates[i] is not None else None,
                        created_at=i,
                    )

        return None

    def _check_cisd(
        self,
        highs: np.ndarray,
        lows: np.ndarray,
        closes: np.ndarray,
        ob: OrderBlock,
        break_idx: int,
        direction: str,
    ) -> bool:
        """
        CISD（Change In State of Delivery）確認。
        OB足の後、直近構造を実体でブレイクしているか。
        """
        end = min(ob.index + self.cisd_max_bars + 1, len(closes))

        if direction == 'BULLISH':
            # OB足前のSwing High（簡易: OB足前5本の最高値）
            lookback_start = max(0, ob.index - 5)
            ref_high = max(highs[lookback_start:ob.index + 1])
            for j in range(ob.index + 1, end):
                if closes[j] > ref_high:
                    return True
        else:
            lookback_start = max(0, ob.index - 5)
            ref_low = min(lows[lookback_start:ob.index + 1])
            for j in range(ob.index + 1, end):
                if closes[j] < ref_low:
                    return True

        return False

    def is_in_ob_zone(self, price: float, obs: List[OrderBlock], direction: str = 'BULLISH') -> bool:
        """価格がアクティブなOBゾーン内にいるか判定"""
        for ob in obs:
            if ob.direction == direction and ob.status == 'ACTIVE':
                if ob.zone_low <= price <= ob.zone_high:
                    return True
        return False

    def get_active_obs_at(
        self,
        obs: List[OrderBlock],
        current_idx: int,
        direction: Optional[str] = None,
    ) -> List[OrderBlock]:
        """指定インデックス時点のアクティブOBを返す"""
        result = []
        for ob in obs:
            if ob.status == 'ACTIVE' and ob.index <= current_idx:
                if direction is None or ob.direction == direction:
                    result.append(ob)
        return result

    @staticmethod
    def _compute_atr(
        highs: np.ndarray,
        lows: np.ndarray,
        closes: np.ndarray,
        period: int = 14,
    ) -> np.ndarray:
        """ATR計算"""
        tr = np.maximum(
            highs - lows,
            np.maximum(
                np.abs(highs - np.roll(closes, 1)),
                np.abs(lows - np.roll(closes, 1)),
            ),
        )
        tr[0] = highs[0] - lows[0]
        atr = pd.Series(tr).rolling(window=period).mean().values
        return atr
