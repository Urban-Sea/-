"""
cache_utils.py - OHLCV データの L1+L2 キャッシュ取得

L1: インメモリ + L2: Redis (redis_cache.py) を使用。
"""
import logging

logger = logging.getLogger(__name__)

from market_hours import adaptive_ttl

DEFAULT_TTL = 300  # 5 minutes


def fetch_ohlcv_cached(ticker: str, period: str = "6mo", ttl: int = DEFAULT_TTL):
    """
    OHLCV データを L1+L2 キャッシュ付きで取得。
    Returns: pandas DataFrame or None
    """
    import pandas as pd
    from redis_cache import cache_get, cache_set

    cache_key = f"ohlcv:{ticker}:{period}"

    # L1+L2 キャッシュチェック
    cached = cache_get(cache_key)
    if cached:
        try:
            df = pd.DataFrame(cached)
            if "Date" in df.columns:
                df["Date"] = pd.to_datetime(df["Date"])
            # 旧キャッシュ救済: 過去にキャッシュへ書かれた未確定バー (Close=NaN) を落とす。
            # 残数 0 ならミス扱いで yfinance に再取得させる。
            df = df.dropna(subset=["Close"])
            if not df.empty:
                return df
        except Exception:
            pass

    # L3: yfinance
    try:
        import yfinance as yf

        stock = yf.Ticker(ticker)
        df = stock.history(period=period)
        # 未確定バー (yfinance が当日の Close=NaN で返す行) を落とす
        df = df.dropna(subset=["Close"])
        if df.empty:
            return None
        df = df.reset_index()
        if "Datetime" in df.columns:
            df = df.rename(columns={"Datetime": "Date"})

        # キャッシュに保存
        data_for_cache = df.copy()
        data_for_cache["Date"] = data_for_cache["Date"].dt.strftime("%Y-%m-%d")
        cache_set(cache_key, data_for_cache.to_dict(orient="records"), ttl=adaptive_ttl(ttl, ticker))

        return df
    except Exception as e:
        logger.debug(f"yfinance fetch error for {ticker}: {e}")
        return None
