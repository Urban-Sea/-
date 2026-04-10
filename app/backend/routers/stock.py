"""
/api/stock - 株価データAPI（二段キャッシュ付き）

L1: インメモリキャッシュ（同一プロセス内、0ms）
L2: Redis キャッシュ（全ユーザー共有、~1ms）
L3: yfinance API（200-500ms/銘柄）
"""
import re
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import asyncio

import main as app_main
from analysis.asset_class import AssetClass, normalize_ticker_yfinance
from auth import require_proxy

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_proxy)])

# --- 入力バリデーション ---
_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,15}$")


def _to_yf(ticker: str) -> str:
    """ティッカーをyfinance形式に正規化（日本株: 7203 → 7203.T）"""
    if re.match(r'^\d+(\.T)?$', ticker, re.IGNORECASE):
        return normalize_ticker_yfinance(ticker, AssetClass.JP_STOCK)
    return ticker
_ALLOWED_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}
_ALLOWED_INTERVALS = {"1m", "5m", "15m", "1h", "1d", "1wk", "1mo"}

# L1+L2 キャッシュ (インメモリ + Redis)
from redis_cache import cache_get as _cache_get, cache_set as _cache_set
from market_hours import adaptive_ttl
_QUOTE_TTL = 300     # 5分 (現在価格・info: リアルタイム性必要)
_HISTORY_TTL = 86400  # 24時間 (OHLCV 履歴: 営業日終了後に確定し変動なし)
_EMA_TTL = 86400      # 24時間 (日足ベース EMA: 営業日終了後に確定)
_executor = ThreadPoolExecutor(max_workers=10)


class StockQuote(BaseModel):
    """株価クオート"""
    ticker: str
    price: float
    change: float
    change_pct: float
    high: float
    low: float
    open: float
    prev_close: float
    volume: int
    market_cap: Optional[int] = None
    updated_at: str


class StockHistory(BaseModel):
    """株価履歴"""
    ticker: str
    period: str
    data: List[dict]
    updated_at: str


class StockInfo(BaseModel):
    """株価情報（詳細）"""
    ticker: str
    name: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    market_cap: Optional[int] = None
    pe_ratio: Optional[float] = None
    eps: Optional[float] = None
    dividend_yield: Optional[float] = None
    beta: Optional[float] = None
    week_52_high: Optional[float] = None
    week_52_low: Optional[float] = None
    avg_volume: Optional[int] = None
    quote: StockQuote
    updated_at: str


def _fetch_single_quote(ticker: str) -> dict:
    """1銘柄の株価を取得（L1+L2 Redis キャッシュ → yfinance）"""
    ticker = ticker.upper()
    cache_key = f"stock:quote:{ticker}"

    # L1 インメモリ → L2 Redis
    cached = _cache_get(cache_key)
    if cached:
        return cached

    # L3: yfinance API
    try:
        yf_ticker = _to_yf(ticker)
        stock = yf.Ticker(yf_ticker)
        info = stock.info
        current_price = info.get("regularMarketPrice") or info.get("currentPrice")
        prev_close = info.get("previousClose")

        if current_price:
            change = current_price - prev_close if prev_close else 0
            change_pct = (change / prev_close * 100) if prev_close else 0
            quote = {
                "ticker": ticker,
                "price": round(current_price, 2),
                "change": round(change, 2),
                "change_pct": round(change_pct, 2),
                "volume": info.get("volume") or 0,
                "name": info.get("shortName") or info.get("longName") or None,
            }
            _cache_set(cache_key, quote, ttl=adaptive_ttl(_QUOTE_TTL, ticker))
            return quote
        return {"ticker": ticker, "error": "No price data"}
    except Exception:
        return {"ticker": ticker, "error": "Failed to fetch"}


# === Static routes MUST come before /{ticker} dynamic route ===

@router.get("/batch-quotes")
async def get_batch_quotes_cached(
    tickers: str = Query(..., description="Comma-separated tickers, max 20"),
):
    """
    GET variant of batch quotes (cacheable by Cloudflare Worker).
    Example: /api/stock/batch-quotes?tickers=NVDA,TSLA,AAPL
    """
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if len(ticker_list) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 tickers allowed")
    target = [t for t in ticker_list if _TICKER_RE.match(t)][:20]
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(_executor, _fetch_single_quote, t) for t in target]
    results = await asyncio.gather(*tasks)

    return {
        "quotes": list(results),
        "count": len(results),
        "updated_at": datetime.now().isoformat(),
    }


