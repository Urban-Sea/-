"""
Combined Entry Detector V10

Combined Entry条件 + 3モード判定をリアルタイムで行う。
バックテスト(backtest_layer1_rs.py, backtest_v9_entry.py, backtest_rs_v10_final.py)で検証済みのロジックを抽出。

V10: 株価カテゴリ別RS閾値対応（2026-02-18）
  - EMA収束閾値: V9継続（Regime別: BULL=1.3, WEAKENING=1.0, BEAR=0.8, RECOVERY=2.0）
  - RS DOWN閾値: 株価カテゴリ別に最適化
    $0-5:     -30.0%  (超小型株: 大幅緩和)
    $5-15:    -2.0%   (小型株: 厳格化)
    $15-35:   -2.0%   (中小型株: 厳格化)
    $35-60:   -5.0%   (中型株: 中立)
    $60-100:  -15.0%  (中大型株: 緩和)
    $100-200: -15.0%  (大型株: 緩和)
    $200+:    -2.0%   (超大型株: 厳格化)

Entry条件（全モード共通）:
  1. Bearish CHoCH先行（直前10個のCHoCHを遡り検索）
  2. Bullish CHoCH発生（Higher Low検出）
  3. EMA収束（|EMA_8 - EMA_21| / ATR ≤ Regime別閾値）

運用モード:
  Balanced（デフォルト / 標準型）: RS DOWN → Entry禁止（閾値は株価カテゴリ別）
  Aggressive:                      RS無視
  Conservative（慎重型）:          Balanced条件 + 追加フィルター
                                   + EMA21 5日傾き > 3% → Entry禁止（過熱排除）
                                   + ATR/価格 < 1.5% → Entry禁止（低ボラ排除）
                                   バックテスト検証: MaxDD -36.5%→-25.5%改善, PF 6.62→6.88

バックテスト実績（V10 + V8.3 Exit）:
  avg +20.12%, PF 5.82, win 54.6%, Bear +0.88%, n=524
  （V9 Baseline: avg +19.17%, PF 5.09, win 50.8%, Bear +0.84%, n=433）

yfinance を直接使用してリアルタイム判定。
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Dict
import pandas as pd
import numpy as np
import yfinance as yf

# 同じディレクトリの依存モジュール
try:
    from .asset_class import AssetClass, JPBenchmark, get_config
    from .regime_detector import RegimeDetector
    from .choch_detector import CHoCHDetector, CHoCHType
    from .bos_detector import BOSDetector
except ImportError:
    from analysis.asset_class import AssetClass, JPBenchmark, get_config
    from analysis.regime_detector import RegimeDetector
    from analysis.choch_detector import CHoCHDetector, CHoCHType
    from analysis.bos_detector import BOSDetector


class EntryMode(Enum):
    BALANCED = "balanced"
    AGGRESSIVE = "aggressive"
    CONSERVATIVE = "conservative"


@dataclass
class EntryAnalysis:
    # Combined条件（モード共通）
    combined_ready: bool
    bearish_choch_found: bool
    bearish_choch_date: Optional[str]
    bearish_choch_strength: Optional[float]
    bullish_choch_found: bool
    bullish_choch_date: Optional[str]
    bullish_choch_strength: Optional[float]
    ema_convergence: float          # |EMA8-EMA21|/ATR
    ema_converged: bool             # ≤閾値で True

    # 相対強度
    rs_change_pct: float
    rs_trend: str                   # UP / FLAT / DOWN

    # モード別判定結果
    mode: str
    entry_allowed: bool
    position_size_pct: int          # 100 / 75 / 50 / 0
    mode_note: str

    # 銘柄情報
    ticker: str
    price: float
    price_change_pct: float

    # 他モード参考情報
    other_modes: Dict[str, dict]

    # V9: Regime情報
    regime: str = "BULL"            # BULL / WEAKENING / BEAR / RECOVERY
    ema_threshold_used: float = 1.5  # 使用したEMA収束閾値
    rs_down_threshold_used: float = -3.0  # 使用したRS DOWN閾値

    # V10: 株価カテゴリ情報
    price_category: str = "$0-5"    # $0-5 / $5-15 / $15-35 / $35-60 / $60-100 / $100-200 / $200+

    # ベンチマーク情報
    benchmark_ticker: str = "SPY"
    benchmark_price: float = 0.0
    benchmark_ema_long: float = 0.0
    ema_short_slope: float = 0.0

    # V11: BOS Confidence（ゲート不変、サイズ調整のみ）
    bos_confidence: float = 1.0     # 0.4〜1.0
    bos_grade: str = "NONE"         # EXTENSION / REVERSAL / CONTINUATION / NONE

    # V12: Entry Timing（バックテスト検証: Open入りで avg+2.79%, PF 5.73→7.90）
    entry_timing: str = "NEXT_OPEN"  # NEXT_OPEN: 翌営業日の寄付き成行

    # V13 Conservative用フィルター値
    ema21_slope_5d: float = 0.0     # EMA21の5日傾き（%）
    atr_pct: float = 0.0           # ATR/価格（%）


class CombinedEntryDetector:
    """Combined Entry + 運用モード判定（マルチアセット対応、V9 Regime対応）"""

    # デフォルト値（米国株用 - 後方互換性のため保持）
    DEFAULT_EMA_CONVERGENCE_THRESHOLD = 1.5
    DEFAULT_RS_UP_THRESHOLD = 3.0
    DEFAULT_RS_DOWN_THRESHOLD = -3.0
    RS_LOOKBACK = 21
    CHOCH_SEARCH_COUNT = 10

    # V9 E5-B: Regime別EMA閾値（バックテスト検証済み）
    V9_EMA_THRESHOLD = {
        "BULL": 1.3,
        "WEAKENING": 1.0,
        "BEAR": 0.8,
        "RECOVERY": 2.0,
    }

    # V9 Regime別RS閾値（後方互換性のため保持）
    V9_RS_DOWN_THRESHOLD = {
        "BULL": -3.0,
        "WEAKENING": -1.5,
        "BEAR": -5.0,
        "RECOVERY": -5.0,
    }

    # V10: 株価カテゴリ別RS閾値（バックテスト検証済み: backtest_rs_v10_final.py）
    # 結果: avg +20.12%, PF 5.82, win 54.6%, Bear +0.88%
    V10_RS_DOWN_THRESHOLD = {
        "$0-5":     -30.0,   # 超小型株: 大幅緩和（RS Gate実質無効化）
        "$5-15":    -2.0,    # 小型株: 厳格化
        "$15-35":   -2.0,    # 中小型株: 厳格化
        "$35-60":   -5.0,    # 中型株: 中立
        "$60-100":  -15.0,   # 中大型株: 緩和（RS DOWNでも高収益）
        "$100-200": -15.0,   # 大型株: 緩和
        "$200+":    -2.0,    # 超大型株: 厳格化（SPY連動強い）
    }

    # 日本株(JPY)用: USDブラケットを150倍相当にマッピング
    V10_RS_DOWN_THRESHOLD_JP = {
        "¥0-750":      -30.0,   # 超小型株
        "¥750-2250":   -2.0,    # 小型株
        "¥2250-5250":  -2.0,    # 中小型株
        "¥5250-9000":  -5.0,    # 中型株
        "¥9000-15000": -15.0,   # 中大型株
        "¥15000-30000":-15.0,   # 大型株
        "¥30000+":     -2.0,    # 超大型株
    }

    # 株価カテゴリの境界値
    PRICE_BRACKETS = [5, 15, 35, 60, 100, 200]
    PRICE_BRACKETS_JP = [750, 2250, 5250, 9000, 15000, 30000]

    @staticmethod
    def categorize_price(price: float, currency: str = "USD") -> str:
        """
        株価を7段階のカテゴリに分類

        Args:
            price: 株価
            currency: 通貨（"USD" or "JPY"）

        Returns:
            str: 株価カテゴリ
        """
        if currency == "JPY":
            brackets = [750, 2250, 5250, 9000, 15000, 30000]
            labels = ["¥0-750", "¥750-2250", "¥2250-5250", "¥5250-9000",
                      "¥9000-15000", "¥15000-30000", "¥30000+"]
        else:
            brackets = [5, 15, 35, 60, 100, 200]
            labels = ["$0-5", "$5-15", "$15-35", "$35-60",
                      "$60-100", "$100-200", "$200+"]

        for i, threshold in enumerate(brackets):
            if price <= threshold:
                return labels[i]
        return labels[-1]

    def __init__(
        self,
        asset_class: Optional[AssetClass] = None,
        jp_benchmark: Optional[JPBenchmark] = None,
        use_v9_regime: bool = True,
        use_v10_price_category: bool = True
    ):
        """
        コンストラクタ

        Args:
            asset_class: 資産クラス（None=米国株）
            jp_benchmark: 日本株の場合のベンチマーク選択
            use_v9_regime: V9 Regime別EMAパラメータを使用（デフォルト: True）
            use_v10_price_category: V10 株価カテゴリ別RS閾値を使用（デフォルト: True）
        """
        self.asset_class = asset_class or AssetClass.US_STOCK
        self.jp_benchmark = jp_benchmark
        self.use_v9_regime = use_v9_regime
        self.use_v10_price_category = use_v10_price_category

        # 資産クラス別パラメータを読み込み
        config = get_config(self.asset_class)
        self.EMA_CONVERGENCE_THRESHOLD = config.signal.ema_convergence_threshold
        self.RS_UP_THRESHOLD = config.signal.rs_up_threshold
        self.RS_DOWN_THRESHOLD = config.signal.rs_down_threshold

        # V9: RegimeDetector初期化
        self._regime_detector = None
        if use_v9_regime:
            self._regime_detector = RegimeDetector(use_4regime=True)

    def analyze(self, ticker: str,
                mode: EntryMode = EntryMode.BALANCED,
                stock_df: Optional[pd.DataFrame] = None,
                benchmark_df: Optional[pd.DataFrame] = None) -> EntryAnalysis:
        """
        Entry分析を実行

        Args:
            ticker: ティッカーシンボル
            mode: 運用モード
            stock_df: 銘柄のOHLCVデータ（Noneの場合は自動取得）
            benchmark_df: ベンチマークのOHLCVデータ（Noneの場合は自動取得）
        """
        if stock_df is None:
            stock_df = self._fetch_data(ticker)
        if benchmark_df is None:
            benchmark_df = self._fetch_benchmark()

        if stock_df is None or stock_df.empty:
            return self._empty_result(ticker, mode)

        stock_df = self._ensure_indicators(stock_df)
        idx = len(stock_df) - 1

        # 価格情報を先に取得（V10で株価カテゴリ別閾値に必要）
        price = float(stock_df['Close'].iloc[idx])
        prev_close = float(stock_df['Close'].iloc[idx - 1]) if idx > 0 else price
        price_change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0.0

        # V9/V10: 現在のRegimeを検出し、閾値を取得
        regime_result = self._detect_current_regime(benchmark_df)
        current_regime = regime_result.regime if regime_result else "BULL"
        ema_threshold, rs_down_threshold, price_category = self._get_regime_thresholds(
            current_regime, price
        )

        # CHoCH検出
        choch_det = CHoCHDetector(swing_lookback=3)
        choch_signals = choch_det.detect_choch(stock_df)

        # Combined条件判定（V9: Regime別EMA閾値使用）
        combined_ready, bearish_info, bullish_info, ema_conv, ema_converged = \
            self._check_combined(stock_df, choch_signals, idx, ema_threshold)

        # RS計算（V10: 株価カテゴリ別閾値使用）
        rs_change_pct, rs_trend = self._calculate_rs(
            stock_df, benchmark_df, idx, rs_down_threshold
        )

        # V13 Conservative用: EMA21傾き・ATR%計算
        ema21_slope_5d = 0.0
        atr_pct = 999.0
        try:
            if 'EMA_21' in stock_df.columns and idx >= 5:
                ema21_now = stock_df['EMA_21'].iloc[idx]
                ema21_5ago = stock_df['EMA_21'].iloc[idx - 5]
                if ema21_5ago > 0:
                    ema21_slope_5d = (ema21_now - ema21_5ago) / ema21_5ago * 100
            if 'ATR' in stock_df.columns and price > 0:
                atr_pct = stock_df['ATR'].iloc[idx] / price * 100
        except Exception:
            pass

        # モード別判定
        entry_allowed, size_pct, note = self._apply_mode(
            combined_ready, rs_trend, mode, ema21_slope_5d, atr_pct
        )

        # V11: BOS Grade計算（情報表示のみ。サイズ調整は無効化）
        # バックテスト検証: NONEグレード(win 69.5%)がREVERSAL(win 65.6%)より
        # 勝率が高く、Confidenceによるサイズ調整は逆効果（weighted avg -5.53%）。
        # Gradeは情報表示として残し、サイズ調整には使わない。
        bos_confidence = 1.0
        bos_grade_str = "NONE"
        try:
            bos_det = BOSDetector(swing_lookback=3)
            highs = stock_df['High'].tolist()
            lows = stock_df['Low'].tolist()
            closes = stock_df['Close'].tolist()
            ema_21_list = stock_df['EMA_21'].tolist() if 'EMA_21' in stock_df.columns else []

            bos_signals = bos_det.detect_bos(highs, lows)
            choch_bos_signals = bos_det.detect_choch(highs, lows)

            if ema_21_list:
                bos_analysis = bos_det.classify_bos_grade(
                    bos_signals, choch_bos_signals, closes, ema_21_list, idx
                )
                bos_grade_str = bos_analysis.grade.value
                # confidence計算は残すが情報表示のみ（サイズ乗数に使わない）
                bos_confidence = bos_det.compute_confidence_score(bos_analysis, idx)
        except Exception:
            pass

        # サイズ調整なし（confidence=1.0固定でも計算結果は変わらない）
        adjusted_size_pct = size_pct

        # 他モード参考
        other_modes = {}
        for m in EntryMode:
            if m.value != mode.value:
                allowed, sz, _ = self._apply_mode(
                    combined_ready, rs_trend, m, ema21_slope_5d, atr_pct
                )
                other_modes[m.value] = {
                    "entry_allowed": allowed,
                    "position_size_pct": sz,
                }

        return EntryAnalysis(
            combined_ready=combined_ready,
            bearish_choch_found=bearish_info['found'],
            bearish_choch_date=bearish_info.get('date'),
            bearish_choch_strength=bearish_info.get('strength'),
            bullish_choch_found=bullish_info['found'],
            bullish_choch_date=bullish_info.get('date'),
            bullish_choch_strength=bullish_info.get('strength'),
            ema_convergence=ema_conv,
            ema_converged=ema_converged,
            rs_change_pct=rs_change_pct,
            rs_trend=rs_trend,
            mode=mode.value,
            entry_allowed=entry_allowed,
            position_size_pct=adjusted_size_pct,
            mode_note=note,
            ticker=ticker,
            price=round(price, 2),
            price_change_pct=round(price_change_pct, 2),
            other_modes=other_modes,
            regime=current_regime,
            ema_threshold_used=ema_threshold,
            rs_down_threshold_used=rs_down_threshold,
            price_category=price_category,
            benchmark_ticker=regime_result.benchmark_ticker if regime_result else "SPY",
            benchmark_price=round(regime_result.benchmark_close, 2) if regime_result else 0.0,
            benchmark_ema_long=round(regime_result.benchmark_ema_long, 2) if regime_result else 0.0,
            ema_short_slope=round(regime_result.ema_short_slope, 4) if regime_result else 0.0,
            bos_confidence=round(bos_confidence, 2),
            bos_grade=bos_grade_str,
            ema21_slope_5d=round(ema21_slope_5d, 2),
            atr_pct=round(atr_pct, 2),
        )

    def _detect_current_regime(self, benchmark_df: Optional[pd.DataFrame]):
        """
        V9: 現在のMarket Regimeを検出

        Returns:
            RegimeResult or None
        """
        if not self.use_v9_regime or self._regime_detector is None:
            return None

        try:
            result = self._regime_detector.detect(
                asset_class=self.asset_class,
                jp_benchmark=self.jp_benchmark,
                benchmark_df=benchmark_df
            )
            return result
        except Exception:
            return None

    def _get_regime_thresholds(self, regime: str, price: float = None) -> tuple:
        """
        V9/V10: Regime別・株価カテゴリ別の閾値を取得

        Args:
            regime: 現在のRegime（BULL/WEAKENING/BEAR/RECOVERY）
            price: 株価（V10で株価カテゴリ別RS閾値を使用する場合）

        Returns:
            tuple: (ema_threshold, rs_down_threshold, price_category)
        """
        # EMA閾値: V9 Regime別
        if self.use_v9_regime:
            ema_threshold = self.V9_EMA_THRESHOLD.get(regime, 1.5)
        else:
            ema_threshold = self.EMA_CONVERGENCE_THRESHOLD

        # RS DOWN閾値: V10 株価カテゴリ別 or V9 Regime別
        currency = get_config(self.asset_class).gate.currency
        if self.use_v10_price_category and price is not None:
            price_category = self.categorize_price(price, currency)
            threshold_table = self.V10_RS_DOWN_THRESHOLD_JP if currency == "JPY" else self.V10_RS_DOWN_THRESHOLD
            rs_down_threshold = threshold_table.get(price_category, -3.0)
        elif self.use_v9_regime:
            price_category = self.categorize_price(price, currency) if price else ("¥0-750" if currency == "JPY" else "$0-5")
            rs_down_threshold = self.V9_RS_DOWN_THRESHOLD.get(regime, -3.0)
        else:
            price_category = self.categorize_price(price, currency) if price else ("¥0-750" if currency == "JPY" else "$0-5")
            rs_down_threshold = self.RS_DOWN_THRESHOLD

        return ema_threshold, rs_down_threshold, price_category

    def _check_combined(self, df, choch_signals, idx, ema_threshold: float = None):
        """
        Combined Entry条件をチェック

        Args:
            df: 銘柄データ
            choch_signals: CHoCHシグナルリスト
            idx: 判定インデックス
            ema_threshold: EMA収束閾値（V9: Regime別、None時は従来固定値）
        """
        # V9: 閾値が指定されていなければ従来の固定値を使用
        if ema_threshold is None:
            ema_threshold = self.EMA_CONVERGENCE_THRESHOLD

        bearish_info = {'found': False}
        bullish_info = {'found': False}

        # 最新のCHoCHから遡って検索
        recent_chochs = [c for c in choch_signals if c.index <= idx]
        recent_chochs = recent_chochs[-self.CHOCH_SEARCH_COUNT:] if len(recent_chochs) > self.CHOCH_SEARCH_COUNT else recent_chochs

        # Bullish CHoCH（最新）を探す
        latest_bullish = None
        for c in reversed(recent_chochs):
            if c.type == CHoCHType.BULLISH:
                latest_bullish = c
                break

        if latest_bullish:
            bullish_info = {
                'found': True,
                'date': latest_bullish.date,
                'strength': round(latest_bullish.strength_pct, 2),
            }

            # そのBullish CHoCHより前のBearish CHoCHを探す
            # バックテスト準拠: 途中に別のBullish CHoCHがあればそこで検索停止
            for c in reversed(recent_chochs):
                if c.index >= latest_bullish.index:
                    continue
                if c.type == CHoCHType.BULLISH:
                    break  # 別のBullishが先に見つかった → Bearish先行条件不成立
                if c.type == CHoCHType.BEARISH:
                    bearish_info = {
                        'found': True,
                        'date': c.date,
                        'strength': round(c.strength_pct, 2),
                    }
                    break

        # EMA収束（V9: Regime別閾値を使用）
        ema_conv = float('inf')
        ema_converged = False
        if 'EMA_distance_atr' in df.columns and not pd.isna(df['EMA_distance_atr'].iloc[idx]):
            ema_conv = float(df['EMA_distance_atr'].iloc[idx])
            ema_converged = ema_conv <= ema_threshold
        elif 'EMA_8' in df.columns and 'EMA_21' in df.columns and 'ATR' in df.columns:
            ema_8 = df['EMA_8'].iloc[idx]
            ema_21 = df['EMA_21'].iloc[idx]
            atr = df['ATR'].iloc[idx]
            if not pd.isna(ema_8) and not pd.isna(ema_21) and not pd.isna(atr) and atr > 0:
                ema_conv = abs(ema_8 - ema_21) / atr
                ema_converged = ema_conv <= ema_threshold

        combined_ready = bearish_info['found'] and bullish_info['found'] and ema_converged

        return combined_ready, bearish_info, bullish_info, round(ema_conv, 2), ema_converged

    def _calculate_rs(self, stock_df, benchmark_df, idx, rs_down_threshold: float = None):
        """
        相対強度（RS）を計算

        Args:
            stock_df: 銘柄データ
            benchmark_df: ベンチマークデータ
            idx: 判定インデックス
            rs_down_threshold: RS DOWN閾値（V9: Regime別、None時は従来固定値）
        """
        if benchmark_df is None or benchmark_df.empty:
            return 0.0, "FLAT"
        if idx < self.RS_LOOKBACK + 5:
            return 0.0, "FLAT"

        # V9: 閾値が指定されていなければ従来の固定値を使用
        if rs_down_threshold is None:
            rs_down_threshold = self.RS_DOWN_THRESHOLD

        try:
            stock_close = float(stock_df['Close'].iloc[idx])
            stock_date = pd.to_datetime(stock_df['Date'].iloc[idx]).strftime('%Y-%m-%d')
            stock_prev_date = pd.to_datetime(stock_df['Date'].iloc[idx - self.RS_LOOKBACK]).strftime('%Y-%m-%d')

            # ベンチマークの日付カラムを取得（Date または index）
            if 'Date' in benchmark_df.columns:
                bench_dates = pd.to_datetime(benchmark_df['Date']).dt.strftime('%Y-%m-%d')
                bench_current = benchmark_df[bench_dates == stock_date]
                bench_prev = benchmark_df[bench_dates == stock_prev_date]
            else:
                # インデックスが日付の場合
                bench_dates = pd.to_datetime(benchmark_df.index).strftime('%Y-%m-%d')
                bench_current = benchmark_df[bench_dates == stock_date]
                bench_prev = benchmark_df[bench_dates == stock_prev_date]

            if bench_current.empty:
                bench_current = benchmark_df.iloc[[-1]]
            if bench_prev.empty:
                # 近い日を探す
                bench_prev_idx = max(0, len(benchmark_df) - 1 - self.RS_LOOKBACK)
                bench_prev = benchmark_df.iloc[[bench_prev_idx]]

            bench_close = float(bench_current['Close'].iloc[0])
            bench_prev_close = float(bench_prev['Close'].iloc[0])
            stock_prev_close = float(stock_df['Close'].iloc[idx - self.RS_LOOKBACK])

            if bench_close == 0 or bench_prev_close == 0:
                return 0.0, "FLAT"

            rs_current = stock_close / bench_close
            rs_prev = stock_prev_close / bench_prev_close

            if rs_prev == 0:
                return 0.0, "FLAT"

            rs_change_pct = (rs_current - rs_prev) / rs_prev * 100

            # V9: Regime別閾値でトレンド判定
            if rs_change_pct > self.RS_UP_THRESHOLD:
                trend = "UP"
            elif rs_change_pct < rs_down_threshold:
                trend = "DOWN"
            else:
                trend = "FLAT"

            return round(rs_change_pct, 2), trend

        except Exception:
            return 0.0, "FLAT"

    def _apply_mode(self, combined_ready: bool, rs_trend: str, mode: EntryMode,
                    ema21_slope_5d: float = 0.0, atr_pct: float = 999.0):
        if not combined_ready:
            return False, 0, "Combined条件未達"

        if mode == EntryMode.AGGRESSIVE:
            return True, 100, ""

        if mode == EntryMode.BALANCED:
            if rs_trend == "DOWN":
                return False, 0, "相対強度が低い（Aggressiveなら Entry可能）"
            return True, 100, ""

        if mode == EntryMode.CONSERVATIVE:
            # Balanced条件と同じRS判定
            if rs_trend == "DOWN":
                return False, 0, "相対強度が低い"
            # 追加フィルター1: EMA21の5日傾きが3%超 → 過熱排除
            if ema21_slope_5d > 3.0:
                return False, 0, f"EMA21過熱（傾き {ema21_slope_5d:.1f}%）"
            # 追加フィルター2: ATR/価格が1.5%未満 → 低ボラ排除
            if atr_pct < 1.5:
                return False, 0, f"低ボラティリティ（ATR {atr_pct:.1f}%）"
            return True, 100, ""

        return True, 100, ""

    def _fetch_data(self, ticker: str) -> Optional[pd.DataFrame]:
        """銘柄データを取得（L2 DBキャッシュ付き）"""
        try:
            from cache_utils import fetch_ohlcv_cached
            return fetch_ohlcv_cached(ticker, "6mo")
        except ImportError:
            # Fallback (cache_utils 未 import 時)
            try:
                stock = yf.Ticker(ticker)
                df = stock.history(period="6mo")
                # 未確定バー (yfinance が当日の Close=NaN で返す行) を落とす
                df = df.dropna(subset=['Close'])
                if df.empty:
                    return None
                df = df.reset_index()
                df = df.rename(columns={'index': 'Date'})
                return df
            except Exception:
                return None

    def _fetch_benchmark(self) -> Optional[pd.DataFrame]:
        """ベンチマークデータを取得"""
        config = get_config(self.asset_class)
        ticker = config.regime.benchmark_ticker
        return self._fetch_data(ticker)

    def _ensure_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        close = df['Close']
        if 'EMA_8' not in df.columns:
            df['EMA_8'] = close.ewm(span=8, adjust=False).mean()
        if 'EMA_21' not in df.columns:
            df['EMA_21'] = close.ewm(span=21, adjust=False).mean()
        if 'ATR' not in df.columns:
            tr = np.maximum(
                df['High'] - df['Low'],
                np.maximum(
                    abs(df['High'] - df['Close'].shift(1)),
                    abs(df['Low'] - df['Close'].shift(1))
                )
            )
            df['ATR'] = tr.rolling(window=14).mean()
        if 'EMA_distance' not in df.columns:
            df['EMA_distance'] = (df['EMA_8'] - df['EMA_21']).abs()
        if 'EMA_distance_atr' not in df.columns:
            df['EMA_distance_atr'] = df['EMA_distance'] / df['ATR']
        return df

    def _empty_result(self, ticker: str, mode: EntryMode) -> EntryAnalysis:
        return EntryAnalysis(
            combined_ready=False,
            bearish_choch_found=False, bearish_choch_date=None, bearish_choch_strength=None,
            bullish_choch_found=False, bullish_choch_date=None, bullish_choch_strength=None,
            ema_convergence=float('inf'), ema_converged=False,
            rs_change_pct=0.0, rs_trend="FLAT",
            mode=mode.value, entry_allowed=False, position_size_pct=0,
            mode_note="データ取得失敗",
            ticker=ticker, price=0.0, price_change_pct=0.0,
            other_modes={},
            regime="BULL",
            ema_threshold_used=self.DEFAULT_EMA_CONVERGENCE_THRESHOLD,
            rs_down_threshold_used=self.DEFAULT_RS_DOWN_THRESHOLD,
            price_category="$0-5",
        )

    def to_dict(self, result: EntryAnalysis) -> dict:
        return {
            "ticker": result.ticker,
            "price": result.price,
            "price_change_pct": result.price_change_pct,
            "combined_ready": result.combined_ready,
            "conditions": {
                "bearish_choch": {
                    "found": result.bearish_choch_found,
                    "date": result.bearish_choch_date,
                    "strength": result.bearish_choch_strength,
                },
                "bullish_choch": {
                    "found": result.bullish_choch_found,
                    "date": result.bullish_choch_date,
                    "strength": result.bullish_choch_strength,
                },
                "ema_convergence": {
                    "value": result.ema_convergence,
                    "converged": result.ema_converged,
                    "threshold": result.ema_threshold_used,  # V9: 使用した閾値
                },
            },
            "relative_strength": {
                "change_pct": result.rs_change_pct,
                "trend": result.rs_trend,
                "down_threshold": result.rs_down_threshold_used,  # V10: 使用した閾値（株価カテゴリ別）
            },
            "mode": result.mode,
            "entry_allowed": result.entry_allowed,
            "position_size_pct": result.position_size_pct,
            "mode_note": result.mode_note,
            "other_modes": result.other_modes,
            # V9: Regime情報
            "regime": result.regime,
            # V10: 株価カテゴリ情報
            "price_category": result.price_category,
            # V11: BOS Confidence
            "bos_confidence": result.bos_confidence,
            "bos_grade": result.bos_grade,
            # V12: Entry Timing
            "entry_timing": result.entry_timing,
            # V13: Conservative フィルター値
            "ema21_slope_5d": result.ema21_slope_5d,
            "atr_pct": result.atr_pct,
        }
