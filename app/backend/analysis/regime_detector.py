"""
Market Regime Detector (Layer 0)

ベンチマーク（SPY/日経225/TOPIX/BTC）のEMAによる市場局面判定。
バックテスト(backtest_layer2_v4.py)で検証済みのロジックをリアルタイム用に抽出。

Regime (V8: 4Regime対応):
  BULL:       ベンチマーク > 200EMA かつ 短期EMA上向き → 通常運用
  WEAKENING:  ベンチマーク > 200EMA だが 短期EMA下向き → やや守り
  RECOVERY:   ベンチマーク < 200EMA かつ 短期EMA上向き → トレンド伸ばす
  BEAR:       ベンチマーク < 200EMA かつ 短期EMA下向き → 守り重視

yfinance を直接使用してリアルタイム判定。
"""

from dataclasses import dataclass
from typing import Optional
import pandas as pd
import yfinance as yf

try:
    from .asset_class import AssetClass, get_config, JPBenchmark
except ImportError:
    from analysis.asset_class import AssetClass, get_config, JPBenchmark


@dataclass
class RegimeResult:
    regime: str                  # BULL / WEAKENING / BEAR / RECOVERY
    benchmark_ticker: str        # SPY / ^N225 / BTC-USD
    benchmark_close: float
    benchmark_ema_long: float    # 200EMA (crypto: 50EMA)
    benchmark_ema_short: float   # 21EMA
    ema_short_slope: float       # 5日間の短期EMA変化
    above_long_ema: bool
    ema_short_up: bool
    effect_description: str      # 「通常運用」等
    asset_class: str             # us_stock / jp_stock / crypto

    # 後方互換用プロパティ
    @property
    def spy_close(self) -> float:
        return self.benchmark_close

    @property
    def spy_ema200(self) -> float:
        return self.benchmark_ema_long

    @property
    def spy_ema21(self) -> float:
        return self.benchmark_ema_short

    @property
    def spy_ema21_slope(self) -> float:
        return self.ema_short_slope

    @property
    def above_200(self) -> bool:
        return self.above_long_ema

    @property
    def ema21_up(self) -> bool:
        return self.ema_short_up