@router.post("/batch")
async def get_batch_quotes(
    tickers: List[str],
):
    """
    複数銘柄の株価を一括取得（並列実行、最大20銘柄）
    """
    if len(tickers) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 tickers allowed")
    target = [t.upper() for t in tickers if _TICKER_RE.match(t.upper())][:20]
    loop = asyncio.get_event_loop()
    tasks = [loop.run_in_executor(_executor, _fetch_single_quote, t) for t in target]
    results = await asyncio.gather(*tasks)

    return {
        "quotes": list(results),
        "count": len(results),
        "updated_at": datetime.now().isoformat(),
    }


# === Dynamic routes ===

@router.get("/{ticker}", response_model=StockInfo)
async def get_stock_info(ticker: str):
    """
    株価情報を取得（キャッシュ付き）

    - 基本情報（名前、セクター、時価総額など）
    - 現在の株価クオート
    - 5分間キャッシュ
    """
    ticker = ticker.upper()
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")
    cache_key = f"stock:info:{ticker}"
    cached = _cache_get(cache_key)
    if cached:
        return StockInfo(**cached)

    try:
        yf_ticker = _to_yf(ticker)
        stock = yf.Ticker(yf_ticker)
        info = stock.info

        if not info or "symbol" not in info:
            raise HTTPException(status_code=404, detail=f"Stock {ticker} not found")

        # 現在価格
        current_price = info.get("regularMarketPrice") or info.get("currentPrice")
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")

        if not current_price:
            # フォールバック: 履歴から取得
            hist = stock.history(period="5d")
            hist = hist.dropna(subset=["Close"])  # 未確定バー除去
            if hist.empty:
                raise HTTPException(status_code=404, detail=f"No price data for {ticker}")
            current_price = hist["Close"].iloc[-1]
            prev_close = hist["Close"].iloc[-2] if len(hist) > 1 else current_price

        change = current_price - prev_close if prev_close else 0
        change_pct = (change / prev_close * 100) if prev_close else 0

        quote = StockQuote(
            ticker=ticker.upper(),
            price=round(current_price, 2),
            change=round(change, 2),
            change_pct=round(change_pct, 2),
            high=round(info.get("dayHigh") or current_price, 2),
            low=round(info.get("dayLow") or current_price, 2),
            open=round(info.get("open") or current_price, 2),
            prev_close=round(prev_close, 2),
            volume=info.get("volume") or 0,
            market_cap=info.get("marketCap"),
            updated_at=datetime.now().isoformat(),
        )

        result = StockInfo(
            ticker=ticker.upper(),
            name=info.get("shortName") or info.get("longName"),
            sector=info.get("sector"),
            industry=info.get("industry"),
            market_cap=info.get("marketCap"),
            pe_ratio=info.get("trailingPE"),
            eps=info.get("trailingEps"),
            dividend_yield=info.get("dividendYield"),
            beta=info.get("beta"),
            week_52_high=info.get("fiftyTwoWeekHigh"),
            week_52_low=info.get("fiftyTwoWeekLow"),
            avg_volume=info.get("averageVolume"),
            quote=quote,
            updated_at=datetime.now().isoformat(),
        )

        _cache_set(cache_key, result.model_dump(), ttl=adaptive_ttl(_QUOTE_TTL, ticker))
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{ticker}/quote", response_model=StockQuote)
async def get_stock_quote(ticker: str):
    """
    株価クオートのみ取得（軽量版）
    """
    ticker = ticker.upper()
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")
    cache_key = f"stock:quote:{ticker}"
    cached = _cache_get(cache_key)
    if cached:
        return StockQuote(**cached)

    try:
        yf_ticker = _to_yf(ticker)
        stock = yf.Ticker(yf_ticker)
        info = stock.info

        current_price = info.get("regularMarketPrice") or info.get("currentPrice")
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")

        if not current_price:
            hist = stock.history(period="5d")
            hist = hist.dropna(subset=["Close"])  # 未確定バー除去
            if hist.empty:
                raise HTTPException(status_code=404, detail=f"No price data for {ticker}")
            current_price = hist["Close"].iloc[-1]
            prev_close = hist["Close"].iloc[-2] if len(hist) > 1 else current_price

        change = current_price - prev_close if prev_close else 0
        change_pct = (change / prev_close * 100) if prev_close else 0

        result = StockQuote(
            ticker=ticker.upper(),
            price=round(current_price, 2),
            change=round(change, 2),
            change_pct=round(change_pct, 2),
            high=round(info.get("dayHigh") or current_price, 2),
            low=round(info.get("dayLow") or current_price, 2),
            open=round(info.get("open") or current_price, 2),
            prev_close=round(prev_close, 2),
            volume=info.get("volume") or 0,
            market_cap=info.get("marketCap"),
            updated_at=datetime.now().isoformat(),
        )

        _cache_set(cache_key, result.model_dump(), ttl=adaptive_ttl(_QUOTE_TTL, ticker))
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{ticker}/history", response_model=StockHistory)
async def get_stock_history(
    ticker: str,
    period: str = Query("6mo", description="期間: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max"),
    interval: str = Query("1d", description="インターバル: 1m, 5m, 15m, 1h, 1d, 1wk, 1mo"),
):
    """
    株価履歴を取得

    OHLCVデータを返す
    """
    ticker = ticker.upper()
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")
    if period not in _ALLOWED_PERIODS:
        raise HTTPException(status_code=400, detail="Invalid period")
    if interval not in _ALLOWED_INTERVALS:
        raise HTTPException(status_code=400, detail="Invalid interval")
    # v2: 旧キャッシュには yfinance の未確定バー由来の null/NaN が入っていて
    # フロントの toFixed が null で落ちるため、キー prefix を bump して旧データ無視。
    cache_key = f"stock:history:v2:{ticker}:{period}:{interval}"
    cached = _cache_get(cache_key)
    if cached:
        return StockHistory(**cached)

    try:
        yf_ticker = _to_yf(ticker)
        stock = yf.Ticker(yf_ticker)
        df = stock.history(period=period, interval=interval)
        # 未確定バー (yfinance が当日の Close=NaN で返す行) を落とす。
        # フロントは last bar の close を null チェックなしで toFixed するため
        # ここで残すと chart 描画時に TypeError になる。
        df = df.dropna(subset=["Close"])

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No history data for {ticker}")

        # DataFrameをJSON形式に変換
        data = []
        for idx, row in df.iterrows():
            data.append({
                "date": idx.strftime("%Y-%m-%d %H:%M:%S") if interval in ["1m", "5m", "15m", "1h"] else idx.strftime("%Y-%m-%d"),
                "open": round(row["Open"], 2),
                "high": round(row["High"], 2),
                "low": round(row["Low"], 2),
                "close": round(row["Close"], 2),
                "volume": int(row["Volume"]),
            })

        result = StockHistory(
            ticker=ticker.upper(),
            period=period,
            data=data,
            updated_at=datetime.now().isoformat(),
        )

        _cache_set(cache_key, result.model_dump(), ttl=_HISTORY_TTL)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{ticker}/ema")
