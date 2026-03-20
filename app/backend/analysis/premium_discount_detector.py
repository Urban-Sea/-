"""
Premium/Discount Zone Detector

Coarse粒度のswing高値/安値からDealing Rangeを定義し、
現在価格がPremium（割高）かDiscount（割安）かを判定する。

表示専用（chart marker）。Entry/Exitの自動判定には使わない。
日足SMC概念は情報表示としてのみ有効（バックテスト検証済み）。
"""

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class PremiumDiscountZone:
    """Dealing Range内の現在価格位置"""
    swing_high: float           # Coarse swing high (Range上端)
    swing_low: float            # Coarse swing low (Range下端)
    equilibrium: float          # (high + low) / 2
    current_price: float
    position: float             # 0.0 (下端) 〜 1.0 (上端)
    zone: str                   # 'PREMIUM' / 'DISCOUNT' / 'EQUILIBRIUM'
    swing_high_date: Optional[str] = None
    swing_low_date: Optional[str] = None


class PremiumDiscountCalculator:
    """
    Coarse swing から Dealing Range を算出し、
    現在価格の位置（Premium/Discount/Equilibrium）を判定する。

    Equilibrium band: ±2% (position 0.48〜0.52)
    """

    def __init__(self, equilibrium_band: float = 0.02):
        self.equilibrium_band = equilibrium_band

    def calculate(
        self,
        swing_highs: list,
        swing_lows: list,
        current_price: float,
    ) -> Optional[PremiumDiscountZone]:
        """
        Premium/Discount zone を計算する。

        Args:
            swing_highs: coarse粒度のswing high リスト（index昇順）
            swing_lows: coarse粒度のswing low リスト（index昇順）
            current_price: 現在価格

        Returns:
            PremiumDiscountZone or None (swingが不足する場合)
        """
        if not swing_highs or not swing_lows:
            return None

        # 最新のcoarse swing high/low を取得
        sh = swing_highs[-1]
        sl = swing_lows[-1]

        high_price = sh.price
        low_price = sl.price
        range_size = high_price - low_price

        if range_size <= 0:
            return None

        equilibrium = (high_price + low_price) / 2
        position = max(0.0, min(1.0, (current_price - low_price) / range_size))

        # Zone判定
        mid = 0.5
        if position > mid + self.equilibrium_band:
            zone = 'PREMIUM'
        elif position < mid - self.equilibrium_band:
            zone = 'DISCOUNT'
        else:
            zone = 'EQUILIBRIUM'

        return PremiumDiscountZone(
            swing_high=round(high_price, 2),
            swing_low=round(low_price, 2),
            equilibrium=round(equilibrium, 2),
            current_price=round(current_price, 2),
            position=round(position, 4),
            zone=zone,
            swing_high_date=getattr(sh, 'date', None),
            swing_low_date=getattr(sl, 'date', None),
        )
