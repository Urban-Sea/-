"""
Premium/Discount Zone テスト

- 基本計算（position, zone判定）
- エッジケース（空リスト、ゼロレンジ）
- 実データでのスモークテスト
"""

import sys
import os
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app', 'backend'))

from analysis.premium_discount_detector import PremiumDiscountCalculator, PremiumDiscountZone
from analysis.market_structure import MarketStructure, SwingPoint


FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'nvda_6mo.csv')


@pytest.fixture
def df():
    return pd.read_csv(FIXTURE_PATH)


class TestPremiumDiscountCalculator:
    """Premium/Discount Zone計算のテスト"""

    def test_discount_zone(self):
        """Dealing Rangeの下半分 → DISCOUNT"""
        calc = PremiumDiscountCalculator()
        highs = [SwingPoint(index=10, price=200.0, type='HIGH')]
        lows = [SwingPoint(index=5, price=100.0, type='LOW')]
        result = calc.calculate(highs, lows, current_price=120.0)
        assert result is not None
        assert result.zone == 'DISCOUNT'
        assert result.position == 0.2
        assert result.equilibrium == 150.0

    def test_premium_zone(self):
        """Dealing Rangeの上半分 → PREMIUM"""
        calc = PremiumDiscountCalculator()
        highs = [SwingPoint(index=10, price=200.0, type='HIGH')]
        lows = [SwingPoint(index=5, price=100.0, type='LOW')]
        result = calc.calculate(highs, lows, current_price=180.0)
        assert result is not None
        assert result.zone == 'PREMIUM'
        assert result.position == 0.8

    def test_equilibrium_zone(self):
        """中間付近 → EQUILIBRIUM"""
        calc = PremiumDiscountCalculator()
        highs = [SwingPoint(index=10, price=200.0, type='HIGH')]
        lows = [SwingPoint(index=5, price=100.0, type='LOW')]
        result = calc.calculate(highs, lows, current_price=150.0)
        assert result is not None
        assert result.zone == 'EQUILIBRIUM'
        assert result.position == 0.5

    def test_position_clamped_above(self):
        """現在価格がRange上端を超えている → position=1.0"""
        calc = PremiumDiscountCalculator()
        highs = [SwingPoint(index=10, price=200.0, type='HIGH')]
        lows = [SwingPoint(index=5, price=100.0, type='LOW')]
        result = calc.calculate(highs, lows, current_price=250.0)
        assert result is not None
        assert result.position == 1.0
        assert result.zone == 'PREMIUM'

    def test_position_clamped_below(self):
        """現在価格がRange下端を下回る → position=0.0"""
        calc = PremiumDiscountCalculator()
        highs = [SwingPoint(index=10, price=200.0, type='HIGH')]
        lows = [SwingPoint(index=5, price=100.0, type='LOW')]
        result = calc.calculate(highs, lows, current_price=50.0)
        assert result is not None
        assert result.position == 0.0
        assert result.zone == 'DISCOUNT'

    def test_empty_swings_returns_none(self):
        """Swingが空 → None"""
        calc = PremiumDiscountCalculator()
        assert calc.calculate([], [], 100.0) is None
        assert calc.calculate([SwingPoint(0, 100, 'HIGH')], [], 100.0) is None
        assert calc.calculate([], [SwingPoint(0, 100, 'LOW')], 100.0) is None

    def test_zero_range_returns_none(self):
        """High == Low → None"""
        calc = PremiumDiscountCalculator()
        highs = [SwingPoint(index=10, price=100.0, type='HIGH')]
        lows = [SwingPoint(index=5, price=100.0, type='LOW')]
        assert calc.calculate(highs, lows, current_price=100.0) is None

    def test_uses_latest_swings(self):
        """複数swing → 最新のswingを使う"""
        calc = PremiumDiscountCalculator()
        highs = [
            SwingPoint(index=5, price=150.0, type='HIGH'),
            SwingPoint(index=20, price=200.0, type='HIGH'),
        ]
        lows = [
            SwingPoint(index=3, price=80.0, type='LOW'),
            SwingPoint(index=15, price=100.0, type='LOW'),
        ]
        result = calc.calculate(highs, lows, current_price=150.0)
        assert result.swing_high == 200.0  # 最新
        assert result.swing_low == 100.0   # 最新

    def test_custom_equilibrium_band(self):
        """カスタムband幅でEQUILIBRIUM判定が変わる"""
        highs = [SwingPoint(index=10, price=200.0, type='HIGH')]
        lows = [SwingPoint(index=5, price=100.0, type='LOW')]

        # デフォルト(0.02): position=0.53 → PREMIUM
        narrow = PremiumDiscountCalculator(equilibrium_band=0.02)
        r1 = narrow.calculate(highs, lows, current_price=153.0)
        assert r1.zone == 'PREMIUM'

        # 広いband(0.05): position=0.53 → EQUILIBRIUM
        wide = PremiumDiscountCalculator(equilibrium_band=0.05)
        r2 = wide.calculate(highs, lows, current_price=153.0)
        assert r2.zone == 'EQUILIBRIUM'

    def test_real_data_smoke(self, df):
        """実データでエラーなく動作する"""
        ms = MarketStructure(df)
        coarse_h, coarse_l = ms.swings('coarse')
        current_price = float(df['Close'].iloc[-1])

        calc = PremiumDiscountCalculator()
        result = calc.calculate(coarse_h, coarse_l, current_price)

        # 結果が返る（Noneでないこと）
        assert result is not None
        assert result.zone in ('PREMIUM', 'DISCOUNT', 'EQUILIBRIUM')
        assert 0.0 <= result.position <= 1.0
        assert result.swing_high > result.swing_low
        assert result.equilibrium == round((result.swing_high + result.swing_low) / 2, 2)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
