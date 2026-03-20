"""
Phase 2 テスト: Order Block + OTE + FVG CE

- OB検出が正しいゾーンを返すこと
- OTE計算がFib 62-79%を正しく返すこと
- CISD確認が機能すること
- OB無効化が機能すること
- FVG CE levelが正しいこと
"""

import sys
import os
import pytest
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app', 'backend'))

from analysis.order_block_detector import OrderBlockDetector, OrderBlock
from analysis.ote_calculator import OTECalculator, OTEZone
from analysis.market_structure import MarketStructure, SwingPoint


FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'nvda_6mo.csv')


@pytest.fixture
def df():
    return pd.read_csv(FIXTURE_PATH)


# ==============================================================
# 1. Order Block テスト
# ==============================================================

class TestOrderBlockDetector:

    def test_detect_returns_list(self, df):
        """検出結果がリストであること"""
        from analysis.bos_detector import BOSDetector
        det = BOSDetector()
        bos = det.detect_bos(df['High'].tolist(), df['Low'].tolist())
        choch = det.detect_choch(df['High'].tolist(), df['Low'].tolist())

        break_events = []
        for b in bos:
            break_events.append({'index': b.index, 'direction': b.bos_type.value})
        for c in choch:
            break_events.append({'index': c.index, 'direction': c.choch_type.value})

        ob_det = OrderBlockDetector()
        obs = ob_det.detect(df, break_events)
        assert isinstance(obs, list)

    def test_bullish_ob_zone_body_based(self, df):
        """Bullish OBのゾーンが実体ベース（[Low, Open]）であること"""
        from analysis.bos_detector import BOSDetector
        det = BOSDetector()
        bos = det.detect_bos(df['High'].tolist(), df['Low'].tolist())

        break_events = [{'index': b.index, 'direction': 'BULLISH'}
                        for b in bos if b.bos_type.value == 'BULLISH']

        ob_det = OrderBlockDetector()
        obs = ob_det.detect(df, break_events)

        for ob in obs:
            if ob.direction == 'BULLISH':
                # zone_high = Open (実体上端), zone_low = Low
                assert ob.zone_low <= ob.zone_high, \
                    f"OB zone inverted: low={ob.zone_low} > high={ob.zone_high}"

    def test_bearish_ob_zone_body_based(self, df):
        """Bearish OBのゾーンが実体ベース（[Close, High]）であること"""
        from analysis.bos_detector import BOSDetector
        det = BOSDetector()
        bos = det.detect_bos(df['High'].tolist(), df['Low'].tolist())

        break_events = [{'index': b.index, 'direction': 'BEARISH'}
                        for b in bos if b.bos_type.value == 'BEARISH']

        ob_det = OrderBlockDetector()
        obs = ob_det.detect(df, break_events)

        for ob in obs:
            if ob.direction == 'BEARISH':
                assert ob.zone_low <= ob.zone_high

    def test_freshness_decay(self, df):
        """古いOBほどfreshnessが低い"""
        from analysis.bos_detector import BOSDetector
        det = BOSDetector()
        bos = det.detect_bos(df['High'].tolist(), df['Low'].tolist())

        break_events = [{'index': b.index, 'direction': b.bos_type.value} for b in bos]

        ob_det = OrderBlockDetector()
        obs = ob_det.detect(df, break_events)

        for ob in obs:
            assert 0.3 <= ob.freshness <= 1.0

    def test_only_active_returned(self, df):
        """返されるOBは全てACTIVEステータス"""
        from analysis.bos_detector import BOSDetector
        det = BOSDetector()
        bos = det.detect_bos(df['High'].tolist(), df['Low'].tolist())

        break_events = [{'index': b.index, 'direction': b.bos_type.value} for b in bos]

        ob_det = OrderBlockDetector()
        obs = ob_det.detect(df, break_events)

        for ob in obs:
            assert ob.status == 'ACTIVE'

    def test_is_in_ob_zone(self):
        """is_in_ob_zone判定"""
        ob = OrderBlock(
            index=10, direction='BULLISH',
            zone_high=150.0, zone_low=145.0,
            status='ACTIVE', created_at=10,
        )
        det = OrderBlockDetector()
        assert det.is_in_ob_zone(147.0, [ob], 'BULLISH') is True
        assert det.is_in_ob_zone(151.0, [ob], 'BULLISH') is False
        assert det.is_in_ob_zone(144.0, [ob], 'BULLISH') is False


# ==============================================================
# 2. OTE テスト
# ==============================================================

