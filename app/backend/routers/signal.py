"""
/api/signal/{ticker} - V10シグナル計算

本格版: CombinedEntryDetector V10を使用
- EMA収束閾値: Regime別（BULL=1.3, WEAKENING=1.0, BEAR=0.8, RECOVERY=2.0）
- RS DOWN閾値: 株価カテゴリ別に最適化
- CHoCH検出: Bearish → Bullish シーケンス確認
"""
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional, Dict, Any

_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")
_MODES = {"aggressive", "balanced", "conservative"}
_PERIODS = {"3mo", "6mo", "1y", "2y"}
from datetime import datetime, timedelta
import time
import yfinance as yf

# 本格ロジックをインポート
from analysis.combined_entry_detector import CombinedEntryDetector, EntryMode, EntryAnalysis
from analysis.bos_detector import BOSDetector
from analysis.choch_detector import CHoCHDetector
from analysis.exit_manager import evaluate_trade, evaluate_current
from analysis.regime_detector import RegimeDetector
from analysis.asset_class import AssetClass, normalize_ticker_yfinance, get_config
from analysis.market_structure import MarketStructure
from analysis.order_block_detector import OrderBlockDetector
from analysis.ote_calculator import OTECalculator
from analysis.premium_discount_detector import PremiumDiscountCalculator
from auth import require_proxy

router = APIRouter(dependencies=[Depends(require_proxy)])


def _detect_asset_class(ticker: str) -> AssetClass:
    """ティッカー形式から資産クラスを自動判定"""
    if re.match(r'^\d+(\.T)?$', ticker, re.IGNORECASE):
        return AssetClass.JP_STOCK
    return AssetClass.US_STOCK

# L1+L2 キャッシュ (インメモリ + Redis)
from redis_cache import cache_get as _cache_get, cache_set as _cache_set
from market_hours import adaptive_ttl
_SIGNAL_TTL = 300  # 5分 (秒)


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
    name: Optional[str] = None
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
    benchmark_ticker: str = "SPY"
    benchmark_price: float = 0.0
    benchmark_ema_long: float = 0.0
    ema_short_slope: float = 0.0

    # モード別判定
    mode: str
    entry_allowed: bool
    position_size_pct: int
    mode_note: str
    other_modes: Dict[str, ModeResult]

    # V11: BOS Confidence
    bos_confidence: float = 1.0     # 0.4〜1.0
    bos_grade: str = "NONE"         # EXTENSION / REVERSAL / CONTINUATION / NONE

    # V12: Entry Timing
    entry_timing: str = "NEXT_OPEN"  # 翌営業日の寄付き成行


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
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")
    if mode.lower() not in _MODES:
        raise HTTPException(status_code=400, detail="Invalid mode")
    entry_mode = entry_mode_from_str(mode)

    # 資産クラス自動判定 + yfinance用ティッカー正規化
    asset_class = _detect_asset_class(ticker)
    yf_ticker = normalize_ticker_yfinance(ticker, asset_class)

    # キャッシュチェック (L1 インメモリ → L2 Redis)
    # v2: 旧キャッシュには yfinance の未確定バー由来の NaN が入っていることが
    # あり、FastAPI のレスポンス JSON シリアライズ (allow_nan=False) で 500 に
    # なるため、キー prefix を bump して旧データを無視する。
    cache_key = f"signal:v2:{ticker}:{mode}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        # CombinedEntryDetector V10を使用
        detector = CombinedEntryDetector(
            asset_class=asset_class,
            use_v9_regime=True,
            use_v10_price_category=True
        )

        result: EntryAnalysis = detector.analyze(yf_ticker, entry_mode)

        # 企業名取得（yfinance info から）
        stock_name: Optional[str] = None
        try:
            stock_name = yf.Ticker(yf_ticker).info.get("shortName")
        except Exception:
            pass

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

        response = SignalResponse(
            ticker=ticker,  # ユーザー入力のティッカーを返す（yfinance正規化前）
            name=stock_name,
            timestamp=datetime.now().isoformat(),
            price=result.price,
            price_change_pct=result.price_change_pct,
            price_category=result.price_category,
            combined_ready=result.combined_ready,
            conditions=conditions,
            relative_strength=relative_strength,
            regime=result.regime,
            benchmark_ticker=result.benchmark_ticker,
            benchmark_price=result.benchmark_price,
            benchmark_ema_long=result.benchmark_ema_long,
            ema_short_slope=result.ema_short_slope,
            mode=result.mode,
            entry_allowed=result.entry_allowed,
            position_size_pct=result.position_size_pct,
            mode_note=result.mode_note,
            other_modes=other_modes,
            bos_confidence=result.bos_confidence,
            bos_grade=result.bos_grade,
            entry_timing=result.entry_timing,
        )

        _cache_set(cache_key, response.model_dump(), ttl=adaptive_ttl(_SIGNAL_TTL, ticker))
        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


