"""
/api/stock - 株価データAPI（キャッシュ付き）
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from functools import lru_cache
import time

router = APIRouter()

# シンプルなインメモリキャッシュ
_cache: Dict[str, dict] = {}
CACHE_TTL = 300  # 5分


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


def get_cached(key: str) -> Optional[dict]:
    """キャッシュから取得"""
    if key in _cache:
        entry = _cache[key]
        if time.time() - entry["timestamp"] < CACHE_TTL:
            return entry["data"]
        else:
            del _cache[key]
    return None


def set_cache(key: str, data: dict):
    """キャッシュに保存"""
    _cache[key] = {
        "data": data,
        "timestamp": time.time()
    }


@router.get("/{ticker}", response_model=StockInfo)
async def get_stock_info(ticker: str):
    """
    株価情報を取得（キャッシュ付き）

    - 基本情報（名前、セクター、時価総額など）
    - 現在の株価クオート
    - 5分間キャッシュ
    """
    cache_key = f"info:{ticker.upper()}"
    cached = get_cached(cache_key)
    if cached:
        return StockInfo(**cached)

    try:
        stock = yf.Ticker(ticker.upper())
        info = stock.info

        if not info or "symbol" not in info:
            raise HTTPException(status_code=404, detail=f"Stock {ticker} not found")

        # 現在価格
        current_price = info.get("regularMarketPrice") or info.get("currentPrice")
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")

        if not current_price:
            # フォールバック: 履歴から取得
            hist = stock.history(period="5d")
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

        set_cache(cache_key, result.model_dump())
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/quote", response_model=StockQuote)
async def get_stock_quote(ticker: str):
    """
    株価クオートのみ取得（軽量版）
    """
    cache_key = f"quote:{ticker.upper()}"
    cached = get_cached(cache_key)
    if cached:
        return StockQuote(**cached)

    try:
        stock = yf.Ticker(ticker.upper())
        info = stock.info

        current_price = info.get("regularMarketPrice") or info.get("currentPrice")
        prev_close = info.get("previousClose") or info.get("regularMarketPreviousClose")

        if not current_price:
            hist = stock.history(period="5d")
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

        set_cache(cache_key, result.model_dump())
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    cache_key = f"history:{ticker.upper()}:{period}:{interval}"
    cached = get_cached(cache_key)
    if cached:
        return StockHistory(**cached)

    try:
        stock = yf.Ticker(ticker.upper())
        df = stock.history(period=period, interval=interval)

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

        set_cache(cache_key, result.model_dump())
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}/ema")
async def get_stock_ema(
    ticker: str,
    periods: str = Query("8,13,21", description="EMA期間（カンマ区切り）"),
):
    """
    EMA値を取得

    複数期間のEMAを計算して返す
    """
    try:
        stock = yf.Ticker(ticker.upper())
        df = stock.history(period="6mo")

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {ticker}")

        current_price = df["Close"].iloc[-1]
        ema_periods = [int(p.strip()) for p in periods.split(",")]

        emas = {}
        for period in ema_periods:
            ema_value = df["Close"].ewm(span=period, adjust=False).mean().iloc[-1]
            emas[f"ema_{period}"] = round(ema_value, 2)
            emas[f"above_ema_{period}"] = current_price > ema_value

        return {
            "ticker": ticker.upper(),
            "current_price": round(current_price, 2),
            **emas,
            "updated_at": datetime.now().isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch")
async def get_batch_quotes(
    tickers: List[str],
):
    """
    複数銘柄の株価を一括取得
    """
    results = []

    for ticker in tickers[:20]:  # 最大20銘柄
        try:
            cache_key = f"quote:{ticker.upper()}"
            cached = get_cached(cache_key)

            if cached:
                results.append(cached)
                continue

            stock = yf.Ticker(ticker.upper())
            info = stock.info

            current_price = info.get("regularMarketPrice") or info.get("currentPrice")
            prev_close = info.get("previousClose")

            if current_price:
                change = current_price - prev_close if prev_close else 0
                change_pct = (change / prev_close * 100) if prev_close else 0

                quote = {
                    "ticker": ticker.upper(),
                    "price": round(current_price, 2),
                    "change": round(change, 2),
                    "change_pct": round(change_pct, 2),
                    "volume": info.get("volume") or 0,
                }
                results.append(quote)
                set_cache(cache_key, quote)

        except Exception:
            results.append({
                "ticker": ticker.upper(),
                "error": "Failed to fetch"
            })

    return {
        "quotes": results,
        "count": len(results),
        "updated_at": datetime.now().isoformat(),
    }
