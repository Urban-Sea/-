"""
MarketStructure — V11 SMC/ICT共通基盤

全SMC概念の土台。OHLCVから1回だけswing検出を行い、各検出器に提供する。
マルチ粒度swing（fine/medium/coarse）をサポートし、LRUキャッシュで再計算を防ぐ。

設計: concurrent-coalescing-torvalds.md Phase 0
"""

from collections import OrderedDict
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


@dataclass
class SwingPoint:
    """統一SwingPoint型（全検出器が共有）"""
    index: int
    price: float
    type: str           # 'HIGH' or 'LOW'
    date: Optional[str] = None


# 粒度名 → lookback値のマッピング
GRANULARITY_MAP: Dict[str, int] = {
    'fine': 3,      # 7本窓 — CHoCH/BOS（V10互換）
    'medium': 5,    # 11本窓 — OB/OTE
    'coarse': 8,    # 17本窓 — BSL/SSL/QM/Premium-Discount
}


class MarketStructure:
    """
    全SMC概念の共通基盤。

    - OHLCVから1回だけswingを計算しキャッシュ
    - fine/medium/coarse の3粒度を同時計算
    - 同一銘柄・同一日のインスタンスをクラスレベルでLRUキャッシュ
    """

    MAX_CACHE_SIZE = 50
    _cache: OrderedDict = OrderedDict()

    def __init__(
        self,
        df: pd.DataFrame,
        swing_lookbacks: Optional[List[int]] = None,
    ):
        """
        Args:
            df: OHLCV DataFrame（Date, Open, High, Low, Close, Volume）
            swing_lookbacks: 計算するlookback値リスト（デフォルト: [3, 5, 8]）
        """
        self.df = df
        self._lookbacks = swing_lookbacks or list(GRANULARITY_MAP.values())

        # 粒度別 swing を一括計算
        self._swings: Dict[int, Tuple[List[SwingPoint], List[SwingPoint]]] = {}
        for lb in self._lookbacks:
            self._swings[lb] = self._detect_swings(lb)

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------

    def swings(self, granularity: str = 'fine') -> Tuple[List[SwingPoint], List[SwingPoint]]:
        """
        指定粒度の (swing_highs, swing_lows) を返す。

        Args:
            granularity: 'fine' | 'medium' | 'coarse'

        Returns:
            (swing_highs, swing_lows) — 各リストはindex昇順
        """
        lb = GRANULARITY_MAP.get(granularity)
        if lb is None:
            raise ValueError(f"Unknown granularity: {granularity}. Use fine/medium/coarse")
        if lb not in self._swings:
            self._swings[lb] = self._detect_swings(lb)
        return self._swings[lb]

    @property
    def swing_highs(self) -> List[SwingPoint]:
        """fine粒度のswing highs（V10互換ショートカット）"""
        return self.swings('fine')[0]

    @property
    def swing_lows(self) -> List[SwingPoint]:
        """fine粒度のswing lows（V10互換ショートカット）"""
        return self.swings('fine')[1]

    @property
    def all_swings(self) -> List[SwingPoint]:
        """fine粒度の全swing（index昇順、CHoCHDetector互換）"""
        sh, sl = self.swings('fine')
        return sorted(sh + sl, key=lambda s: s.index)

    # ------------------------------------------------------------------
    # factory with LRU cache
    # ------------------------------------------------------------------

    @classmethod
    def get_or_create(
        cls,
        ticker: str,
        df: pd.DataFrame,
        **kwargs,
    ) -> 'MarketStructure':
        """
        同一銘柄・同一最終日のインスタンスをキャッシュから返す。

        Args:
            ticker: ティッカーシンボル
            df: OHLCV DataFrame
        """
        date_col = df['Date'].iloc[-1] if 'Date' in df.columns else str(len(df))
        key = (ticker, str(date_col), len(df))
        if key in cls._cache:
            cls._cache.move_to_end(key)
            return cls._cache[key]
        ms = cls(df, **kwargs)
        cls._cache[key] = ms
        while len(cls._cache) > cls.MAX_CACHE_SIZE:
            cls._cache.popitem(last=False)
        return ms

    @classmethod
    def clear_cache(cls):
        """テスト用: キャッシュをクリア"""
        cls._cache.clear()

    # ------------------------------------------------------------------
    # internal
    # ------------------------------------------------------------------

    def _detect_swings(self, lookback: int) -> Tuple[List[SwingPoint], List[SwingPoint]]:
        """
        V10と完全同一のswing検出アルゴリズム。

        highs[i] == max(highs[i-lb : i+lb+1]) で局所最大/最小を検出。
        CHoCHDetector.detect_swing_points / BOSDetector.detect_swing_points と同一ロジック。
        """
        highs = self.df['High'].values
        lows = self.df['Low'].values

        if 'Date' in self.df.columns:
            dates = self.df['Date'].values
        else:
            dates = [None] * len(self.df)

        swing_highs: List[SwingPoint] = []
        swing_lows: List[SwingPoint] = []

        for i in range(lookback, len(highs) - lookback):
            window_highs = highs[i - lookback: i + lookback + 1]
            if highs[i] == max(window_highs):
                swing_highs.append(SwingPoint(
                    index=i,
                    price=float(highs[i]),
                    type='HIGH',
                    date=str(dates[i]) if dates[i] is not None else None,
                ))

            window_lows = lows[i - lookback: i + lookback + 1]
            if lows[i] == min(window_lows):
                swing_lows.append(SwingPoint(
                    index=i,
                    price=float(lows[i]),
                    type='LOW',
                    date=str(dates[i]) if dates[i] is not None else None,
                ))

        return swing_highs, swing_lows
