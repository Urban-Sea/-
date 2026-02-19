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


class BatchRequest(BaseModel):
    """バッチリクエスト"""
    tickers: list[str]
    mode: str = "balanced"


class BatchResult(BaseModel):
    """バッチ結果（1銘柄）"""
    ticker: str
    price: Optional[float] = None
    price_change_pct: Optional[float] = None
    combined_ready: bool = False
    entry_allowed: bool = False
    position_size_pct: int = 0
    relative_strength: Optional[Dict[str, Any]] = None
    regime: Optional[str] = None
    error: bool = False
    error_message: Optional[str] = None


class BatchResponse(BaseModel):
    """バッチレスポンス"""
    mode: str
    total_analyzed: int
    entry_ready_count: int
    results: list[BatchResult]
    timestamp: str


@router.post("/batch", response_model=BatchResponse)
async def analyze_batch(request: BatchRequest):
    """
    一括シグナル分析

    複数銘柄を一度に分析し、エントリー可否を判定する。

    - **tickers**: 銘柄コードリスト (例: ["NVDA", "TSLA", "META"])
    - **mode**: aggressive=攻め, balanced=バランス, conservative=守り
    """
    entry_mode = entry_mode_from_str(request.mode)
    results = []
    entry_ready_count = 0

    for ticker in request.tickers:
        ticker = ticker.upper()
        try:
            detector = CombinedEntryDetector(
                use_v9_regime=True,
                use_v10_price_category=True
            )
            result = detector.analyze(ticker, entry_mode)

            if result.entry_allowed:
                entry_ready_count += 1

            results.append(BatchResult(
                ticker=result.ticker,
                price=result.price,
                price_change_pct=result.price_change_pct,
                combined_ready=result.combined_ready,
                entry_allowed=result.entry_allowed,
                position_size_pct=result.position_size_pct,
                relative_strength={
                    "change_pct": result.rs_change_pct,
                    "trend": result.rs_trend,
                },
                regime=result.regime,
                error=False,
            ))
        except Exception as e:
            results.append(BatchResult(
                ticker=ticker,
                error=True,
                error_message=str(e),
            ))

    return BatchResponse(
        mode=request.mode,
        total_analyzed=len(request.tickers),
        entry_ready_count=entry_ready_count,
        results=results,
        timestamp=datetime.now().isoformat(),
    )


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
    過去シグナル分析（demo版準拠）

    ENTRY, HEAT, RSI_HIGH, EXITの4種類のシグナルを検出。
    タイムライン形式でシグナル履歴を返す。

    - **ticker**: 銘柄コード (例: NVDA)
    - **period**: 分析期間 (3mo, 6mo, 1y, 2y)
    - **mode**: 取引モード (aggressive, balanced, conservative)

    Returns:
        timeline: 全種類のシグナル一覧
        stats: 統計情報
    """
    ticker = ticker.upper()

    try:
        import yfinance as yf
        import pandas as pd
        import numpy as np

        # 株価データ取得（1年分+余裕）
        stock = yf.Ticker(ticker)
        df = stock.history(period="2y" if period == "1y" else period)

        if df.empty or len(df) < 50:
            raise HTTPException(status_code=404, detail=f"Insufficient data for {ticker}")

        # 日付をDateカラムに
        df = df.reset_index()
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')

        # インジケータ計算
        df['EMA_8'] = df['Close'].ewm(span=8, adjust=False).mean()
        df['EMA_21'] = df['Close'].ewm(span=21, adjust=False).mean()
        df['EMA_200'] = df['Close'].ewm(span=200, adjust=False).mean()

        # RSI計算
        delta = df['Close'].diff()
        gain = delta.where(delta > 0, 0.0)
        loss = (-delta).where(delta < 0, 0.0)
        avg_gain = gain.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
        rs = np.where(avg_loss > 0, avg_gain / avg_loss, 100)
        df['RSI'] = 100 - (100 / (1 + rs))

        # ATR計算
        tr = np.maximum(
            df['High'] - df['Low'],
            np.maximum(
                abs(df['High'] - df['Close'].shift(1)),
                abs(df['Low'] - df['Close'].shift(1))
            )
        )
        df['ATR'] = tr.rolling(window=14).mean()

        # RS計算（SPYとの相対強度）
        try:
            spy = yf.Ticker("SPY")
            spy_df = spy.history(period="2y" if period == "1y" else period)
            if not spy_df.empty and len(spy_df) >= 20:
                spy_df['RS'] = spy_df['Close'].pct_change(20) * 100
                spy_df = spy_df.reset_index()
                spy_df['Date'] = spy_df['Date'].dt.strftime('%Y-%m-%d')
                df = df.merge(spy_df[['Date', 'RS']].rename(columns={'RS': 'SPY_RS'}), on='Date', how='left')
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

        # CHoCHをインデックスでマップ
        bearish_choch_indices = set()
        bullish_choch_indices = set()
        for choch in choch_signals:
            if choch.choch_type.value == "BEARISH":
                bearish_choch_indices.add(choch.index)
            else:
                bullish_choch_indices.add(choch.index)

        # シグナル配列（タイムライン用）
        timeline = []
        legacy_signals = []  # 後方互換用

        # ストリーク追跡
        entry_streak = None
        rsi_high_streak = None
        exit_streak = None

        # 閾値
        RSI_HIGH_THRESHOLD = 80
        EMA_CONV_THRESHOLD = 1.5

        def _flush_entry():
            nonlocal entry_streak
            if entry_streak is None:
                return
            s = entry_streak
            timeline.append({
                "date": s["start_date"],
                "end_date": s["end_date"],
                "days": s["days"],
                "type": "ENTRY",
                "price": round(s["start_price"], 2),
                "end_price": round(s["end_price"], 2),
                "detail": f"買いシグナル（RS: {s['rs_trend']}）EMA収束 {s.get('ema_conv', 0):.1f}%",
                "rs_trend": s["rs_trend"],
                "size_pct": s["size_pct"],
            })
            entry_streak = None

        def _flush_rsi():
            nonlocal rsi_high_streak
            if rsi_high_streak is None:
                return
            s = rsi_high_streak
            if s["days"] == 1:
                detail = f"RSI {s['max_rsi']:.0f} — 過熱警告"
            else:
                detail = f"RSI 最大{s['max_rsi']:.0f}（{s['days']}日間連続）"
            timeline.append({
                "date": s["start_date"],
                "end_date": s["end_date"],
                "days": s["days"],
                "type": "RSI_HIGH",
                "price": round(s["start_price"], 2),
                "end_price": round(s["end_price"], 2),
                "detail": detail,
            })
            rsi_high_streak = None

        def _flush_exit():
            nonlocal exit_streak
            if exit_streak is None:
                return
            s = exit_streak
            timeline.append({
                "date": s["start_date"],
                "end_date": s["end_date"],
                "days": s["days"],
                "type": "EXIT",
                "price": round(s["start_price"], 2),
                "end_price": round(s["end_price"], 2),
                "detail": s["detail"],
                "exit_type": s["exit_type"],
                "exit_pct": s.get("exit_pct", 0),
            })
            exit_streak = None

        # 走査開始インデックス（約1年前 or 50日目）
        scan_start = max(50, len(df) - 252) if period == "1y" else 50
        last_bearish_choch_idx = -999

        for i in range(scan_start, len(df)):
            date_str = df['Date'].iloc[i]
            close = float(df['Close'].iloc[i])
            ema_8 = float(df['EMA_8'].iloc[i])
            ema_21 = float(df['EMA_21'].iloc[i])
            rsi = float(df['RSI'].iloc[i]) if not pd.isna(df['RSI'].iloc[i]) else 50.0

            # ===== ENTRY シグナル判定 =====
            # Bearish CHoCH → Bullish CHoCHのシーケンスを確認
            recent_bearish = None
            recent_bullish = None
            for idx in range(max(0, i - 30), i):
                if idx in bearish_choch_indices:
                    recent_bearish = idx
                if idx in bullish_choch_indices and recent_bearish is not None and idx > recent_bearish:
                    recent_bullish = idx

            ema_conv = abs(ema_8 - ema_21) / close * 100
            rs_diff = float(df['RS_diff'].iloc[i]) if 'RS_diff' in df.columns and not pd.isna(df['RS_diff'].iloc[i]) else 0

            entry_allowed = False
            if recent_bearish is not None and recent_bullish is not None:
                if i - recent_bullish <= 5 and ema_conv <= EMA_CONV_THRESHOLD:
                    if mode != "balanced" or rs_diff >= -5:
                        entry_allowed = True

            rs_trend = "UP" if rs_diff >= 0 else ("FLAT" if rs_diff >= -5 else "DOWN")
            size_pct = 100 if rs_trend != "DOWN" else (50 if mode == "conservative" else 0)

            if entry_allowed:
                if entry_streak is None:
                    entry_streak = {
                        "start_date": date_str, "end_date": date_str,
                        "start_price": close, "end_price": close,
                        "rs_trend": rs_trend, "size_pct": size_pct,
                        "ema_conv": ema_conv, "days": 1,
                    }
                else:
                    entry_streak["end_date"] = date_str
                    entry_streak["end_price"] = close
                    entry_streak["days"] += 1
            else:
                _flush_entry()

            # ===== RSI過熱 シグナル判定 =====
            is_rsi_high = rsi >= RSI_HIGH_THRESHOLD
            if is_rsi_high:
                if rsi_high_streak is None:
                    rsi_high_streak = {
                        "start_date": date_str, "end_date": date_str,
                        "max_rsi": rsi, "start_price": close,
                        "end_price": close, "days": 1,
                    }
                else:
                    rsi_high_streak["end_date"] = date_str
                    rsi_high_streak["max_rsi"] = max(rsi_high_streak["max_rsi"], rsi)
                    rsi_high_streak["end_price"] = close
                    rsi_high_streak["days"] += 1
            else:
                _flush_rsi()

            # ===== EXIT シグナル判定 =====
            is_bearish_choch = i in bearish_choch_indices
            ema_death_cross = ema_8 < ema_21

            if is_bearish_choch:
                last_bearish_choch_idx = i

            has_recent_bear_choch = (i - last_bearish_choch_idx) <= 20 if last_bearish_choch_idx >= 0 else False

            # Mirror判定
            mirror_state = ""
            if has_recent_bear_choch and ema_death_cross:
                mirror_state = "FULL"
            elif has_recent_bear_choch and not ema_death_cross:
                mirror_state = "WARN"

            # Exit シグナル発生判定（Entry日はExitシグナルを出さない）
            exit_type = None
            exit_detail = None
            exit_pct = 0

            if not entry_allowed:
                if mirror_state == "FULL":
                    exit_type = "MIRROR_FULL"
                    exit_pct = 100
                    exit_detail = f"Mirror FULL → 100%売却（CHoCH+EMAクロス）"
                elif mirror_state == "WARN":
                    exit_type = "MIRROR_WARN"
                    exit_pct = 50
                    exit_detail = f"Mirror WARN → 50%売却（CHoCH検出）"
                elif is_bearish_choch:
                    exit_type = "BEAR_CHOCH"
                    exit_pct = 0
                    exit_detail = f"Bearish CHoCH（構造転換の兆候）"

            if exit_type:
                if exit_streak is None:
                    exit_streak = {
                        "start_date": date_str, "end_date": date_str,
                        "start_price": close, "end_price": close,
                        "exit_type": exit_type, "detail": exit_detail,
                        "exit_pct": exit_pct, "days": 1,
                    }
                else:
                    if exit_streak["exit_type"] == exit_type:
                        exit_streak["end_date"] = date_str
                        exit_streak["end_price"] = close
                        exit_streak["days"] += 1
                    else:
                        _flush_exit()
                        exit_streak = {
                            "start_date": date_str, "end_date": date_str,
                            "start_price": close, "end_price": close,
                            "exit_type": exit_type, "detail": exit_detail,
                            "exit_pct": exit_pct, "days": 1,
                        }
            else:
                _flush_exit()

            # 後方互換用のシグナル（ENTRY時のみ）
            if entry_allowed and (entry_streak is None or entry_streak["days"] == 1):
                pnl_5d = None
                pnl_10d = None
                pnl_20d = None
                if i + 5 < len(df):
                    pnl_5d = (df['Close'].iloc[i + 5] - close) / close * 100
                if i + 10 < len(df):
                    pnl_10d = (df['Close'].iloc[i + 10] - close) / close * 100
                if i + 20 < len(df):
                    pnl_20d = (df['Close'].iloc[i + 20] - close) / close * 100

                legacy_signals.append({
                    "date": date_str,
                    "price": round(close, 2),
                    "ema_convergence": round(ema_conv, 2),
                    "rs_diff": round(rs_diff, 2),
                    "pnl_5d": round(float(pnl_5d), 2) if pnl_5d is not None and not pd.isna(pnl_5d) else None,
                    "pnl_10d": round(float(pnl_10d), 2) if pnl_10d is not None and not pd.isna(pnl_10d) else None,
                    "pnl_20d": round(float(pnl_20d), 2) if pnl_20d is not None and not pd.isna(pnl_20d) else None,
                    "max_pnl_20d": None,
                    "min_pnl_20d": None,
                })

        # ループ終了後の残りストリークをflush
        _flush_entry()
        _flush_rsi()
        _flush_exit()

        # 時系列ソート
        timeline.sort(key=lambda x: x['date'])

        # 統計計算
        entry_signals = [s for s in timeline if s['type'] == 'ENTRY']
        stats = {
            "total_signals": len(timeline),
            "entry_count": len(entry_signals),
            "exit_count": len([s for s in timeline if s['type'] == 'EXIT']),
            "rsi_high_count": len([s for s in timeline if s['type'] == 'RSI_HIGH']),
            "avg_pnl_5d": None,
            "avg_pnl_10d": None,
            "avg_pnl_20d": None,
            "win_rate_5d": None,
            "win_rate_10d": None,
            "win_rate_20d": None,
        }

        if legacy_signals:
            pnl_5d_list = [s["pnl_5d"] for s in legacy_signals if s["pnl_5d"] is not None]
            pnl_10d_list = [s["pnl_10d"] for s in legacy_signals if s["pnl_10d"] is not None]
            pnl_20d_list = [s["pnl_20d"] for s in legacy_signals if s["pnl_20d"] is not None]

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
            "signals": legacy_signals[-20:],  # 後方互換（ENTRY only）
            "timeline": timeline,  # 全シグナル（demo準拠）
            "total_signals": len(timeline),
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

        # FVG（Fair Value Gap）検出 - 未埋めのみを返す
        all_fvgs = []
        for i in range(2, len(df)):
            prev_high = df['High'].iloc[i-2]
            current_low = df['Low'].iloc[i]
            current_high = df['High'].iloc[i]
            prev_low = df['Low'].iloc[i-2]

            # Bullish FVG: 2本前の高値 < 現在の安値（ギャップアップ）
            if prev_high < current_low:
                gap_size = (current_low - prev_high) / prev_high * 100
                if gap_size >= 1.5:  # 1.5%以上のギャップ（小さいFVGを除外）
                    all_fvgs.append({
                        "index": i,
                        "date": df['Date'].iloc[i],
                        "type": "BULLISH",
                        "top": float(current_low),
                        "bottom": float(prev_high),
                        "gap_pct": round(gap_size, 2),
                    })

            # Bearish FVG: 2本前の安値 > 現在の高値（ギャップダウン）
            if prev_low > current_high:
                gap_size = (prev_low - current_high) / prev_low * 100
                if gap_size >= 1.5:
                    all_fvgs.append({
                        "index": i,
                        "date": df['Date'].iloc[i],
                        "type": "BEARISH",
                        "top": float(prev_low),
                        "bottom": float(current_high),
                        "gap_pct": round(gap_size, 2),
                    })

        # 埋まったFVGを除外（後続の価格がギャップ内に入ったら埋まったとみなす）
        fvg_list = []
        for fvg in all_fvgs:
            filled = False
            for j in range(fvg["index"] + 1, len(df)):
                price_low = df['Low'].iloc[j]
                price_high = df['High'].iloc[j]
                # Bullish FVG: 価格がギャップの下端(bottom)まで下落したら埋まった
                if fvg["type"] == "BULLISH" and price_low <= fvg["bottom"]:
                    filled = True
                    break
                # Bearish FVG: 価格がギャップの上端(top)まで上昇したら埋まった
                if fvg["type"] == "BEARISH" and price_high >= fvg["top"]:
                    filled = True
                    break
            if not filled:
                # indexを削除してからリストに追加
                fvg_clean = {k: v for k, v in fvg.items() if k != "index"}
                fvg_list.append(fvg_clean)

        # 最新10個に制限
        fvg_list = fvg_list[-10:]

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