class BatchRequest(BaseModel):
    """バッチリクエスト"""
    tickers: list[str]  # max 50 tickers
    mode: str = "balanced"

    @field_validator("tickers")
    @classmethod
    def validate_tickers(cls, v: list[str]) -> list[str]:
        if len(v) > 50:
            raise ValueError("Maximum 50 tickers allowed")
        if len(v) == 0:
            raise ValueError("At least 1 ticker required")
        import re
        pattern = re.compile(r"^[A-Z0-9.\-]{1,10}$")
        return [t.upper() for t in v if pattern.match(t.upper())]

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        if v.lower() not in {"aggressive", "balanced", "conservative"}:
            raise ValueError("mode must be aggressive, balanced, or conservative")
        return v.lower()


class BatchResult(BaseModel):
    """バッチ結果（1銘柄）"""
    ticker: str
    name: Optional[str] = None
    price: Optional[float] = None
    price_change_pct: Optional[float] = None
    combined_ready: bool = False
    entry_allowed: bool = False
    position_size_pct: int = 0
    relative_strength: Optional[Dict[str, Any]] = None
    regime: Optional[str] = None
    exit_atr_floor: Optional[float] = None
    # 4層決済システム判定（evaluate_current ベース）
    exit_verdict: Optional[str] = None       # 全売却 / 50%売却 / 保有継続 / ポジションなし
    exit_verdict_color: Optional[str] = None  # red / orange / emerald / zinc
    exit_verdict_reason: Optional[str] = None
    exit_verdict_sell_pct: Optional[int] = None
    exit_unrealized_pct: Optional[float] = None
    exit_holding_days: Optional[int] = None
    exit_entry_date: Optional[str] = None
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
    import pandas as pd
    entry_mode = entry_mode_from_str(request.mode)
    results = []
    entry_ready_count = 0

    for ticker in request.tickers:
        ticker = ticker.upper()
        try:
            asset_class = _detect_asset_class(ticker)
            yf_ticker = normalize_ticker_yfinance(ticker, asset_class)

            # DataFrame を先に取得 → entry と ATR Floor で共有
            stock = yf.Ticker(yf_ticker)
            stock_df = stock.history(period="6mo")
            if stock_df.empty:
                results.append(BatchResult(ticker=ticker, error=True, error_message="No data"))
                continue
            # Date カラムを確保（CombinedEntryDetector の RS 計算で必要）
            if 'Date' not in stock_df.columns:
                stock_df = stock_df.reset_index()
                if 'index' in stock_df.columns:
                    stock_df = stock_df.rename(columns={'index': 'Date'})

            detector = CombinedEntryDetector(
                asset_class=asset_class,
                use_v9_regime=True,
                use_v10_price_category=True
            )
            result = detector.analyze(yf_ticker, entry_mode, stock_df=stock_df)

            # 企業名取得
            batch_name: Optional[str] = None
            try:
                batch_name = stock.info.get("shortName")
            except Exception:
                pass

            if result.entry_allowed:
                entry_ready_count += 1

            # 4層決済システム判定（直近BUYエントリーに対して evaluate_current）
            exit_atr_floor = None
            exit_verdict_data: Dict[str, Any] = {}
            try:
                from analysis.choch_detector import CHoCHDetector, CHoCHType
                from analysis.exit_manager import evaluate_current as _eval_cur, HoldingStatus as _HS2

                # EMA/ATR が未計算なら計算
                if 'EMA_8' not in stock_df.columns:
                    stock_df['EMA_8'] = stock_df['Close'].ewm(span=8, adjust=False).mean()
                if 'EMA_21' not in stock_df.columns:
                    stock_df['EMA_21'] = stock_df['Close'].ewm(span=21, adjust=False).mean()
                if 'ATR' not in stock_df.columns:
                    stock_df['ATR'] = pd.DataFrame({
                        'hl': stock_df['High'] - stock_df['Low'],
                        'hc': abs(stock_df['High'] - stock_df['Close'].shift(1)),
                        'lc': abs(stock_df['Low'] - stock_df['Close'].shift(1))
                    }).max(axis=1).rolling(14).mean()
                if 'Date' not in stock_df.columns:
                    stock_df = stock_df.reset_index()
                    if 'index' in stock_df.columns:
                        stock_df = stock_df.rename(columns={'index': 'Date'})

                choch_det = CHoCHDetector(swing_lookback=3)
                choch_sigs = choch_det.detect_choch(stock_df)

                # 直近のBUYエントリー（Bullish CHoCH + EMA GC）を検索
                latest_entry = None
                for c in reversed(choch_sigs):
                    if c.type == CHoCHType.BULLISH and c.index >= 21 and c.index < len(stock_df):
                        e8 = stock_df['EMA_8'].iloc[c.index]
                        e21 = stock_df['EMA_21'].iloc[c.index]
                        if not pd.isna(e8) and not pd.isna(e21) and e8 > e21:
                            latest_entry = c.index
                            break

                if latest_entry is not None:
                    ep = float(stock_df['Close'].iloc[latest_entry])
                    ea = float(stock_df['ATR'].iloc[latest_entry]) if pd.notna(stock_df['ATR'].iloc[latest_entry]) else 1.0
                    cur_idx = len(stock_df) - 1
                    entry_date_str = str(stock_df['Date'].iloc[latest_entry])[:10]

                    # ATR Floor
                    exit_atr_floor = round(ep - ea * 3.0, 2)

                    # evaluate_current
                    hs = _eval_cur(stock_df, latest_entry, ep, ea, result.regime or "BULL", choch_sigs, cur_idx)
                    if isinstance(hs, _HS2):
                        ccy = '¥' if asset_class == 'JP' else '$'
                        if hs.atr_floor_triggered:
                            exit_verdict_data = {"verdict": "全売却", "color": "red", "sell_pct": 100, "reason": f"損切ライン {ccy}{exit_atr_floor} 割れ"}
                        elif hs.bearish_choch_detected and hs.ema_death_cross:
                            exit_verdict_data = {"verdict": "全売却", "color": "red", "sell_pct": 100, "reason": "反転全決済: 転換 + EMAデスクロス"}
                        elif hs.bearish_choch_detected:
                            exit_verdict_data = {"verdict": "50%売却", "color": "orange", "sell_pct": 50, "reason": "弱気転換検出"}
                        elif hs.nearest_exit_reason == "Time_Stop":
                            exit_verdict_data = {"verdict": "全売却", "color": "orange", "sell_pct": 100, "reason": "保有期限到達"}
                        elif hs.trail_active:
                            exit_verdict_data = {"verdict": "保有継続", "color": "emerald", "sell_pct": 0, "reason": f"利確ストップ稼働中 {ccy}{hs.trail_stop_price:.2f}" if hs.trail_stop_price else "利確ストップ稼働中"}
                        else:
                            exit_verdict_data = {"verdict": "保有継続", "color": "emerald", "sell_pct": 0, "reason": "全条件クリア"}
                        exit_verdict_data["unrealized_pct"] = round(float(hs.unrealized_pct), 1)
                        exit_verdict_data["holding_days"] = int(hs.holding_days)
                        exit_verdict_data["entry_date"] = entry_date_str
                    else:
                        # TradeResult = 既にExit済み
                        exit_verdict_data = {"verdict": "決済済", "color": "zinc", "sell_pct": 0, "reason": "直近BUYは決済済み"}
                else:
                    exit_verdict_data = {"verdict": "ポジションなし", "color": "zinc", "sell_pct": 0, "reason": "買いシグナル待ち"}
            except Exception:
                pass

            results.append(BatchResult(
                ticker=ticker,
                name=batch_name,
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
                exit_atr_floor=exit_atr_floor,
                exit_verdict=exit_verdict_data.get("verdict"),
                exit_verdict_color=exit_verdict_data.get("color"),
                exit_verdict_reason=exit_verdict_data.get("reason"),
                exit_verdict_sell_pct=exit_verdict_data.get("sell_pct"),
                exit_unrealized_pct=exit_verdict_data.get("unrealized_pct"),
                exit_holding_days=exit_verdict_data.get("holding_days"),
                exit_entry_date=exit_verdict_data.get("entry_date"),
                error=False,
            ))
        except Exception as e:
            results.append(BatchResult(
                ticker=ticker,
                error=True,
                error_message="Analysis failed",
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
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")

    asset_class = _detect_asset_class(ticker)
    yf_ticker = normalize_ticker_yfinance(ticker, asset_class)

    try:
        import pandas as pd
        from cache_utils import fetch_ohlcv_cached

        # 株価データ取得（L2 DBキャッシュ付き）
        df = fetch_ohlcv_cached(yf_ticker, "6mo")

        if df is None or df.empty:
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
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{ticker}/history")
async def get_signal_history(
    ticker: str,
    period: str = Query("1y", description="分析期間: 3mo, 6mo, 1y, 2y"),
    mode: str = Query("balanced", description="取引モード"),
    exit_mode: str = Query("standard", description="Exit戦略: stable(安定), standard(標準)"),
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
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")
    if period not in _PERIODS:
        raise HTTPException(status_code=400, detail="Invalid period")
    if mode.lower() not in _MODES:
        raise HTTPException(status_code=400, detail="Invalid mode")
    from analysis.exit_manager import _EXIT_MODES, EXIT_MODE_STANDARD
    if exit_mode.lower() not in _EXIT_MODES:
        raise HTTPException(status_code=400, detail="Invalid exit_mode. Use 'stable' or 'standard'")
    exit_mode = exit_mode.lower()

    asset_class = _detect_asset_class(ticker)
    yf_ticker = normalize_ticker_yfinance(ticker, asset_class)
    benchmark_ticker = get_config(asset_class).regime.benchmark_ticker

    # キャッシュチェック (L1 インメモリ → L2 Redis)
    cache_key = f"signal_hist:v2:{ticker}:{period}:{mode}:{exit_mode}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        import pandas as pd
        import numpy as np
        from cache_utils import fetch_ohlcv_cached

        # 株価データ取得（L2 DBキャッシュ付き）
        actual_period = "2y" if period == "1y" else period
        df = fetch_ohlcv_cached(yf_ticker, actual_period)

        if df is None or df.empty or len(df) < 50:
            raise HTTPException(status_code=404, detail=f"Insufficient data for {ticker}")

        # 日付をDateカラムに
        if 'Date' in df.columns and hasattr(df['Date'].iloc[0], 'strftime'):
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

        # EMA distance (ATR-normalized) — V10準拠
        df['EMA_distance_atr'] = abs(df['EMA_8'] - df['EMA_21']) / df['ATR']

        # ベンチマークデータ取得（RS計算 + V10 Regime判定の両方で使用）
        spy_regime_map = {}  # date -> regime string
        try:
            spy_raw = fetch_ohlcv_cached(benchmark_ticker, actual_period)
            if spy_raw is not None and not spy_raw.empty:
                if 'Date' in spy_raw.columns and hasattr(spy_raw['Date'].iloc[0], 'strftime'):
                    spy_raw['Date_str'] = spy_raw['Date'].dt.strftime('%Y-%m-%d')
                else:
                    spy_raw['Date_str'] = spy_raw['Date'].astype(str)

                # RS計算用
                if len(spy_raw) >= 20:
                    spy_raw['RS'] = spy_raw['Close'].pct_change(20) * 100
                    df = df.merge(
                        spy_raw[['Date_str', 'RS']].rename(columns={'Date_str': 'Date', 'RS': 'SPY_RS'}),
                        on='Date', how='left'
                    )
                    df['RS'] = df['Close'].pct_change(20) * 100
                    df['RS_diff'] = df['RS'] - df['SPY_RS'].fillna(0)

                # V10: Regime判定用（SPY EMA_21 vs EMA_200 + slope）
                spy_raw['EMA_21'] = spy_raw['Close'].ewm(span=21, adjust=False).mean()
                spy_raw['EMA_200'] = spy_raw['Close'].ewm(span=200, adjust=False).mean()
                spy_raw['EMA_21_slope'] = spy_raw['EMA_21'].diff(5)
                for si in range(max(0, len(spy_raw) - 300), len(spy_raw)):
                    c = float(spy_raw['Close'].iloc[si])
                    ema200 = float(spy_raw['EMA_200'].iloc[si])
                    slope = float(spy_raw['EMA_21_slope'].iloc[si]) if not pd.isna(spy_raw['EMA_21_slope'].iloc[si]) else 0
                    above = c > ema200
                    up = slope > 0
                    if above and up:
                        r = "BULL"
                    elif above and not up:
                        r = "WEAKENING"
                    elif not above and up:
                        r = "RECOVERY"
                    else:
                        r = "BEAR"
                    spy_regime_map[spy_raw['Date_str'].iloc[si]] = r
        except Exception:
            pass

        if 'RS_diff' not in df.columns:
            df['RS_diff'] = 0

        highs = df['High'].tolist()
        lows = df['Low'].tolist()
        closes = df['Close'].tolist()

        # BOS/CHoCH検出
        bos_detector = BOSDetector()
        bos_signals = bos_detector.detect_bos(highs, lows)
        choch_signals = bos_detector.detect_choch(highs, lows)

        # ExitManager用: CHoCHDetector (evaluate_trade が .type 属性を参照)
        exit_choch_detector = CHoCHDetector(swing_lookback=3)
        exit_choch_signals = exit_choch_detector.detect_choch(df)

        # V10準拠: CHoCHをリスト形式で保持（直近N個を検索するため）
        choch_list = []  # [(index, type_str), ...]
        for choch in choch_signals:
            choch_list.append((choch.index, choch.choch_type.value))
        choch_list.sort(key=lambda x: x[0])

        # 後方互換用にインデックスセットも保持
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
        entry_points = []  # ExitManager用: [{entry_idx, entry_price, entry_atr, regime}, ...]

        # ストリーク追跡
        entry_streak = None
        rsi_high_streak = None
        exit_streak = None

        # 閾値
        RSI_HIGH_THRESHOLD = 80
        CHOCH_SEARCH_COUNT = CombinedEntryDetector.CHOCH_SEARCH_COUNT  # 10

        # V10: 株価カテゴリ別RS閾値（CombinedEntryDetectorと同一ロジック）
        def _get_rs_threshold(price: float) -> float:
            cat = CombinedEntryDetector.categorize_price(price)
            return CombinedEntryDetector.V10_RS_DOWN_THRESHOLD.get(cat, -5.0)

        # V10: Regime別EMA閾値（CombinedEntryDetectorと同一ロジック）
        def _get_ema_threshold(date_str: str) -> float:
            regime = spy_regime_map.get(date_str, "BULL")
            return CombinedEntryDetector.V9_EMA_THRESHOLD.get(regime, 1.5)

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
                "detail": f"買いシグナル（RS: {s['rs_trend']}）EMA収束 {s.get('ema_conv', 0):.2f}ATR",
                "rs_trend": s["rs_trend"],
                "size_pct": s["size_pct"],
            })
            # ExitManager用: エントリーポイント記録（Open entry = 翌日Open想定だがClose近似）
            entry_idx = s.get("start_idx", 0)
            entry_atr = float(df['ATR'].iloc[entry_idx]) if not pd.isna(df['ATR'].iloc[entry_idx]) else 0
            regime = spy_regime_map.get(s["start_date"], "BULL")
            entry_points.append({
                "entry_idx": entry_idx,
                "entry_price": s["start_price"],
                "entry_atr": entry_atr if entry_atr > 0 else s["start_price"] * 0.05,
                "regime": regime,
                "date": s["start_date"],
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

            # ===== ENTRY シグナル判定（V10準拠） =====
            # V10: 直近CHOCH_SEARCH_COUNT個のCHoCHから Bearish → Bullish シーケンスを確認
            recent_chochs = [c for c in choch_list if c[0] <= i]
            recent_chochs = recent_chochs[-CHOCH_SEARCH_COUNT:]

            # 最新のBullish CHoCHを探す
            latest_bullish_idx = None
            for c_idx, c_type in reversed(recent_chochs):
                if c_type == "BULLISH":
                    latest_bullish_idx = c_idx
                    break

            # そのBullishより前のBearish CHoCHを探す（V10: 途中に別Bullishがあれば停止）
            bearish_found = False
            if latest_bullish_idx is not None:
                for c_idx, c_type in reversed(recent_chochs):
                    if c_idx >= latest_bullish_idx:
                        continue
                    if c_type == "BULLISH":
                        break  # 別のBullishが先 → Bearish先行条件不成立
                    if c_type == "BEARISH":
                        bearish_found = True
                        break

            # V10: EMA収束 = |EMA8-EMA21| / ATR（ATR正規化）
            atr_val = float(df['ATR'].iloc[i]) if not pd.isna(df['ATR'].iloc[i]) else 0
            ema_conv = abs(ema_8 - ema_21) / atr_val if atr_val > 0 else float('inf')
            ema_threshold = _get_ema_threshold(date_str)

            rs_diff = float(df['RS_diff'].iloc[i]) if 'RS_diff' in df.columns and not pd.isna(df['RS_diff'].iloc[i]) else 0

            entry_allowed = False
            if bearish_found and latest_bullish_idx is not None:
                if ema_conv <= ema_threshold:
                    rs_threshold = _get_rs_threshold(close)
                    if mode != "balanced" or rs_diff >= rs_threshold:
                        entry_allowed = True

            rs_threshold_for_trend = _get_rs_threshold(close)
            rs_trend = "UP" if rs_diff >= 0 else ("FLAT" if rs_diff >= rs_threshold_for_trend else "DOWN")
            size_pct = 100 if rs_trend != "DOWN" else (50 if mode == "conservative" else 0)

            if entry_allowed:
                if entry_streak is None:
                    entry_streak = {
                        "start_date": date_str, "end_date": date_str,
                        "start_price": close, "end_price": close,
                        "rs_trend": rs_trend, "size_pct": size_pct,
                        "ema_conv": ema_conv, "days": 1,
                        "start_idx": i,
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

        # ===== ExitManager: 各エントリーに対してevaluate_tradeを実行 =====
        trade_results = []
        for ep in entry_points:
            try:
                result = evaluate_trade(
                    df=df,
                    entry_idx=ep["entry_idx"],
                    entry_price=ep["entry_price"],
                    entry_atr=ep["entry_atr"],
                    regime=ep["regime"],
                    choch_signals=exit_choch_signals,
                    exit_mode=exit_mode,
                )
                if result is None:
                    continue  # データ不足でトレード未完了
                if result.exit_idx <= ep["entry_idx"]:
                    continue  # 0日保有（データ末尾エントリー）はスキップ

                # partial exit (CHoCH 50%売却) — 同日でなければ 2 レコード、同日なら 1 レコード (blend)
                has_split_partial = (
                    result.partial_exit_price is not None
                    and result.partial_exit_idx != result.exit_idx
                )

                if has_split_partial:
                    p_ret = (result.partial_exit_price - ep["entry_price"]) / ep["entry_price"] * 100
                    p_date = df['Date'].iloc[result.partial_exit_idx] if result.partial_exit_idx < len(df) else ep["date"]
                    p_days = result.partial_exit_idx - ep["entry_idx"]
                    trade_results.append({
                        "entry_date": ep["date"],
                        "exit_date": p_date,
                        "entry_price": ep["entry_price"],
                        "exit_price": result.partial_exit_price,
                        "exit_reason": "Mirror_Partial",
                        "return_pct": p_ret,
                        "holding_days": p_days,
                    })
                    timeline.append({
                        "date": p_date,
                        "type": "TRADE_EXIT",
                        "price": round(result.partial_exit_price, 2),
                        "detail": f"Mirror_Partial → {p_ret:+.1f}%（{p_days}日保有）",
                        "exit_reason": "Mirror_Partial",
                        "return_pct": round(p_ret, 2),
                        "holding_days": p_days,
                        "entry_date": ep["date"],
                        "entry_price": round(ep["entry_price"], 2),
                    })

                # full exit レコード（同日 partial の場合は blend して 1 レコード）
                if result.partial_exit_price is not None and not has_split_partial:
                    # 同日: 50% × partial + 50% × full の blend
                    blended_price = result.partial_exit_price * 0.5 + result.exit_price * 0.5
                    ret_pct = (blended_price - ep["entry_price"]) / ep["entry_price"] * 100
                    exit_reason = result.exit_reason
                else:
                    ret_pct = (result.exit_price - ep["entry_price"]) / ep["entry_price"] * 100
                    blended_price = result.exit_price
                    exit_reason = result.exit_reason
                exit_date = df['Date'].iloc[result.exit_idx] if result.exit_idx < len(df) else ep["date"]
                trade_results.append({
                    "entry_date": ep["date"],
                    "exit_date": exit_date,
                    "entry_price": ep["entry_price"],
                    "exit_price": blended_price,
                    "exit_reason": exit_reason,
                    "return_pct": ret_pct,
                    "holding_days": result.exit_idx - ep["entry_idx"],
                })
                timeline.append({
                    "date": exit_date,
                    "type": "TRADE_EXIT",
                    "price": round(result.exit_price, 2),
                    "detail": f"{result.exit_reason} → {ret_pct:+.1f}%（{result.exit_idx - ep['entry_idx']}日保有）",
                    "exit_reason": result.exit_reason,
                    "return_pct": round(ret_pct, 2),
                    "holding_days": result.exit_idx - ep["entry_idx"],
                    "entry_date": ep["date"],
                    "entry_price": round(ep["entry_price"], 2),
                })
            except Exception:
                pass

        # ===== 各エントリーに対して evaluate_current を実行（今日時点のExit状態） =====
        from analysis.exit_manager import TradeResult as _TR, HoldingStatus as _HS
        live_exit_statuses = []
        current_idx = len(df) - 1
        current_close = float(df['Close'].iloc[current_idx]) if current_idx < len(df) else 0

        for ep in entry_points:
            try:
                result = evaluate_current(
                    df=df,
                    entry_idx=ep["entry_idx"],
                    entry_price=ep["entry_price"],
                    entry_atr=ep["entry_atr"],
                    regime=ep["regime"],
                    choch_signals=exit_choch_signals,
                    current_idx=current_idx,
                    exit_mode=exit_mode,
                )
                if result is None:
                    continue

                if isinstance(result, _HS):
                    # アクティブポジション（Exit未発動）
                    live_exit_statuses.append({
                        "entry_date": ep["date"],
                        "entry_price": float(ep["entry_price"]),
                        "entry_regime": ep["regime"],
                        "holding_days": int(result.holding_days),
                        "unrealized_pct": round(float(result.unrealized_pct), 2),
                        "atr_floor_price": round(float(result.atr_floor_price), 2),
                        "atr_floor_triggered": bool(result.atr_floor_triggered),
                        "partial_exit_done": bool(result.partial_exit_done),
                        "bearish_choch_detected": bool(result.bearish_choch_detected),
                        "choch_exit_date": df['Date'].iloc[result.choch_exit_idx] if result.choch_exit_idx is not None and result.choch_exit_idx < len(df) else None,
                        "ema_death_cross": bool(result.ema_death_cross),
                        "trail_active": bool(result.trail_active),
                        "trail_stop_price": round(float(result.trail_stop_price), 2) if result.trail_stop_price else None,
                        "highest_price": round(float(result.highest_price), 2),
                        "nearest_exit_reason": result.nearest_exit_reason,
                        "trade_completed": False,
                    })
                elif isinstance(result, _TR):
                    # Exit条件が途中で発動したポジション（システム判定では売却済み）
                    entry_price = float(ep["entry_price"])
                    unrealized = (current_close / entry_price - 1) * 100 if entry_price > 0 else 0
                    atr_floor = entry_price - float(ep["entry_atr"]) * 3.0
                    had_partial = result.partial_exit_price is not None
                    live_exit_statuses.append({
                        "entry_date": ep["date"],
                        "entry_price": entry_price,
                        "entry_regime": ep["regime"],
                        "holding_days": current_idx - ep["entry_idx"],
                        "unrealized_pct": round(unrealized, 2),
                        "atr_floor_price": round(atr_floor, 2),
                        "atr_floor_triggered": "ATR_Floor" in result.exit_reason,
                        "partial_exit_done": had_partial,
                        "bearish_choch_detected": had_partial,
                        "ema_death_cross": had_partial and "Mirror" in result.exit_reason,
                        "trail_active": "Trail" in result.exit_reason,
                        "trail_stop_price": None,
                        "highest_price": round(current_close, 2),
                        "nearest_exit_reason": result.exit_reason,
                        "trade_completed": True,
                    })
            except Exception:
                pass

        # 時系列ソート
        timeline.sort(key=lambda x: x['date'])

        # 統計計算 — ポジション単位 (partial + full を 1 ポジションとして集計)
        entry_signals = [s for s in timeline if s['type'] == 'ENTRY']
        positions_by_entry = {}
        for t in trade_results:
            positions_by_entry.setdefault(t["entry_date"], []).append(t)
        stats = {
            "total_signals": len(timeline),
            "entry_count": len(entry_signals),
            "exit_count": len([s for s in timeline if s['type'] == 'EXIT']),
            "trade_exit_count": len(positions_by_entry),
            "rsi_high_count": len([s for s in timeline if s['type'] == 'RSI_HIGH']),
            "avg_pnl_5d": None,
            "avg_pnl_10d": None,
            "avg_pnl_20d": None,
            "win_rate_5d": None,
            "win_rate_10d": None,
            "win_rate_20d": None,
        }

        # PatB Exit統計 — ポジション単位で集計
        if positions_by_entry:
            pos_rets = []
            pos_hold_days = []
            for legs in positions_by_entry.values():
                if len(legs) >= 2:
                    blended = legs[0]["return_pct"] * 0.5 + legs[1]["return_pct"] * 0.5
                    hold = max(l["holding_days"] for l in legs)
                else:
                    blended = legs[0]["return_pct"]
                    hold = legs[0]["holding_days"]
                pos_rets.append(blended)
                pos_hold_days.append(hold)
            wins = [r for r in pos_rets if r > 0]
            losses = [r for r in pos_rets if r <= 0]
            pf = sum(wins) / abs(sum(losses)) if losses and sum(losses) != 0 else float('inf')
            stats["patb_trades"] = len(pos_rets)
            stats["patb_avg_pnl"] = round(float(np.mean(pos_rets)), 2)
            stats["patb_median_pnl"] = round(float(np.median(pos_rets)), 2)
            stats["patb_win_rate"] = round(len(wins) / len(pos_rets) * 100, 1)
            stats["patb_pf"] = round(pf, 2) if pf != float('inf') else None
            stats["patb_avg_hold_days"] = round(float(np.mean(pos_hold_days)), 1)

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

        result = {
            "ticker": ticker,
            "period": period,
            "mode": mode,
            "timestamp": datetime.now().isoformat(),
            "signals": legacy_signals[-20:],  # 後方互換（ENTRY only）
            "timeline": timeline,  # 全シグナル（demo準拠）
            "total_signals": len(timeline),
            "stats": stats,
            "trade_results": trade_results,
            "live_exit_statuses": live_exit_statuses,
        }

        _cache_set(cache_key, result, ttl=adaptive_ttl(_SIGNAL_TTL, ticker))
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{ticker}/regime")
async def get_regime_for_ticker(ticker: str):
    """
    銘柄に関連するMarket Regime情報

    - **ticker**: 銘柄コード (例: NVDA)

    Returns:
        Market Regime, ベンチマーク情報
    """
    ticker = ticker.upper()

    # キャッシュチェック (L1 インメモリ → L2 Redis)
    regime_key = f"regime:{ticker}"
    cached = _cache_get(regime_key)
    if cached is not None:
        return cached

    try:
        detector = RegimeDetector(use_4regime=True)
        result = detector.detect()

        response = {
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

        _cache_set(regime_key, response, ttl=adaptive_ttl(_SIGNAL_TTL, ticker))
        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


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
    asset_class = _detect_asset_class(ticker)
    yf_ticker = normalize_ticker_yfinance(ticker, asset_class)

    # キャッシュチェック (L1 インメモリ → L2 Redis)
    cache_key = f"markers:v2:{ticker}:{period}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        import pandas as pd
        from cache_utils import fetch_ohlcv_cached

        # 株価データ取得（L2 DBキャッシュ付き）
        df = fetch_ohlcv_cached(yf_ticker, period)

        if df is None or df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {ticker}")

        # 日付をDateカラムに
        if 'Date' in df.columns and hasattr(df['Date'].iloc[0], 'strftime'):
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
                # V11: CE (Consequent Encroachment) = FVGの中間ライン
                ce_level = round((fvg["top"] + fvg["bottom"]) / 2, 2)
                fvg_clean = {k: v for k, v in fvg.items() if k != "index"}
                fvg_clean["ce_level"] = ce_level
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

        # V11: Order Block検出
        ob_list = []
        try:
            # BOS/CHoCHイベントをbreak_eventsに変換
            break_events = []
            for b in bos_signals:
                break_events.append({'index': b.index, 'direction': b.bos_type.value})
            for c in choch_signals:
                break_events.append({'index': c.index, 'direction': c.choch_type.value})

            ob_detector = OrderBlockDetector()
            active_obs = ob_detector.detect(df, break_events)
            for ob in active_obs:
                ob_list.append({
                    "zone_high": round(ob.zone_high, 2),
                    "zone_low": round(ob.zone_low, 2),
                    "direction": ob.direction,
                    "freshness": ob.freshness,
                    "cisd_confirmed": ob.cisd_confirmed,
                    "start_date": ob.date,
                    "status": ob.status,
                })
        except Exception:
            pass

        # V11: OTE Zone計算
        ote_list = []
        try:
            ms = MarketStructure(df)
            med_highs, med_lows = ms.swings('medium')

            choch_events_for_ote = []
            for c in choch_signals:
                choch_events_for_ote.append({
                    'index': c.index,
                    'type': c.choch_type.value,
                    'price': c.price,
                    'previous_swing': c.previous_price,
                })

            ote_calc = OTECalculator()
            current_idx = len(df) - 1
            ote_zones = ote_calc.calculate(choch_events_for_ote, med_highs, med_lows, current_idx)
            for z in ote_zones:
                ote_list.append({
                    "upper": round(z.upper, 2),
                    "lower": round(z.lower, 2),
                    "fib_62": round(z.fib_62, 2),
                    "fib_79": round(z.fib_79, 2),
                    "swing_a": round(z.swing_a, 2),
                    "swing_b": round(z.swing_b, 2),
                    "direction": z.direction,
                    "status": z.status,
                })
        except Exception:
            pass

        # V12: Premium/Discount Zone（Dealing Range内の現在価格位置）
        pd_zone = None
        try:
            if 'ms' not in locals():
                ms = MarketStructure(df)
            coarse_highs, coarse_lows = ms.swings('coarse')
            current_price = float(df['Close'].iloc[-1])
            pd_calc = PremiumDiscountCalculator()
            pd_result = pd_calc.calculate(coarse_highs, coarse_lows, current_price)
            if pd_result:
                pd_zone = {
                    "swing_high": pd_result.swing_high,
                    "swing_low": pd_result.swing_low,
                    "equilibrium": pd_result.equilibrium,
                    "current_price": pd_result.current_price,
                    "position": pd_result.position,
                    "zone": pd_result.zone,
                    "swing_high_date": pd_result.swing_high_date,
                    "swing_low_date": pd_result.swing_low_date,
                }
        except Exception:
            pass

        response = {
            "ticker": ticker,
            "period": period,
            "timestamp": datetime.now().isoformat(),
            "bos": bos_list,
            "choch": choch_list,
            "fvg": fvg_list,
            "order_blocks": ob_list,
            "ote_zones": ote_list,
            "premium_discount": pd_zone,
            "data_points": len(df),
        }

        _cache_set(cache_key, response, ttl=adaptive_ttl(_SIGNAL_TTL, ticker))
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