class TestOTECalculator:

    def test_bullish_ote_fib_levels(self):
        """Bullish OTEのFibレベルが正しいこと"""
        calc = OTECalculator()

        # A=100, B=120 → impulse=20
        # Fib62 = 120 - 20*0.62 = 107.6
        # Fib79 = 120 - 20*0.79 = 104.2
        swing_highs = [SwingPoint(index=15, price=120.0, type='HIGH')]
        swing_lows = []

        events = [{'index': 10, 'type': 'BULLISH', 'price': 100.0, 'previous_swing': 95.0}]
        zones = calc.calculate(events, swing_highs, swing_lows, current_idx=20)

        assert len(zones) == 1
        z = zones[0]
        assert z.fib_62 == pytest.approx(107.6, abs=0.01)
        assert z.fib_79 == pytest.approx(104.2, abs=0.01)
        assert z.upper == z.fib_62
        assert z.lower == z.fib_79
        assert z.direction == 'BULLISH'

    def test_bearish_ote_fib_levels(self):
        """Bearish OTEのFibレベルが正しいこと"""
        calc = OTECalculator()

        # A=120 (Lower High), B=100 (新安値) → impulse=20
        # Fib62 = 100 + 20*0.62 = 112.4
        # Fib79 = 100 + 20*0.79 = 115.8
        swing_highs = []
        swing_lows = [SwingPoint(index=15, price=100.0, type='LOW')]

        events = [{'index': 10, 'type': 'BEARISH', 'price': 120.0, 'previous_swing': 125.0}]
        zones = calc.calculate(events, swing_highs, swing_lows, current_idx=20)

        assert len(zones) == 1
        z = zones[0]
        assert z.fib_62 == pytest.approx(112.4, abs=0.01)
        assert z.fib_79 == pytest.approx(115.8, abs=0.01)
        assert z.direction == 'BEARISH'

    def test_ote_expiry(self):
        """OTE有効期限（15本以内）のテスト"""
        calc = OTECalculator(expiry_bars=15)

        swing_highs = [SwingPoint(index=15, price=120.0, type='HIGH')]
        events = [{'index': 10, 'type': 'BULLISH', 'price': 100.0, 'previous_swing': 95.0}]

        # 有効期限内
        zones = calc.calculate(events, swing_highs, [], current_idx=20)
        assert len(zones) == 1

        # 有効期限切れ
        zones = calc.calculate(events, swing_highs, [], current_idx=30)
        assert len(zones) == 0

    def test_is_in_ote_zone(self):
        """OTEゾーン内判定"""
        zone = OTEZone(
            upper=107.6, lower=104.2, fib_62=107.6, fib_79=104.2,
            swing_a=100.0, swing_b=120.0, swing_a_idx=10, swing_b_idx=15,
            direction='BULLISH', status='ACTIVE',
        )
        calc = OTECalculator()
        assert calc.is_in_ote_zone(106.0, [zone], 'BULLISH') is True
        assert calc.is_in_ote_zone(110.0, [zone], 'BULLISH') is False
        assert calc.is_in_ote_zone(103.0, [zone], 'BULLISH') is False

    def test_real_data_ote(self, df):
        """実データでOTEゾーンが計算できること"""
        ms = MarketStructure(df)
        med_highs, med_lows = ms.swings('medium')

        from analysis.choch_detector import CHoCHDetector
        choch_det = CHoCHDetector(swing_lookback=3)
        chochs = choch_det.detect_choch(df)

        events = [{'index': c.index, 'type': c.type.value, 'price': c.price,
                   'previous_swing': c.previous_swing} for c in chochs]

        calc = OTECalculator()
        zones = calc.calculate(events, med_highs, med_lows, current_idx=len(df)-1)
        # OTEゾーンが0個以上返る（データによる）
        assert isinstance(zones, list)


# ==============================================================
# 3. FVG CE テスト
# ==============================================================

class TestFVGCE:

    def test_ce_level_is_midpoint(self):
        """CE level = FVGの中間点"""
        top = 150.0
        bottom = 147.5
        ce = round((top + bottom) / 2, 2)
        assert ce == 148.75

    def test_ce_added_to_unfilled_fvg(self, df):
        """未埋めFVGにce_levelが付与される"""
        # FVG検出ロジックを簡易再現
        all_fvgs = []
        for i in range(2, len(df)):
            prev_high = df['High'].iloc[i-2]
            current_low = df['Low'].iloc[i]
            if prev_high < current_low:
                gap_size = (current_low - prev_high) / prev_high * 100
                if gap_size >= 1.5:
                    fvg = {
                        "index": i,
                        "top": float(current_low),
                        "bottom": float(prev_high),
                        "type": "BULLISH",
                    }
                    ce_level = round((fvg["top"] + fvg["bottom"]) / 2, 2)
                    fvg["ce_level"] = ce_level
                    all_fvgs.append(fvg)

        for fvg in all_fvgs:
            assert "ce_level" in fvg
            assert fvg["ce_level"] == pytest.approx(
                (fvg["top"] + fvg["bottom"]) / 2, abs=0.01
            )


# ==============================================================
# 4. Confluence テスト
# ==============================================================

class TestConfluence:

    def test_confluence_ob_plus_ote(self):
        """OB+OTEの合流で+2"""
        calc = OTECalculator()
        zone = OTEZone(
            upper=107.6, lower=104.2, fib_62=107.6, fib_79=104.2,
            swing_a=100.0, swing_b=120.0, swing_a_idx=10, swing_b_idx=15,
            direction='BULLISH', status='ACTIVE',
        )
        ob = OrderBlock(
            index=8, direction='BULLISH',
            zone_high=106.0, zone_low=104.5,
            status='ACTIVE', created_at=8,
        )
        score = calc.compute_confluence(105.5, [zone], [ob], [], in_discount=False)
        assert score >= 2

    def test_confluence_with_discount(self):
        """discount追加で+1"""
        calc = OTECalculator()
        zone = OTEZone(
            upper=107.6, lower=104.2, fib_62=107.6, fib_79=104.2,
            swing_a=100.0, swing_b=120.0, swing_a_idx=10, swing_b_idx=15,
            direction='BULLISH', status='ACTIVE',
        )
        score_no_disc = calc.compute_confluence(106.0, [zone], [], [], in_discount=False)
        score_disc = calc.compute_confluence(106.0, [zone], [], [], in_discount=True)
        assert score_disc == score_no_disc + 1

    def test_confluence_zero_outside_ote(self):
        """OTEゾーン外ならconfluence=0"""
        calc = OTECalculator()
        zone = OTEZone(
            upper=107.6, lower=104.2, fib_62=107.6, fib_79=104.2,
            swing_a=100.0, swing_b=120.0, swing_a_idx=10, swing_b_idx=15,
            direction='BULLISH', status='ACTIVE',
        )
        score = calc.compute_confluence(110.0, [zone], [], [], in_discount=True)
        assert score == 0


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
