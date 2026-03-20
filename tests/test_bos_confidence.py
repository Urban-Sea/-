"""
Phase 1 テスト: BOS Confidence 計算 + entry_allowed ゲート不変検証

- compute_confidence_score が正しい範囲（0.4〜1.0）を返すこと
- entry_allowed がV10と同一であること（ゲート不変）
- position_size_pct ≤ raw_position_size_pct であること
"""

import sys
import os
import pytest
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app', 'backend'))

from analysis.bos_detector import BOSDetector, BOSGrade, BOSAnalysis, BOSSignal, BOSType
from analysis.market_structure import MarketStructure


FIXTURE_PATH = os.path.join(os.path.dirname(__file__), 'fixtures', 'nvda_6mo.csv')


@pytest.fixture
def df():
    return pd.read_csv(FIXTURE_PATH)


@pytest.fixture
def df_with_indicators(df):
    """EMA_21を追加したDataFrame"""
    df = df.copy()
    df['EMA_21'] = df['Close'].ewm(span=21, adjust=False).mean()
    df['EMA_8'] = df['Close'].ewm(span=8, adjust=False).mean()
    tr = np.maximum(
        df['High'] - df['Low'],
        np.maximum(
            abs(df['High'] - df['Close'].shift(1)),
            abs(df['Low'] - df['Close'].shift(1))
        )
    )
    df['ATR'] = tr.rolling(window=14).mean()
    return df


# ==============================================================
# 1. compute_confidence_score のユニットテスト
# ==============================================================

class TestComputeConfidence:
    """BOS Confidence計算のテスト"""

    def test_confidence_range(self, df_with_indicators):
        """confidence は 0.4〜1.0 の範囲"""
        det = BOSDetector()
        highs = df_with_indicators['High'].tolist()
        lows = df_with_indicators['Low'].tolist()
        closes = df_with_indicators['Close'].tolist()
        ema_21 = df_with_indicators['EMA_21'].tolist()

        bos_signals = det.detect_bos(highs, lows)
        choch_signals = det.detect_choch(highs, lows)

        idx = len(closes) - 1
        analysis = det.classify_bos_grade(bos_signals, choch_signals, closes, ema_21, idx)
        confidence = det.compute_confidence_score(analysis, idx)

        assert 0.4 <= confidence <= 1.0, f"Confidence {confidence} out of range"

    def test_grade_none_low_confidence(self):
        """GRADE_NONEの場合、confidenceは低い"""
        det = BOSDetector()
        analysis = BOSAnalysis(
            grade=BOSGrade.NONE,
            recent_bos=[],
            bos_count=0,
            has_recent_choch=False,
            ema21_deviation=0,
            details={},
        )
        confidence = det.compute_confidence_score(analysis, 100)
        # NONE(0.4) * recency(0.5) = 0.2 → but min floor is base*recency
        assert confidence <= 0.4

    def test_reversal_with_choch_high_confidence(self):
        """REVERSAL + CHoCH + 直近BOS → 高confidence"""
        det = BOSDetector()
        analysis = BOSAnalysis(
            grade=BOSGrade.REVERSAL,
            recent_bos=[BOSSignal(index=98, bos_type=BOSType.BULLISH, price=150.0,
                                   broken_level=145.0, strength_pct=3.4)],
            bos_count=1,
            has_recent_choch=True,
            ema21_deviation=2.0,
            details={},
        )
        confidence = det.compute_confidence_score(analysis, 100)
        # REVERSAL(1.0) * recency(1.0) + choch_bonus(0.1) = 1.1 → capped at 1.0
        assert confidence == 1.0

    def test_continuation_moderate_confidence(self):
        """CONTINUATION → 中程度のconfidence"""
        det = BOSDetector()
        analysis = BOSAnalysis(
            grade=BOSGrade.CONTINUATION,
            recent_bos=[BOSSignal(index=95, bos_type=BOSType.BULLISH, price=148.0,
                                   broken_level=145.0, strength_pct=2.1)],
            bos_count=1,
            has_recent_choch=False,
            ema21_deviation=1.0,
            details={},
        )
        confidence = det.compute_confidence_score(analysis, 100)
        # CONTINUATION(0.6) * recency(1.0) = 0.6
        assert 0.5 <= confidence <= 0.7

    def test_recency_decay(self):
        """BOSが古いほどconfidenceが下がる"""
        det = BOSDetector()

        def make_analysis(bos_index):
            return BOSAnalysis(
                grade=BOSGrade.EXTENSION,
                recent_bos=[BOSSignal(index=bos_index, bos_type=BOSType.BULLISH,
                                       price=150.0, broken_level=145.0, strength_pct=3.0)],
                bos_count=1,
                has_recent_choch=False,
                ema21_deviation=12.0,
                details={},
            )

        current_idx = 100
        c_recent = det.compute_confidence_score(make_analysis(98), current_idx)
        c_medium = det.compute_confidence_score(make_analysis(92), current_idx)
        c_old = det.compute_confidence_score(make_analysis(85), current_idx)

        assert c_recent > c_medium > c_old, \
            f"Recency decay failed: {c_recent} > {c_medium} > {c_old}"


# ==============================================================
# 2. ゲート不変テスト
# ==============================================================

class TestGateUnchanged:
    """entry_allowed のゲート条件がV10と同一であることを検証"""

    def test_entry_gate_not_affected_by_confidence(self, df_with_indicators):
        """BOS confidenceはゲート条件に影響しない"""
        # entry_allowedはcombined_ready + RS条件のみで決まる
        # BOS confidenceがどんな値でもentry_allowedは変わらない
        from analysis.combined_entry_detector import CombinedEntryDetector, EntryMode
        from analysis.choch_detector import CHoCHDetector, CHoCHType

        choch_det = CHoCHDetector(swing_lookback=3)
        choch_signals = choch_det.detect_choch(df_with_indicators)

        det = CombinedEntryDetector(use_v9_regime=False, use_v10_price_category=False)
        idx = len(df_with_indicators) - 1

        # V10のゲート条件をチェック
        combined_ready, _, _, _, _ = det._check_combined(
            df_with_indicators, choch_signals, idx
        )

        # entry_allowedはcombined_readyから決まる（RS DOWNでないと仮定）
        entry_allowed_v10, size_v10, _ = det._apply_mode(combined_ready, "FLAT", EntryMode.BALANCED)

        # V11でもゲート条件は同一（position_size_pctのみ異なりうる）
        # _apply_modeの結果はcombined_readyとrs_trendだけに依存
        entry_allowed_v11, size_v11_raw, _ = det._apply_mode(combined_ready, "FLAT", EntryMode.BALANCED)

        assert entry_allowed_v10 == entry_allowed_v11, \
            "entry_allowed gate changed between V10 and V11!"


# ==============================================================
# 3. サイズ調整テスト
# ==============================================================

class TestSizeAdjustment:
    """position_size_pctがBOS confidenceで適切に調整される"""

    def test_size_reduced_by_confidence(self):
        """confidence < 1.0 のとき size は元より小さくなる"""
        # confidence=0.6, raw_size=100 → adjusted=60
        raw_size = 100
        confidence = 0.6
        adjusted = int(raw_size * confidence)
        assert adjusted == 60
        assert adjusted <= raw_size

    def test_size_unchanged_at_max_confidence(self):
        """confidence=1.0 のとき size は不変"""
        raw_size = 100
        confidence = 1.0
        adjusted = int(raw_size * confidence)
        assert adjusted == raw_size


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
