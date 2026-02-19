"""
/api/regime - Market Regime判定
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
import yfinance as yf
import pandas as pd

router = APIRouter()


class RegimeResponse(BaseModel):
    """Market Regimeレスポンス"""
    regime: str  # BULL, BEAR, RECOVERY, WEAKENING
    timestamp: str

    # SPY指標
    spy_price: float
    spy_ema200: float
    spy_above_200ema: bool
    spy_ema21_slope: float

    # 詳細
    description: str
    entry_recommendation: str


def calculate_ema(prices: pd.Series, period: int) -> pd.Series:
    """EMAを計算"""
    return prices.ewm(span=period, adjust=False).mean()


@router.get("", response_model=RegimeResponse)
async def get_regime():
    """
    現在のMarket Regimeを判定

    **レジーム定義:**
    - BULL: SPY > 200EMA & 21EMA上昇
    - WEAKENING: SPY > 200EMA & 21EMA横ばい/下降
    - RECOVERY: SPY < 200EMA & 21EMA上昇
    - BEAR: SPY < 200EMA & 21EMA下降
    """
    try:
        # SPYデータ取得（2年分で確実に200日以上）
        spy = yf.Ticker("SPY")
        df = spy.history(period="2y")

        if len(df) < 21:
            raise HTTPException(status_code=500, detail="Insufficient data for regime calculation")

        # 指標計算
        current_price = df['Close'].iloc[-1]
        # 200日分ない場合は利用可能な最大期間で計算
        ema_period = min(200, len(df))
        ema200 = calculate_ema(df['Close'], ema_period).iloc[-1]
        ema21 = calculate_ema(df['Close'], 21)

        # 21EMAの傾き（5日間）
        ema21_slope = (ema21.iloc[-1] - ema21.iloc[-5]) / 5

        # SPYが200EMA上か
        above_200ema = current_price > ema200

        # レジーム判定
        if above_200ema and ema21_slope > 0.5:
            regime = "BULL"
            description = "強気相場：SPYが200EMAを上回り、21EMAが上昇中"
            entry_recommendation = "積極的にエントリー可能"
        elif above_200ema and ema21_slope <= 0.5:
            regime = "WEAKENING"
            description = "弱含み：SPYは200EMA上だが、モメンタムが低下"
            entry_recommendation = "選択的にエントリー、ポジションサイズ縮小推奨"
        elif not above_200ema and ema21_slope > 0:
            regime = "RECOVERY"
            description = "回復局面：SPYは200EMA下だが、21EMAが上昇中"
            entry_recommendation = "慎重にエントリー、確認シグナル重視"
        else:
            regime = "BEAR"
            description = "弱気相場：SPYが200EMAを下回り、下降トレンド"
            entry_recommendation = "新規エントリー控えめ、現金比率維持"

        return RegimeResponse(
            regime=regime,
            timestamp=datetime.now().isoformat(),
            spy_price=round(current_price, 2),
            spy_ema200=round(ema200, 2),
            spy_above_200ema=above_200ema,
            spy_ema21_slope=round(ema21_slope, 4),
            description=description,
            entry_recommendation=entry_recommendation,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
