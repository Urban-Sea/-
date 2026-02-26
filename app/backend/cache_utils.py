"""
cache_utils.py - 共有L2 DBキャッシュ (Supabase stock_cache)

stock.pyから抽出。signal.py/combined_entry_detectorでも利用可能。
stock_cacheテーブルのtickerカラムを汎用キーとして使用。
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

import main as app_main

logger = logging.getLogger(__name__)

DEFAULT_TTL = 300  # 5 minutes


def db_cache_get(cache_key: str) -> Optional[dict]:
    """L2: Supabase stock_cache から取得（期限内のみ）"""
    try:
        sb = app_main.get_supabase()
        if not sb:
            return None
        result = (
            sb.table("stock_cache")
            .select("data, expires_at")
            .eq("ticker", cache_key)
            .execute()
        )
        if result.data:
            row = result.data[0]
            expires_at = datetime.fromisoformat(
                row["expires_at"].replace("Z", "+00:00")
            )
            if expires_at > datetime.now(expires_at.tzinfo):
                return row["data"]
    except Exception as e:
        logger.debug(f"DB cache read error for {cache_key}: {e}")
    return None


def db_cache_set(cache_key: str, data, ttl: int = DEFAULT_TTL):
    """L2: Supabase stock_cache に upsert"""
    try:
        sb = app_main.get_supabase()
        if not sb:
            return
        now = datetime.utcnow()
        sb.table("stock_cache").upsert({
            "ticker": cache_key,
            "data": data,
            "fetched_at": now.isoformat(),
            "expires_at": (now + timedelta(seconds=ttl)).isoformat(),
        }).execute()
    except Exception as e:
        logger.debug(f"DB cache write error for {cache_key}: {e}")


def fetch_ohlcv_cached(ticker: str, period: str = "6mo", ttl: int = DEFAULT_TTL):
    """
    OHLCV データを L2 DBキャッシュ付きで取得。
    Returns: pandas DataFrame or None
    """
    import pandas as pd

    cache_key = f"ohlcv:{ticker}:{period}"

    # L2 cache check
    cached = db_cache_get(cache_key)
    if cached:
        try:
            df = pd.DataFrame(cached)
            if "Date" in df.columns:
                df["Date"] = pd.to_datetime(df["Date"])
            return df
        except Exception:
            pass

    # L3: yfinance
    try:
        import yfinance as yf

        stock = yf.Ticker(ticker)
        df = stock.history(period=period)
        if df.empty:
            return None
        df = df.reset_index()
        # Ensure column name is 'Date'
        if "Datetime" in df.columns:
            df = df.rename(columns={"Datetime": "Date"})

        # Serialize for DB storage
        data_for_cache = df.copy()
        data_for_cache["Date"] = data_for_cache["Date"].dt.strftime("%Y-%m-%d")
        db_cache_set(cache_key, data_for_cache.to_dict(orient="records"), ttl=ttl)

        return df
    except Exception as e:
        logger.debug(f"yfinance fetch error for {ticker}: {e}")
        return None