async def get_stock_ema(
    ticker: str,
    periods: str = Query("8,13,21", description="EMA期間（カンマ区切り）"),
):
    """
    EMA値を取得

    複数期間のEMAを計算して返す
    """
    ticker = ticker.upper()
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker format")

    # EMA期間のバリデーション
    try:
        ema_periods_list = [int(p.strip()) for p in periods.split(",")]
        if len(ema_periods_list) > 10 or any(p < 1 or p > 500 for p in ema_periods_list):
            raise ValueError
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid EMA periods")

    cache_key = f"stock:ema:{ticker}:{','.join(str(p) for p in ema_periods_list)}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    try:
        yf_ticker = _to_yf(ticker)
        stock = yf.Ticker(yf_ticker)
        df = stock.history(period="6mo")
        df = df.dropna(subset=["Close"])  # 未確定バー除去

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {ticker}")

        current_price = df["Close"].iloc[-1]

        emas = {}
        for period in ema_periods_list:
            ema_value = df["Close"].ewm(span=period, adjust=False).mean().iloc[-1]
            emas[f"ema_{period}"] = round(ema_value, 2)
            emas[f"above_ema_{period}"] = current_price > ema_value

        result = {
            "ticker": ticker.upper(),
            "current_price": round(current_price, 2),
            **emas,
            "updated_at": datetime.now().isoformat(),
        }
        _cache_set(cache_key, result, ttl=_EMA_TTL)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


