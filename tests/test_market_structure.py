"""
Phase 0 互換テスト: MarketStructure経由のswing/CHoCH/BOSがV10と完全一致することを検証

このテストが通るまでPhase 1に進まない。
"""

import sys
import os
import pytest
import pandas as pd

# app/backend をパスに追加
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app', 'backend'))

from analysis.market_structure import MarketStructure, SwingPoint as MSSwingPoint
from analysis.choch_detector import CHoCHDetector, SwingPoint as CHoCHSwingPoint
from analysis.bos_detector import BOSDetector


FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'nvda_6mo.csv')


@pytest.fixture
def df():
    return pd.read_csv(FIXTURE_PATH)


@pytest.fixture
def ms(df):
    MarketStructure.clear_cache()
    return MarketStructure(df)


# ==============================================================
# 1. Swing Point 互換テスト
# ==============================================================

class TestSwingCompatibility:
    """V10のswing検出とMarketStructureのswing検出が完全一致"""

    def test_choch_detector_swing_match(self, df, ms):
        """CHoCHDetector.detect_swing_points と MarketStructure.all_swings が一致"""
        old_detector = CHoCHDetector(swing_lookback=3)
        old_swings = old_detector.detect_swing_points(df)

        new_swings = ms.all_swings

        assert len(old_swings) == len(new_swings), \
            f"Swing count mismatch: V10={len(old_swings)}, V11={len(new_swings)}"

        for old, new in zip(old_swings, new_swings):
            assert old.index == new.index, f"Index mismatch at {old.index} vs {new.index}"
            assert old.price == pytest.approx(new.price, rel=1e-9), \
                f"Price mismatch at idx {old.index}: {old.price} vs {new.price}"
            assert old.type == new.type, \
                f"Type mismatch at idx {old.index}: {old.type} vs {new.type}"

    def test_bos_detector_swing_match(self, df, ms):
        """BOSDetector.detect_swing_points と MarketStructure.swings('fine') が一致"""
        old_detector = BOSDetector(swing_lookback=3)
        old_highs, old_lows = old_detector.detect_swing_points(
            df['High'].tolist(), df['Low'].tolist()
        )

        new_highs, new_lows = ms.swings('fine')

        assert len(old_highs) == len(new_highs), \
            f"Swing high count mismatch: V10={len(old_highs)}, V11={len(new_highs)}"
        assert len(old_lows) == len(new_lows), \
            f"Swing low count mismatch: V10={len(old_lows)}, V11={len(new_lows)}"

        for old, new in zip(old_highs, new_highs):
            assert old.index == new.index
            assert old.price == pytest.approx(new.price, rel=1e-9)

        for old, new in zip(old_lows, new_lows):
            assert old.index == new.index
            assert old.price == pytest.approx(new.price, rel=1e-9)


# ==============================================================
# 2. CHoCH 互換テスト
# ==============================================================

class TestCHoCHCompatibility:
    """V10とV11でCHoCH検出結果が完全一致"""

    def test_choch_results_unchanged(self, df, ms):
        old_detector = CHoCHDetector(swing_lookback=3)
        old_swings = old_detector.detect_swing_points(df)
        old_chochs = old_detector.detect_choch(df, old_swings)

        new_detector = CHoCHDetector(swing_lookback=3)
        new_chochs = new_detector.detect_choch_from_structure(ms)

        assert len(old_chochs) == len(new_chochs), \
            f"CHoCH count mismatch: V10={len(old_chochs)}, V11={len(new_chochs)}"

        for old, new in zip(old_chochs, new_chochs):
            assert old.index == new.index, f"CHoCH index mismatch: {old.index} vs {new.index}"
            assert old.type == new.type, f"CHoCH type mismatch at {old.index}"
            assert old.price == pytest.approx(new.price, rel=1e-9)
            assert old.strength_pct == pytest.approx(new.strength_pct, rel=1e-6)
            assert old.quality == new.quality


# ==============================================================
# 3. BOS 互換テスト
# ==============================================================

class TestBOSCompatibility:
    """V10とV11でBOS検出結果が完全一致"""

    def test_bos_results_unchanged(self, df, ms):
        old_detector = BOSDetector(swing_lookback=3)
        old_bos = old_detector.detect_bos(
            df['High'].tolist(), df['Low'].tolist()
        )

        new_detector = BOSDetector(swing_lookback=3)
        new_bos = new_detector.detect_bos_from_structure(ms)

        assert len(old_bos) == len(new_bos), \
            f"BOS count mismatch: V10={len(old_bos)}, V11={len(new_bos)}"

        for old, new in zip(old_bos, new_bos):
            assert old.index == new.index, f"BOS index mismatch: {old.index} vs {new.index}"
            assert old.bos_type == new.bos_type
            assert old.price == pytest.approx(new.price, rel=1e-9)
            assert old.broken_level == pytest.approx(new.broken_level, rel=1e-9)
            assert old.strength_pct == pytest.approx(new.strength_pct, rel=1e-6)


# ==============================================================
# 4. MarketStructure 機能テスト
# ==============================================================

class TestMarketStructureFeatures:
    """MarketStructure独自機能のテスト"""

    def test_multi_granularity(self, ms):
        """3粒度のswingが計算され、粒度が粗いほどswingが少ない"""
        fine_h, fine_l = ms.swings('fine')
        med_h, med_l = ms.swings('medium')
        coarse_h, coarse_l = ms.swings('coarse')

        # 粗い粒度ほどswing数が少ない（または等しい）
        assert len(fine_h) + len(fine_l) >= len(med_h) + len(med_l)
        assert len(med_h) + len(med_l) >= len(coarse_h) + len(coarse_l)

    def test_cache_hit(self, df):
        """同一銘柄・同一データでキャッシュヒットする"""
        MarketStructure.clear_cache()
        ms1 = MarketStructure.get_or_create('NVDA', df)
        ms2 = MarketStructure.get_or_create('NVDA', df)
        assert ms1 is ms2

    def test_cache_miss_different_ticker(self, df):
        """異なるティッカーはキャッシュミス"""
        MarketStructure.clear_cache()
        ms1 = MarketStructure.get_or_create('NVDA', df)
        ms2 = MarketStructure.get_or_create('TSLA', df)
        assert ms1 is not ms2

    def test_invalid_granularity(self, ms):
        """不正な粒度名でValueError"""
        with pytest.raises(ValueError):
            ms.swings('invalid')

    def test_swing_points_sorted(self, ms):
        """swing pointsがindex昇順でソートされている"""
        for gran in ['fine', 'medium', 'coarse']:
            highs, lows = ms.swings(gran)
            for i in range(1, len(highs)):
                assert highs[i].index > highs[i-1].index
            for i in range(1, len(lows)):
                assert lows[i].index > lows[i-1].index


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
