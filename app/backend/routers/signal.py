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


@router.get("/{ticker}/history")
async def get_signal_history(
    ticker: str,
    period: str = Query("1y", description="分析期間: 3mo, 6mo, 1y, 2y"),
    mode: str = Query("balanced", description="取引モード"),
):
    """
    過去シグナル分析

    指定期間内で発生した過去のエントリーシグナルを検出。
    バックテスト的な分析結果を返す。

    - **ticker**: 銘柄コード (例: NVDA)
    - **period**: 分析期間 (3mo, 6mo, 1y, 2y)
    - **mode**: 取引モード (aggressive, balanced, conservative)

    Returns:
        過去シグナル一覧、パフォーマンス統計
    """
    ticker = ticker.upper()
    entry_mode = entry_mode_from_str(mode)

    try:
        import yfinance as yf
        import pandas as pd
        import numpy as np

        # 株価データ取得
        stock = yf.Ticker(ticker)
        df = stock.history(period=period)

        if df.empty or len(df) < 50:
            raise HTTPException(status_code=404, detail=f"Insufficient data for {ticker}")

        # EMA計算
        df['EMA_8'] = df['Close'].ewm(span=8, adjust=False).mean()
        df['EMA_21'] = df['Close'].ewm(span=21, adjust=False).mean()
        df['EMA_200'] = df['Close'].ewm(span=200, adjust=False).mean()

        # RS計算（SPYとの相対強度）
        try:
            spy = yf.Ticker("SPY")
            spy_df = spy.history(period=period)
            if not spy_df.empty and len(spy_df) >= 20:
                spy_df['RS'] = spy_df['Close'].pct_change(20) * 100
                # dfとspy_dfの日付を合わせる
                df = df.join(spy_df[['RS']].rename(columns={'RS': 'SPY_RS'}), how='left')
                df['RS'] = df['Close'].pct_change(20) * 100
                df['RS_diff'] = df['RS'] - df['SPY_RS'].fillna(0)
        except Exception:
            df['RS_diff'] = 0

        highs = df['High'].tolist()
        lows = df['Low'].tolist()
        closes = df['Close'].tolist()

        # BOS/CHoCH検出
        bos_detector = BOSDetector()
        bos_signals = bos_detector.detect_bos(highs, lows)
        choch_signals = bos_detector.detect_choch(highs, lows)

        # シグナル検出ロジック
        signals = []

        # CHoCHをインデックスでマップ
        bearish_choch_indices = set()
        bullish_choch_indices = set()
        for choch in choch_signals:
            if choch.choch_type.value == "BEARISH":
                bearish_choch_indices.add(choch.index)
            else:
                bullish_choch_indices.add(choch.index)

        # シグナル検出（50日目から開始）
        for i in range(50, len(df)):
            # 直近でBearish CHoCH → Bullish CHoCHのシーケンスを確認
            recent_bearish = None
            recent_bullish = None

            for idx in range(max(0, i - 30), i):
                if idx in bearish_choch_indices:
                    recent_bearish = idx
                if idx in bullish_choch_indices and recent_bearish is not None and idx > recent_bearish:
                    recent_bullish = idx

            if recent_bearish is None or recent_bullish is None:
                continue

            # EMA収束チェック
            ema_8 = df['EMA_8'].iloc[i]
            ema_21 = df['EMA_21'].iloc[i]
            ema_conv = abs(ema_8 - ema_21) / df['Close'].iloc[i] * 100
            if ema_conv > 2.0:  # 2%以上離れていたらスキップ
                continue

            # RS チェック（balanced mode）
            rs_diff = df['RS_diff'].iloc[i] if 'RS_diff' in df.columns else 0
            if mode == "balanced" and rs_diff < -10:
                continue

            # シグナル発生
            date = df.index[i]
            entry_price = float(df['Close'].iloc[i])

            # 将来のパフォーマンス計算（5日後、10日後、20日後）
            pnl_5d = None
            pnl_10d = None
            pnl_20d = None
            max_pnl = None
            min_pnl = None

            if i + 5 < len(df):
                pnl_5d = (df['Close'].iloc[i + 5] - entry_price) / entry_price * 100
            if i + 10 < len(df):
                pnl_10d = (df['Close'].iloc[i + 10] - entry_price) / entry_price * 100
            if i + 20 < len(df):
                pnl_20d = (df['Close'].iloc[i + 20] - entry_price) / entry_price * 100
                # 20日間の最大・最小
                future_prices = df['Close'].iloc[i:i+20]
                max_pnl = (future_prices.max() - entry_price) / entry_price * 100
                min_pnl = (future_prices.min() - entry_price) / entry_price * 100

            signals.append({
                "date": date.strftime("%Y-%m-%d"),
                "price": round(entry_price, 2),
                "ema_convergence": round(ema_conv, 2),
                "rs_diff": round(float(rs_diff) if not pd.isna(rs_diff) else 0, 2),
                "pnl_5d": round(float(pnl_5d), 2) if pnl_5d is not None and not pd.isna(pnl_5d) else None,
                "pnl_10d": round(float(pnl_10d), 2) if pnl_10d is not None and not pd.isna(pnl_10d) else None,
                "pnl_20d": round(float(pnl_20d), 2) if pnl_20d is not None and not pd.isna(pnl_20d) else None,
                "max_pnl_20d": round(float(max_pnl), 2) if max_pnl is not None and not pd.isna(max_pnl) else None,
                "min_pnl_20d": round(float(min_pnl), 2) if min_pnl is not None and not pd.isna(min_pnl) else None,
            })

        # 統計計算
        stats = {
            "total_signals": len(signals),
            "avg_pnl_5d": None,
            "avg_pnl_10d": None,
            "avg_pnl_20d": None,
            "win_rate_5d": None,
            "win_rate_10d": None,
            "win_rate_20d": None,
        }

        if signals:
            pnl_5d_list = [s["pnl_5d"] for s in signals if s["pnl_5d"] is not None]
            pnl_10d_list = [s["pnl_10d"] for s in signals if s["pnl_10d"] is not None]
            pnl_20d_list = [s["pnl_20d"] for s in signals if s["pnl_20d"] is not None]

            if pnl_5d_list:
                stats["avg_pnl_5d"] = round(float(np.mean(pnl_5d_list)), 2)
                stats["win_rate_5d"] = round(len([p for p in pnl_5d_list if p > 0]) / len(pnl_5d_list) * 100, 1)
            if pnl_10d_list:
                stats["avg_pnl_10d"] = round(float(np.mean(pnl_10d_list)), 2)
                stats["win_rate_10d"] = round(len([p for p in pnl_10d_list if p > 0]) / len(pnl_10d_list) * 100, 1)
            if pnl_20d_list:
                stats["avg_pnl_20d"] = round(float(np.mean(pnl_20d_list)), 2)
                stats["win_rate_20d"] = round(len([p for p in pnl_20d_list if p > 0]) / len(pnl_20d_list) * 100, 1)

        return {
            "ticker": ticker,
            "period": period,
            "mode": mode,
            "timestamp": datetime.now().isoformat(),
            "signals": signals[-20:],  # 直近20件
            "stats": stats,
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


@router.get("/{ticker}/chart-markers")
async def get_chart_markers(
    ticker: str,
    period: str = Query("3mo", description="チャート期間: 1mo, 3mo, 6mo, 1y"),
):
    """
    チャート用マーカーデータ

    BOS、CHoCH、FVGのマーカー位置を日付付きで返す

    - **ticker**: 銘柄コード (例: NVDA)
    - **period**: チャート期間

    Returns:
        BOS/CHoCH/FVGマーカー（日付付き）
    """
    ticker = ticker.upper()

    try:
        import yfinance as yf
        import pandas as pd

        # 株価データ取得
        stock = yf.Ticker(ticker)
        df = stock.history(period=period)

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {ticker}")

        # 日付をインデックスから列に変換
        df = df.reset_index()
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')

        # BOSとCHoCH検出
        highs = df['High'].tolist()
        lows = df['Low'].tolist()

        bos_detector = BOSDetector()
        bos_signals = bos_detector.detect_bos(highs, lows)
        choch_signals = bos_detector.detect_choch(highs, lows)

        # FVG（Fair Value Gap）検出
        fvg_list = []
        for i in range(2, len(df)):
            prev_high = df['High'].iloc[i-2]
            current_low = df['Low'].iloc[i]
            current_high = df['High'].iloc[i]
            prev_low = df['Low'].iloc[i-2]

            # Bullish FVG: 2本前の高値 < 現在の安値（ギャップアップ）
            if prev_high < current_low:
                gap_size = (current_low - prev_high) / prev_high * 100
                if gap_size >= 0.5:  # 0.5%以上のギャップ
                    fvg_list.append({
                        "date": df['Date'].iloc[i],
                        "type": "BULLISH",
                        "top": float(current_low),
                        "bottom": float(prev_high),
                        "gap_pct": round(gap_size, 2),
                    })

            # Bearish FVG: 2本前の安値 > 現在の高値（ギャップダウン）
            if prev_low > current_high:
                gap_size = (prev_low - current_high) / prev_low * 100
                if gap_size >= 0.5:
                    fvg_list.append({
                        "date": df['Date'].iloc[i],
                        "type": "BEARISH",
                        "top": float(prev_low),
                        "bottom": float(current_high),
                        "gap_pct": round(gap_size, 2),
                    })

        # BOSマーカーを日付付きに変換
        bos_list = []
        for b in bos_signals:
            if b.index < len(df):
                bos_list.append({
                    "date": df['Date'].iloc[b.index],
                    "type": b.bos_type.value,
                    "price": round(float(b.price), 2),
                    "broken_level": round(float(b.broken_level), 2),
                    "strength_pct": round(float(b.strength_pct), 2),
                })

        # CHoCHマーカーを日付付きに変換
        choch_list = []
        for c in choch_signals:
            if c.index < len(df):
                choch_list.append({
                    "date": df['Date'].iloc[c.index],
                    "type": c.choch_type.value,
                    "price": round(float(c.price), 2),
                    "previous_price": round(float(c.previous_price), 2),
                })

        return {
            "ticker": ticker,
            "period": period,
            "timestamp": datetime.now().isoformat(),
            "bos": bos_list,
            "choch": choch_list,
            "fvg": fvg_list,
            "data_points": len(df),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
