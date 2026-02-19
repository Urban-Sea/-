"""
BOS Detector - 統合BOS検出モジュール

Justin Banks式トレードシステムの核心である構造変化（BOS）を検出
- スイングポイントベースのBOS検出
- BOS Grade分類（REVERSAL, EXTENSION, CONTINUATION, NONE）
- CHoCH（Change of Character）検出

"Structure fails before price collapses"
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from enum import Enum
import pandas as pd

# 同じディレクトリのchoch_detectorをインポート
try:
    from .choch_detector import CHoCHDetector, CHoCHType as CanonicalCHoCHType
except ImportError:
    from analysis.choch_detector import CHoCHDetector, CHoCHType as CanonicalCHoCHType


class BOSType(Enum):
    """BOS種別"""
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"


class BOSGrade(Enum):
    """BOS Grade"""
    EXTENSION = "EXTENSION"      # 21EMAから+10%以上、強いトレンド
    REVERSAL = "REVERSAL"        # CHoCH直後 or 21EMA下から回復
    CONTINUATION = "CONTINUATION"  # 21EMA±5%以内、押し目（新規Entry回避推奨）
    NONE = "NONE"                # BOSなし


class CHoCHType(Enum):
    """CHoCH種別"""
    BULLISH = "BULLISH"   # Lower Low → Higher Low
    BEARISH = "BEARISH"   # Higher High → Lower High


@dataclass
class SwingPoint:
    """スイングポイント"""
    index: int
    price: float
    point_type: str  # 'HIGH', 'LOW'


@dataclass
class BOSSignal:
    """BOS シグナル"""
    index: int
    bos_type: BOSType
    price: float            # BOS発生時の価格
    broken_level: float     # 突破されたレベル
    strength_pct: float     # 突破強度（%）
    grade: BOSGrade = BOSGrade.NONE  # BOS Grade


@dataclass
class CHoCHSignal:
    """CHoCH シグナル"""
    index: int
    choch_type: CHoCHType
    price: float
    previous_price: float
    reason: str


@dataclass
class BOSAnalysis:
    """BOS分析結果"""
    grade: BOSGrade
    recent_bos: List[BOSSignal]
    bos_count: int
    has_recent_choch: bool
    ema21_deviation: float
    details: Dict


class BOSDetector:
    """
    統合BOS検出クラス

    Justin Banks Core Philosophy:
    1. Find the strongest name in the sector
    2. Wait for structure to break (BOS)
    3. Buy the backtest of the Daily 8EMA
    """

    def __init__(
        self,
        swing_lookback: int = 3,
        bos_lookback: int = 10,
        ema21_extension_threshold: float = 10.0,
        ema21_continuation_range: float = 5.0
    ):
        """
        Args:
            swing_lookback: スイングポイント検出の前後確認本数
            bos_lookback: 直近BOS検索の本数
            ema21_extension_threshold: EXTENSION判定の21EMA乖離%
            ema21_continuation_range: CONTINUATION判定の21EMA範囲%
        """
        self.swing_lookback = swing_lookback
        self.bos_lookback = bos_lookback
        self.ema21_extension_threshold = ema21_extension_threshold
        self.ema21_continuation_range = ema21_continuation_range

    def detect_swing_points(
        self,
        highs: List[float],
        lows: List[float]
    ) -> Tuple[List[SwingPoint], List[SwingPoint]]:
        """
        スイングハイとスイングローを検出

        Args:
            highs: 高値リスト
            lows: 安値リスト

        Returns:
            (swing_highs, swing_lows)
        """
        swing_highs = []
        swing_lows = []
        lookback = self.swing_lookback

        for i in range(lookback, len(highs) - lookback):
            # スイングハイ: 周囲より高い
            window_highs = highs[i - lookback : i + lookback + 1]
            if highs[i] == max(window_highs):
                swing_highs.append(SwingPoint(
                    index=i,
                    price=highs[i],
                    point_type="HIGH"
                ))

            # スイングロー: 周囲より低い
            window_lows = lows[i - lookback : i + lookback + 1]
            if lows[i] == min(window_lows):
                swing_lows.append(SwingPoint(
                    index=i,
                    price=lows[i],
                    point_type="LOW"
                ))

        return swing_highs, swing_lows

    def detect_bos(
        self,
        highs: List[float],
        lows: List[float]
    ) -> List[BOSSignal]:
        """
        BOS（Break of Structure）を検出

        - Bullish BOS: スイングハイが前回より高い（Higher High）
        - Bearish BOS: スイングローが前回より低い（Lower Low）

        Args:
            highs: 高値リスト
            lows: 安値リスト

        Returns:
            BOSシグナルリスト（時系列順）
        """
        swing_highs, swing_lows = self.detect_swing_points(highs, lows)
        bos_signals = []

        # Bullish BOS: Higher High
        last_sh = None
        for sh in swing_highs:
            if last_sh and sh.price > last_sh.price:
                strength = (sh.price - last_sh.price) / last_sh.price * 100
                bos_signals.append(BOSSignal(
                    index=sh.index,
                    bos_type=BOSType.BULLISH,
                    price=sh.price,
                    broken_level=last_sh.price,
                    strength_pct=strength
                ))
            last_sh = sh

        # Bearish BOS: Lower Low
        last_sl = None
        for sl in swing_lows:
            if last_sl and sl.price < last_sl.price:
                strength = (last_sl.price - sl.price) / last_sl.price * 100
                bos_signals.append(BOSSignal(
                    index=sl.index,
                    bos_type=BOSType.BEARISH,
                    price=sl.price,
                    broken_level=last_sl.price,
                    strength_pct=strength
                ))
            last_sl = sl

        # インデックスでソート
        bos_signals.sort(key=lambda x: x.index)
        return bos_signals

    def detect_choch(
        self,
        highs: List[float],
        lows: List[float]
    ) -> List[CHoCHSignal]:
        """
        CHoCH（Change of Character）を検出

        正規版（choch_detector.py）を使用:
        - Bullish CHoCH = Higher Low（前回より高い安値）
        - Bearish CHoCH = Lower High（前回より低い高値）

        Args:
            highs: 高値リスト
            lows: 安値リスト

        Returns:
            CHoCHシグナルリスト（このファイルのCHoCHSignal形式）
        """
        # DataFrameを構築
        df = pd.DataFrame({
            'High': highs,
            'Low': lows,
            'Close': [(h + l) / 2 for h, l in zip(highs, lows)]  # 近似値
        })

        # 正規版のCHoCH Detectorを使用
        detector = CHoCHDetector(swing_lookback=self.swing_lookback)
        canonical_signals = detector.detect_choch(df)

        # このファイルのCHoCHSignal形式に変換
        choch_signals = []
        for s in canonical_signals:
            # reasonを生成
            if s.type == CanonicalCHoCHType.BULLISH:
                reason = "Higher Low (正規版)"
            else:
                reason = "Lower High (正規版)"

            choch_signals.append(CHoCHSignal(
                index=s.index,
                choch_type=CHoCHType.BULLISH if s.type == CanonicalCHoCHType.BULLISH else CHoCHType.BEARISH,
                price=s.price,
                previous_price=s.previous_swing,
                reason=reason
            ))

        # インデックスでソート
        choch_signals.sort(key=lambda x: x.index)
        return choch_signals

    def classify_bos_grade(
        self,
        bos_signals: List[BOSSignal],
        choch_signals: List[CHoCHSignal],
        closes: List[float],
        ema_21: List[Optional[float]],
        current_idx: int
    ) -> BOSAnalysis:
        """
        BOSのGradeを分類

        REVERSAL:  CHoCHあり OR 直近で21EMA下から回復
        EXTENSION: 21EMAから+10%以上乖離
        CONTINUATION: 21EMA±5%以内（新規Entry回避推奨）
        NONE: 直近にBullish BOSなし

        Args:
            bos_signals: BOSシグナルリスト
            choch_signals: CHoCHシグナルリスト
            closes: 終値リスト
            ema_21: 21EMAリスト
            current_idx: 現在のインデックス

        Returns:
            BOSAnalysis結果
        """
        lookback = self.bos_lookback

        # 直近のBullish BOSを取得
        recent_bos = [
            b for b in bos_signals
            if b.bos_type == BOSType.BULLISH
            and current_idx - lookback <= b.index <= current_idx
        ]

        if not recent_bos:
            return BOSAnalysis(
                grade=BOSGrade.NONE,
                recent_bos=[],
                bos_count=0,
                has_recent_choch=False,
                ema21_deviation=0,
                details={"reason": "No recent Bullish BOS"}
            )

        # 現在価格と21EMA
        close = closes[current_idx]
        e21 = ema_21[current_idx] if current_idx < len(ema_21) and ema_21[current_idx] else None

        if e21 is None or e21 == 0:
            return BOSAnalysis(
                grade=BOSGrade.NONE,
                recent_bos=recent_bos,
                bos_count=len(recent_bos),
                has_recent_choch=False,
                ema21_deviation=0,
                details={"error": "21EMA not available"}
            )

        # 21EMAからの乖離率
        ema21_deviation = (close - e21) / e21 * 100

        # 直近のBullish CHoCH確認
        recent_bullish_choch = [
            c for c in choch_signals
            if c.choch_type == CHoCHType.BULLISH
            and current_idx - lookback <= c.index <= current_idx
        ]
        has_recent_choch = len(recent_bullish_choch) > 0

        # 過去に21EMAより下だったか確認
        past_below_ema = False
        for i in range(max(0, current_idx - lookback), current_idx):
            if i < len(closes) and i < len(ema_21) and ema_21[i]:
                if closes[i] < ema_21[i]:
                    past_below_ema = True
                    break

        # Grade判定
        details = {
            "ema21_deviation": round(ema21_deviation, 2),
            "has_bullish_choch": has_recent_choch,
            "past_below_ema": past_below_ema,
            "close": close,
            "ema21": e21
        }

        # REVERSAL: CHoCH直後 or 21EMA下から回復
        if has_recent_choch or past_below_ema:
            grade = BOSGrade.REVERSAL
            details["grade_reason"] = "BULLISH_CHOCH" if has_recent_choch else "BELOW_EMA_RECOVERY"

        # EXTENSION: 21EMAから+10%以上
        elif ema21_deviation > self.ema21_extension_threshold:
            grade = BOSGrade.EXTENSION
            details["grade_reason"] = f"+{ema21_deviation:.1f}% from 21EMA"

        # CONTINUATION: 21EMA±5%以内
        elif abs(ema21_deviation) <= self.ema21_continuation_range:
            grade = BOSGrade.CONTINUATION
            details["grade_reason"] = f"{ema21_deviation:+.1f}% from 21EMA (within range)"

        # それ以外（5-10%の範囲）
        else:
            grade = BOSGrade.CONTINUATION
            details["grade_reason"] = f"{ema21_deviation:+.1f}% from 21EMA (moderate)"

        # BOSにGradeを付与
        for bos in recent_bos:
            bos.grade = grade

        return BOSAnalysis(
            grade=grade,
            recent_bos=recent_bos,
            bos_count=len(recent_bos),
            has_recent_choch=has_recent_choch,
            ema21_deviation=round(ema21_deviation, 2),
            details=details
        )

    def find_recent_swing_low(
        self,
        lows: List[float],
        current_idx: int,
        lookback: int = 20
    ) -> Optional[float]:
        """
        直近のスイングロー（Structure Stop用）を検出

        Args:
            lows: 安値リスト
            current_idx: 現在のインデックス
            lookback: 検索範囲

        Returns:
            直近のスイングロー価格
        """
        if current_idx < 5:
            return None

        start_idx = max(0, current_idx - lookback)
        swing_lows = []

        # スイングローを検出（左右3本より低い点）
        for i in range(start_idx + 3, current_idx - 2):
            if i >= len(lows):
                break
            window = lows[i - 3 : i + 4]
            if len(window) == 7 and lows[i] == min(window):
                swing_lows.append({"index": i, "price": lows[i]})

        if not swing_lows:
            # スイングローが見つからない場合、期間内の最安値を使用
            return min(lows[start_idx:current_idx]) if start_idx < current_idx else None

        # 最新のスイングローを返す
        return swing_lows[-1]["price"]

    def find_recent_swing_highs(
        self,
        highs: List[float],
        current_idx: int,
        count: int = 3,
        lookback: int = 30
    ) -> List[float]:
        """
        直近のスイングハイを取得（CHoCH判定用）

        Args:
            highs: 高値リスト
            current_idx: 現在のインデックス
            count: 取得する個数
            lookback: 検索範囲

        Returns:
            スイングハイ価格リスト（古い順）
        """
        start_idx = max(0, current_idx - lookback)
        swing_highs = []

        for i in range(start_idx + 3, current_idx - 2):
            if i >= len(highs):
                break
            window = highs[i - 3 : i + 4]
            if len(window) == 7 and highs[i] == max(window):
                swing_highs.append(highs[i])

        return swing_highs[-count:] if len(swing_highs) >= count else swing_highs

    def is_bos_recent(
        self,
        bos_signals: List[BOSSignal],
        current_idx: int,
        lookback: Optional[int] = None
    ) -> bool:
        """
        直近にBullish BOSがあるかチェック

        Args:
            bos_signals: BOSシグナルリスト
            current_idx: 現在のインデックス
            lookback: 検索範囲（デフォルトはself.bos_lookback）

        Returns:
            Bullish BOSが直近にあるかどうか
        """
        lookback = lookback or self.bos_lookback
        return any(
            b.bos_type == BOSType.BULLISH and current_idx - lookback <= b.index <= current_idx
            for b in bos_signals
        )

    def get_entry_readiness(
        self,
        bos_analysis: BOSAnalysis,
        current_price: float,
        ema_8: float,
        atr: Optional[float] = None
    ) -> Dict:
        """
        Entry準備状況を判定

        Justin Banks式: BOS + 8EMA backtest

        Args:
            bos_analysis: BOS分析結果
            current_price: 現在価格
            ema_8: 8EMA
            atr: ATR（オプション）

        Returns:
            Entry準備状況
        """
        # 8EMAからの距離
        ema8_distance_pct = abs(current_price - ema_8) / ema_8 * 100

        # エントリーゾーン判定（ATRベースまたは固定%）
        if atr:
            zone_width = atr * 0.5  # ATR×0.5
            in_zone = abs(current_price - ema_8) <= zone_width
        else:
            in_zone = ema8_distance_pct <= 2.0  # 固定2%

        # Entry可否判定
        entry_ready = (
            bos_analysis.grade in [BOSGrade.EXTENSION, BOSGrade.REVERSAL]
            and in_zone
        )

        return {
            "entry_ready": entry_ready,
            "bos_grade": bos_analysis.grade.value,
            "in_8ema_zone": in_zone,
            "ema8_distance_pct": round(ema8_distance_pct, 2),
            "reasons": self._get_entry_reasons(bos_analysis, in_zone)
        }

    def _get_entry_reasons(self, bos_analysis: BOSAnalysis, in_zone: bool) -> List[str]:
        """Entry判定の理由リスト"""
        reasons = []

        if bos_analysis.grade == BOSGrade.NONE:
            reasons.append("BOS未検出: 構造待ち")
        elif bos_analysis.grade == BOSGrade.CONTINUATION:
            reasons.append("CONTINUATION BOS: 新規Entry回避推奨")
        elif bos_analysis.grade == BOSGrade.EXTENSION:
            reasons.append("EXTENSION BOS: 強いトレンド")
        elif bos_analysis.grade == BOSGrade.REVERSAL:
            reasons.append("REVERSAL BOS: 構造転換")

        if not in_zone:
            reasons.append("8EMAゾーン外: 押し目待ち")
        else:
            reasons.append("8EMAゾーン内: Entry可")

        if bos_analysis.has_recent_choch:
            reasons.append("直近CHoCH検出: 構造転換確認")

        return reasons


# ============================================================
# ユーティリティ関数
# ============================================================

def create_detector(
    swing_lookback: int = 3,
    bos_lookback: int = 10
) -> BOSDetector:
    """BOSDetectorのファクトリー関数"""
    return BOSDetector(
        swing_lookback=swing_lookback,
        bos_lookback=bos_lookback
    )
