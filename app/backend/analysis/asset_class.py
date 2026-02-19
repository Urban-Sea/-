"""
資産クラス定義モジュール

全資産クラス（米国株・日本株・暗号資産）の設定を一元管理
"""

from enum import Enum
from dataclasses import dataclass
from typing import Optional, List


class AssetClass(Enum):
    """資産クラス"""
    US_STOCK = "us_stock"
    JP_STOCK = "jp_stock"
    CRYPTO = "crypto"


class JPBenchmark(Enum):
    """日本株ベンチマーク選択"""
    NIKKEI225 = "^N225"
    TOPIX = "1306.T"


@dataclass
class GateConfig:
    """Gate条件（スクリーナー）設定"""
    min_price: float
    min_market_cap: Optional[float]  # None = チェックしない
    min_dollar_volume: float
    adr_min: float
    adr_max: float
    currency: str


@dataclass
class RegimeConfig:
    """Market Regime判定設定"""
    benchmark_ticker: str
    ema_short: int
    ema_long: int


@dataclass
class SignalConfig:
    """シグナル判定パラメータ（Entry/Exit用）"""
    rs_up_threshold: float       # RSトレンド UP判定閾値 (%)
    rs_down_threshold: float     # RSトレンド DOWN判定閾値 (%)
    ema_convergence_threshold: float  # EMA収束閾値 (ATR正規化)


@dataclass
class AssetConfig:
    """資産クラス別設定"""
    asset_class: AssetClass
    gate: GateConfig
    regime: RegimeConfig
    signal: SignalConfig
    display_name: str
    quick_tickers: List[str]


# デフォルト設定
ASSET_CONFIGS = {
    AssetClass.US_STOCK: AssetConfig(
        asset_class=AssetClass.US_STOCK,
        gate=GateConfig(
            min_price=3.0,
            min_market_cap=500_000_000,
            min_dollar_volume=5_000_000,
            adr_min=2.0,
            adr_max=12.0,
            currency="USD"
        ),
        regime=RegimeConfig(
            benchmark_ticker="SPY",
            ema_short=21,
            ema_long=200
        ),
        signal=SignalConfig(
            rs_up_threshold=3.0,
            rs_down_threshold=-3.0,
            ema_convergence_threshold=1.5
        ),
        display_name="US Stocks",
        quick_tickers=["RKLB", "NVDA", "AMD", "TSLA", "AAPL", "SPY", "QQQ", "MSTR", "COIN"]
    ),
    AssetClass.JP_STOCK: AssetConfig(
        asset_class=AssetClass.JP_STOCK,
        gate=GateConfig(
            min_price=500.0,
            min_market_cap=100_000_000_000,
            min_dollar_volume=1_000_000_000,
            adr_min=2.0,
            adr_max=8.0,
            currency="JPY"
        ),
        regime=RegimeConfig(
            benchmark_ticker="^N225",
            ema_short=21,
            ema_long=200
        ),
        signal=SignalConfig(
            rs_up_threshold=2.0,
            rs_down_threshold=-2.0,
            ema_convergence_threshold=1.3
        ),
        display_name="日本株",
        quick_tickers=["7203", "9984", "6758", "8306", "6861", "7974", "9983", "4063"]
    ),
    AssetClass.CRYPTO: AssetConfig(
        asset_class=AssetClass.CRYPTO,
        gate=GateConfig(
            min_price=0.01,
            min_market_cap=100_000_000,
            min_dollar_volume=10_000_000,
            adr_min=3.0,
            adr_max=20.0,
            currency="USD"
        ),
        regime=RegimeConfig(
            benchmark_ticker="BTC-USD",
            ema_short=21,
            ema_long=50
        ),
        signal=SignalConfig(
            rs_up_threshold=5.0,
            rs_down_threshold=-5.0,
            ema_convergence_threshold=2.0
        ),
        display_name="Crypto",
        quick_tickers=["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK"]
    )
}


def get_config(asset_class: AssetClass) -> AssetConfig:
    """資産クラスの設定を取得"""
    return ASSET_CONFIGS[asset_class]


def get_config_by_str(asset_class_str: str) -> AssetConfig:
    """文字列から資産クラスの設定を取得"""
    asset_class = AssetClass(asset_class_str)
    return ASSET_CONFIGS[asset_class]


def normalize_ticker_yfinance(ticker: str, asset_class: AssetClass) -> str:
    """
    ティッカーをyfinance形式に正規化

    - 日本株: 7203 → 7203.T (東証形式)
    - 暗号資産: BTC → BTC-USD
    - 米国株: そのまま
    """
    ticker = ticker.strip().upper()

    if asset_class == AssetClass.JP_STOCK:
        ticker = ticker.replace('.JP', '').replace('.jp', '')
        if not ticker.endswith('.T'):
            return f"{ticker}.T"
        return ticker

    elif asset_class == AssetClass.CRYPTO:
        if not ticker.endswith('-USD'):
            return f"{ticker}-USD"
        return ticker

    else:
        return ticker


def get_all_asset_classes() -> List[dict]:
    """全資産クラスの情報を取得（API用）"""
    return [
        {
            "id": config.asset_class.value,
            "display_name": config.display_name,
            "quick_tickers": config.quick_tickers,
            "currency": config.gate.currency
        }
        for config in ASSET_CONFIGS.values()
    ]
