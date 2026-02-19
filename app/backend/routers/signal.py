"""
/api/signal/{ticker} - V10シグナル計算

本格版: CombinedEntryDetector V10を使用
- EMA収束閾値: Regime別（BULL=1.3, WEAKENING=1.0, BEAR=0.8, RECOVERY=2.0）
- RS DOWN閾値: 株価カテゴリ別に最適化
- CHoCH検出: Bearish → Bullish シーケンス確認
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime

# 本格ロジックをインポート
from analysis.combined_entry_detector import CombinedEntryDetector, EntryMode, EntryAnalysis
from analysis.bos_detector import BOSDetector
from analysis.regime_detector import RegimeDetector

router = APIRouter()


class CHoCHCondition(BaseModel):
    """CHoCH条件"""
    found: bool
    date: Optional[str] = None
    strength: Optional[float] = None


class EMAConvergence(BaseModel):
    """EMA収束条件"""
    value: float
    converged: bool
    threshold: float


class SignalConditions(BaseModel):
    """V10シグナル条件"""
    bearish_choch: CHoCHCondition
    bullish_choch: CHoCHCondition
    ema_convergence: EMAConvergence


class RelativeStrength(BaseModel):
    """相対強度"""
    change_pct: float
    trend: str  # UP, FLAT, DOWN
    down_threshold: float


class ModeResult(BaseModel):
    """モード別結果"""
    entry_allowed: bool
    position_size_pct: int


class SignalResponse(BaseModel):
    """シグナルレスポンス"""
    ticker: str
    timestamp: str
    price: float
    price_change_pct: float
    price_category: str

    # Combined Entry条件
    combined_ready: bool
    conditions: SignalConditions

    # 相対強度
    relative_strength: RelativeStrength

    # Regime情報
    regime: str  # BULL, WEAKENING, BEAR, RECOVERY

    # モード別判定
    mode: str
    entry_allowed: bool
    position_size_pct: int
    mode_note: str
    other_modes: Dict[str, ModeResult]


def entry_mode_from_str(mode_str: str) -> EntryMode:
    """文字列からEntryModeに変換"""
    mode_map = {
        "aggressive": EntryMode.AGGRESSIVE,
        "balanced": EntryMode.BALANCED,
        "conservative": EntryMode.CONSERVATIVE,
    }
    return mode_map.get(mode_str.lower(), EntryMode.BALANCED)


@router.get("/{ticker}", response_model=SignalResponse)
async def get_signal(
    ticker: str,
    mode: str = Query("balanced", description="取引モード: aggressive, balanced, conservative"),
):
    """
    V10シグナルを計算（本格版）

    Combined Entry条件:
    1. Bearish CHoCH先行
    2. Bullish CHoCH発生
    3. EMA収束（Regime別閾値）

    モード:
    - aggressive: RS無視、Combined条件のみ
    - balanced: RS DOWNでEntry禁止
    - conservative: RSに応じてポジションサイズ調整

    - **ticker**: 銘柄コード (例: NVDA)
    - **mode**: aggressive=攻め, balanced=バランス, conservative=守り
    """
    ticker = ticker.upper()
    entry_mode = entry_mode_from_str(mode)

    try:
        # CombinedEntryDetector V10を使用
        detector = CombinedEntryDetector(
            use_v9_regime=True,
            use_v10_price_category=True
        )

        result: EntryAnalysis = detector.analyze(ticker, entry_mode)

        # レスポンス構築
        conditions = SignalConditions(
            bearish_choch=CHoCHCondition(
                found=result.bearish_choch_found,
                date=result.bearish_choch_date,
                strength=result.bearish_choch_strength,
            ),
            bullish_choch=CHoCHCondition(
                found=result.bullish_choch_found,
                date=result.bullish_choch_date,
                strength=result.bullish_choch_strength,
            ),
            ema_convergence=EMAConvergence(
                value=result.ema_convergence if result.ema_convergence != float('inf') else 999.0,
                converged=result.ema_converged,
                threshold=result.ema_threshold_used,
            ),
        )

        relative_strength = RelativeStrength(
            change_pct=result.rs_change_pct,
            trend=result.rs_trend,
            down_threshold=result.rs_down_threshold_used,
        )

        other_modes = {
            k: ModeResult(
                entry_allowed=v["entry_allowed"],
                position_size_pct=v["position_size_pct"],
            )
            for k, v in result.other_modes.items()
        }

        return SignalResponse(
            ticker=result.ticker,
            timestamp=datetime.now().isoformat(),
            price=result.price,
            price_change_pct=result.price_change_pct,
            price_category=result.price_category,
            combined_ready=result.combined_ready,
            conditions=conditions,
            relative_strength=relative_strength,
            regime=result.regime,
            mode=result.mode,
            entry_allowed=result.entry_allowed,
            position_size_pct=result.position_size_pct,
            mode_note=result.mode_note,
            other_modes=other_modes,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/bos")
async def get_bos_analysis(ticker: str):
    """
    BOS（Break of Structure）分析

    - **ticker**: 銘柄コード (例: NVDA)

    Returns:
        BOS Grade, 直近BOS一覧, CHoCH状態, Entry準備状況
    """
    ticker = ticker.upper()

    try:
        import yfinance as yf
        import pandas as pd

        # 株価データ取得
        stock = yf.Ticker(ticker)
        df = stock.history(period="6mo")

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {ticker}")

        # インジケーター計算
        df['EMA_8'] = df['Close'].ewm(span=8, adjust=False).mean()
        df['EMA_21'] = df['Close'].ewm(span=21, adjust=False).mean()

        highs = df['High'].tolist()
        lows = df['Low'].tolist()
        closes = df['Close'].tolist()
        ema_21 = df['EMA_21'].tolist()

        # BOS Detector
        bos_detector = BOSDetector()
        bos_signals = bos_detector.detect_bos(highs, lows)
        choch_signals = bos_detector.detect_choch(highs, lows)

        current_idx = len(closes) - 1
        bos_analysis = bos_detector.classify_bos_grade(
            bos_signals, choch_signals, closes, ema_21, current_idx
        )

        # Entry準備状況
        current_price = closes[-1]
        ema_8 = df['EMA_8'].iloc[-1]
        entry_readiness = bos_detector.get_entry_readiness(
            bos_analysis, current_price, ema_8
        )

        return {
            "ticker": ticker,
            "timestamp": datetime.now().isoformat(),
            "current_price": round(current_price, 2),
            "bos_analysis": {
                "grade": bos_analysis.grade.value,
                "bos_count": bos_analysis.bos_count,
                "has_recent_choch": bos_analysis.has_recent_choch,
                "ema21_deviation": bos_analysis.ema21_deviation,
                "details": bos_analysis.details,
            },
            "entry_readiness": entry_readiness,
            "recent_bos": [
                {
                    "index": b.index,
                    "type": b.bos_type.value,
                    "price": round(b.price, 2),
                    "broken_level": round(b.broken_level, 2),
                    "strength_pct": round(b.strength_pct, 2),
                    "grade": b.grade.value,
                }
                for b in bos_analysis.recent_bos[-5:]
            ],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/regime")
async def get_regime_for_ticker(ticker: str):
    """
    銘柄に関連するMarket Regime情報

    - **ticker**: 銘柄コード (例: NVDA)

    Returns:
        Market Regime, ベンチマーク情報
    """
    ticker = ticker.upper()

    try:
        detector = RegimeDetector(use_4regime=True)
        result = detector.detect()

        return {
            "ticker": ticker,
            "timestamp": datetime.now().isoformat(),
            "regime": result.regime,
            "benchmark": {
                "ticker": result.benchmark_ticker,
                "close": result.benchmark_close,
                "ema_long": result.benchmark_ema_long,
                "ema_short": result.benchmark_ema_short,
                "slope": result.ema_short_slope,
            },
            "signals": {
                "above_long_ema": result.above_long_ema,
                "ema_short_up": result.ema_short_up,
            },
            "effect": result.effect_description,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
