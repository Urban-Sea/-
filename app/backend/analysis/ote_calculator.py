"""
OTE (Optimal Trade Entry) Calculator — V11 Phase 2

SMC/ICT概念: CHoCH/BOS後のインパルスに対するFib 62-79%リトレースメント。
「この価格帯まで引きつけて待つ」という具体的なEntry位置を提供する。

設計: concurrent-coalescing-torvalds.md Phase 2
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple


@dataclass
class OTEZone:
    """OTEゾーン"""
    upper: float        # Fib 62% ライン（ゾーン上端）
    lower: float        # Fib 79% ライン（ゾーン下端）
    fib_62: float
    fib_79: float
    swing_a: float      # インパルス起点
    swing_b: float      # インパルス終点
    swing_a_idx: int
    swing_b_idx: int
    direction: str      # 'BULLISH' or 'BEARISH'
    status: str = 'ACTIVE'  # ACTIVE / EXPIRED
    created_at_idx: int = 0
    date: Optional[str] = None


# 定数
OTE_EXPIRY_BARS = 15    # CHoCHから何本以内に到達しなければ無効か
FIB_62 = 0.62
FIB_79 = 0.79


class OTECalculator:
    """
    OTEゾーン算出器。

    CHoCHシグナルとswingデータから、最適なリトレースメント・エントリー
    ゾーン（Fib 62-79%）を計算する。
    """

    def __init__(self, expiry_bars: int = OTE_EXPIRY_BARS):
        self.expiry_bars = expiry_bars

    def calculate(
        self,
        choch_events: List[dict],
        swing_highs: list,
        swing_lows: list,
        current_idx: int,
    ) -> List[OTEZone]:
        """
        CHoCHイベントからOTEゾーンを算出。

        Args:
            choch_events: [{'index': int, 'type': 'BULLISH'|'BEARISH',
                           'price': float, 'previous_swing': float}, ...]
            swing_highs: SwingPoint list (index昇順)
            swing_lows: SwingPoint list (index昇順)
            current_idx: 現在のbar index

        Returns:
            アクティブなOTEZoneリスト
        """
        zones: List[OTEZone] = []

        for event in choch_events:
            choch_idx = event['index']
            choch_type = event['type']

            # 有効期限チェック
            if current_idx - choch_idx > self.expiry_bars:
                continue

            zone = None
            if choch_type == 'BULLISH':
                zone = self._calc_bullish_ote(event, swing_highs, swing_lows)
            elif choch_type == 'BEARISH':
                zone = self._calc_bearish_ote(event, swing_highs, swing_lows)

            if zone is not None:
                # 有効期限
                if current_idx - zone.created_at_idx > self.expiry_bars:
                    zone.status = 'EXPIRED'
                if zone.status == 'ACTIVE':
                    zones.append(zone)

        return zones

    def _calc_bullish_ote(
        self,
        event: dict,
        swing_highs: list,
        swing_lows: list,
    ) -> Optional[OTEZone]:
        """
        Bullish OTE計算。

        Bullish CHoCH後:
          A = SL2 (CHoCH起点 = Higher Low)
          B = SH2 (CHoCHブレイク確認の高値)
          OTE = B からの 62-79% リトレースメント
        """
        choch_idx = event['index']
        # A = CHoCHのswing low（CHoCH起点）
        # eventのprice = SL2の価格, previous_swing = SL1の価格
        a_price = event['price']

        # B = CHoCH idx 以降の最初のswing high
        b_point = None
        for sh in swing_highs:
            if sh.index > choch_idx:
                b_point = sh
                break

        if b_point is None:
            # swing highがまだ確定していない → CHoCH idx 以降の最高値で近似
            return None

        b_price = b_point.price

        if b_price <= a_price:
            return None

        # OTEゾーン計算
        impulse = b_price - a_price
        fib_62_level = b_price - impulse * FIB_62
        fib_79_level = b_price - impulse * FIB_79

        return OTEZone(
            upper=round(fib_62_level, 4),
            lower=round(fib_79_level, 4),
            fib_62=round(fib_62_level, 4),
            fib_79=round(fib_79_level, 4),
            swing_a=a_price,
            swing_b=b_price,
            swing_a_idx=choch_idx,
            swing_b_idx=b_point.index,
            direction='BULLISH',
            created_at_idx=choch_idx,
            date=getattr(b_point, 'date', None),
        )

    def _calc_bearish_ote(
        self,
        event: dict,
        swing_highs: list,
        swing_lows: list,
    ) -> Optional[OTEZone]:
        """
        Bearish OTE計算。

        Bearish CHoCH後:
          A = SH2 (CHoCH起点 = Lower High)
          B = SL2 (CHoCHブレイク確認の安値)
          OTE = B からの 62-79% リトレースメント（上向き）
        """
        choch_idx = event['index']
        a_price = event['price']

        # B = CHoCH idx 以降の最初のswing low
        b_point = None
        for sl in swing_lows:
            if sl.index > choch_idx:
                b_point = sl
                break

        if b_point is None:
            return None

        b_price = b_point.price

        if b_price >= a_price:
            return None

        impulse = a_price - b_price
        fib_62_level = b_price + impulse * FIB_62
        fib_79_level = b_price + impulse * FIB_79

        return OTEZone(
            upper=round(fib_79_level, 4),
            lower=round(fib_62_level, 4),
            fib_62=round(fib_62_level, 4),
            fib_79=round(fib_79_level, 4),
            swing_a=a_price,
            swing_b=b_price,
            swing_a_idx=choch_idx,
            swing_b_idx=b_point.index,
            direction='BEARISH',
            created_at_idx=choch_idx,
            date=getattr(b_point, 'date', None),
        )

    def is_in_ote_zone(self, price: float, zones: List[OTEZone], direction: str = 'BULLISH') -> bool:
        """価格がアクティブなOTEゾーン内にいるか判定"""
        for zone in zones:
            if zone.direction == direction and zone.status == 'ACTIVE':
                if zone.lower <= price <= zone.upper:
                    return True
        return False

    def compute_confluence(
        self,
        price: float,
        ote_zones: List[OTEZone],
        ob_zones: list,
        fvg_list: list,
        in_discount: bool = False,
    ) -> int:
        """
        OBとの合流（confluence）スコアを計算。

        Returns:
            confluence score (0-4)
        """
        score = 0

        # OTE内か
        in_ote = any(
            z.status == 'ACTIVE' and z.lower <= price <= z.upper
            for z in ote_zones
        )
        if not in_ote:
            return 0

        # OTEゾーンとOBゾーンの重複
        for z in ote_zones:
            if z.status != 'ACTIVE':
                continue
            for ob in ob_zones:
                if hasattr(ob, 'status') and ob.status != 'ACTIVE':
                    continue
                # 重複判定
                ob_high = ob.zone_high if hasattr(ob, 'zone_high') else ob.get('zone_high', 0)
                ob_low = ob.zone_low if hasattr(ob, 'zone_low') else ob.get('zone_low', 0)
                if z.lower <= ob_high and ob_low <= z.upper:
                    score += 2
                    break

        # OTEゾーン内にFVGがあるか
        for z in ote_zones:
            if z.status != 'ACTIVE':
                continue
            for fvg in fvg_list:
                fvg_top = fvg.get('top', 0)
                fvg_bottom = fvg.get('bottom', 0)
                if z.lower <= fvg_top and fvg_bottom <= z.upper:
                    score += 1
                    break

        # Discountゾーン内
        if in_discount:
            score += 1

        return score
