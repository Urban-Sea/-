"""
/api/regime - Market Regime判定

本格版: RegimeDetector V8を使用
- 4Regime対応（BULL, WEAKENING, BEAR, RECOVERY）
- EMA Short（21日）の傾きでトレンド判定
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime

# 本格ロジックをインポート
from ..analysis.regime_detector import RegimeDetector, RegimeResult
from ..analysis.asset_class import AssetClass

router = APIRouter()


class RegimeResponse(BaseModel):
    """Market Regimeレスポンス"""
    regime: str  # BULL, BEAR, RECOVERY, WEAKENING
    timestamp: str

    # ベンチマーク指標
    benchmark_ticker: str
    benchmark_price: float
    benchmark_ema_long: float
    benchmark_ema_short: float
    above_long_ema: bool
    ema_short_slope: float

    # 詳細
    description: str
    entry_recommendation: str
    asset_class: str


def get_entry_recommendation(regime: str) -> str:
    """レジームに基づくEntry推奨を取得"""
    recommendations = {
        "BULL": "積極的にエントリー可能",
        "WEAKENING": "選択的にエントリー、Trail-0.3、Mirror Warn 60%",
        "RECOVERY": "トレンド伸ばす、Trail広め",
        "BEAR": "守り重視、Trail狭め、Mirror Warn 66%",
    }
    return recommendations.get(regime, "状況に応じて判断")


@router.get("", response_model=RegimeResponse)
async def get_regime():
    """
    現在のMarket Regimeを判定（本格版）

    **レジーム定義（4Regime）:**
    - BULL: ベンチマーク > 長期EMA & 短期EMA上昇
    - WEAKENING: ベンチマーク > 長期EMA & 短期EMA横ばい/下降
    - RECOVERY: ベンチマーク < 長期EMA & 短期EMA上昇
    - BEAR: ベンチマーク < 長期EMA & 短期EMA下降
    """
    try:
        # RegimeDetector V8（4Regime対応）を使用
        detector = RegimeDetector(use_4regime=True)
        result: RegimeResult = detector.detect(asset_class=AssetClass.US_STOCK)

        return RegimeResponse(
            regime=result.regime,
            timestamp=datetime.now().isoformat(),
            benchmark_ticker=result.benchmark_ticker,
            benchmark_price=result.benchmark_close,
            benchmark_ema_long=result.benchmark_ema_long,
            benchmark_ema_short=result.benchmark_ema_short,
            above_long_ema=result.above_long_ema,
            ema_short_slope=result.ema_short_slope,
            description=result.effect_description,
            entry_recommendation=get_entry_recommendation(result.regime),
            asset_class=result.asset_class,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 後方互換性のためのエイリアス
@router.get("/spy", response_model=RegimeResponse)
async def get_regime_spy():
    """
    SPYベースのMarket Regime（後方互換）
    """
    return await get_regime()