class RegimeDetector:
    """ベンチマークEMAによる市場局面判定"""

    def __init__(self, use_4regime: bool = True):
        self.use_4regime = use_4regime

    def detect(
        self,
        asset_class: AssetClass = AssetClass.US_STOCK,
        jp_benchmark: Optional[JPBenchmark] = None,
        benchmark_df: Optional[pd.DataFrame] = None
    ) -> RegimeResult:
        """
        市場局面を判定

        Args:
            asset_class: 資産クラス
            jp_benchmark: 日本株の場合のベンチマーク選択
            benchmark_df: ベンチマークデータ（Noneの場合は自動取得）

        Returns:
            RegimeResult: 判定結果
        """
        config = get_config(asset_class)
        benchmark_ticker = self._get_benchmark_ticker(asset_class, jp_benchmark, config)

        if benchmark_df is None:
            benchmark_df = self._fetch_benchmark_data(benchmark_ticker)

        if benchmark_df is None or benchmark_df.empty:
            return self._fallback_result(asset_class, benchmark_ticker)

        benchmark_df = self._ensure_indicators(benchmark_df, config)
        idx = len(benchmark_df) - 1
        return self._detect_at_index(benchmark_df, idx, asset_class, benchmark_ticker, config)

    def _get_benchmark_ticker(
        self,
        asset_class: AssetClass,
        jp_benchmark: Optional[JPBenchmark],
        config
    ) -> str:
        """ベンチマークティッカーを取得"""
        if asset_class == AssetClass.JP_STOCK and jp_benchmark:
            return jp_benchmark.value
        return config.regime.benchmark_ticker

    def _fetch_benchmark_data(self, ticker: str) -> Optional[pd.DataFrame]:
        """yfinanceでベンチマークデータを取得"""
        try:
            stock = yf.Ticker(ticker)
            df = stock.history(period="1y")
            # 未確定バー (yfinance が当日の Close=NaN で返す行) を落とす
            df = df.dropna(subset=['Close'])
            if df.empty:
                return None
            df = df.reset_index()
            df = df.rename(columns={'index': 'Date'})
            return df
        except Exception:
            return None

    def _ensure_indicators(self, df: pd.DataFrame, config) -> pd.DataFrame:
        """必要なインジケーターを計算"""
        df = df.copy()
        close = df['Close']

        ema_short = config.regime.ema_short
        ema_long = config.regime.ema_long

        if f'EMA_{ema_short}' not in df.columns:
            df[f'EMA_{ema_short}'] = close.ewm(span=ema_short, adjust=False).mean()
        if f'EMA_{ema_long}' not in df.columns:
            df[f'EMA_{ema_long}'] = close.ewm(span=ema_long, adjust=False).mean()
        if f'EMA_{ema_short}_slope' not in df.columns:
            df[f'EMA_{ema_short}_slope'] = df[f'EMA_{ema_short}'].diff(5)

        # 後方互換用
        df['EMA_21'] = df.get(f'EMA_{ema_short}', close.ewm(span=21, adjust=False).mean())
        df['EMA_200'] = df.get(f'EMA_{ema_long}', close.ewm(span=200, adjust=False).mean())
        df['EMA_21_slope'] = df.get(f'EMA_{ema_short}_slope', df['EMA_21'].diff(5))

        return df

    def _detect_at_index(
        self,
        df: pd.DataFrame,
        idx: int,
        asset_class: AssetClass,
        benchmark_ticker: str,
        config
    ) -> RegimeResult:
        """指定インデックスでのRegime判定"""
        ema_short = config.regime.ema_short
        ema_long = config.regime.ema_long

        benchmark_close = float(df['Close'].iloc[idx])
        benchmark_ema_long = float(df[f'EMA_{ema_long}'].iloc[idx])
        benchmark_ema_short = float(df[f'EMA_{ema_short}'].iloc[idx])

        slope_col = f'EMA_{ema_short}_slope'
        ema_short_slope = float(df[slope_col].iloc[idx]) if not pd.isna(df[slope_col].iloc[idx]) else 0.0

        above_long_ema = benchmark_close > benchmark_ema_long
        ema_short_up = ema_short_slope > 0

        if above_long_ema and ema_short_up:
            regime = "BULL"
            effect = "通常運用"
        elif above_long_ema and not ema_short_up:
            if self.use_4regime:
                regime = "WEAKENING"
                effect = "勢い弱まり（Trail-0.3, Mirror Warn 60%）"
            else:
                regime = "BULL"
                effect = "通常運用（勢い弱め）"
        elif not above_long_ema and ema_short_up:
            regime = "RECOVERY"
            effect = "トレンド伸ばす（Trail広め）"
        else:
            regime = "BEAR"
            effect = "守り重視（Trail狭め, Mirror Warn 66%）"

        # slope を % に変換
        slope_pct = (ema_short_slope / benchmark_ema_short * 100) if benchmark_ema_short > 0 else 0.0

        return RegimeResult(
            regime=regime,
            benchmark_ticker=benchmark_ticker,
            benchmark_close=round(benchmark_close, 2),
            benchmark_ema_long=round(benchmark_ema_long, 2),
            benchmark_ema_short=round(benchmark_ema_short, 2),
            ema_short_slope=round(slope_pct, 2),
            above_long_ema=above_long_ema,
            ema_short_up=ema_short_up,
            effect_description=effect,
            asset_class=asset_class.value,
        )

    def _fallback_result(
        self,
        asset_class: AssetClass,
        benchmark_ticker: str
    ) -> RegimeResult:
        """データ取得失敗時のフォールバック"""
        return RegimeResult(
            regime="BULL",
            benchmark_ticker=benchmark_ticker,
            benchmark_close=0.0,
            benchmark_ema_long=0.0,
            benchmark_ema_short=0.0,
            ema_short_slope=0.0,
            above_long_ema=True,
            ema_short_up=True,
            effect_description="データ取得失敗（デフォルト: BULL）",
            asset_class=asset_class.value,
        )

    def to_dict(self, result: RegimeResult) -> dict:
        """結果を辞書形式に変換"""
        return {
            "regime": result.regime,
            "benchmark_ticker": result.benchmark_ticker,
            "benchmark_close": result.benchmark_close,
            "benchmark_ema_long": result.benchmark_ema_long,
            "benchmark_ema_short": result.benchmark_ema_short,
            "ema_short_slope": result.ema_short_slope,
            "above_long_ema": result.above_long_ema,
            "ema_short_up": result.ema_short_up,
            "effect": result.effect_description,
            "asset_class": result.asset_class,
            # 後方互換
            "spy_close": result.benchmark_close,
            "spy_ema200": result.benchmark_ema_long,
            "spy_ema21": result.benchmark_ema_short,
            "spy_ema21_slope": result.ema_short_slope,
            "above_200": result.above_long_ema,
            "ema21_up": result.ema_short_up,
        }


# 後方互換: デフォルト(米国株)でのRegime判定
def detect_regime(spy_df: Optional[pd.DataFrame] = None) -> RegimeResult:
    """後方互換用: SPYベースのRegime判定"""
    detector = RegimeDetector()
    return detector.detect(
        asset_class=AssetClass.US_STOCK,
        benchmark_df=spy_df
    )
