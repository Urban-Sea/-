"""
Yahoo Finance フェッチャー

2テーブル分のデータを yfinance から取得:
  - market_indicators  (VIX, DXY, SP500, NASDAQ)
  - bank_sector        (KRE + 52週メトリクス)
"""

import logging
from datetime import datetime, timedelta
from typing import List

import yfinance as yf

from ..config import YAHOO_TICKERS

logger = logging.getLogger("batch.fetchers.yahoo")


def _download(ticker: str, start: str, end: str):
    """yfinance でダウンロード。Close 価格の Series を返す。"""
    df = yf.download(ticker, start=start, end=end, progress=False)
    if df.empty:
        logger.warning(f"  {ticker}: no data returned")
        return None
    # yfinance は MultiIndex を返すことがある
    if hasattr(df.columns, "levels") and len(df.columns.levels) > 1:
        df = df.droplevel(level=1, axis=1)
    return df


def fetch_market_indicators(start: str, end: str) -> List[dict]:
    """VIX/DXY/SP500/NASDAQ 終値 → market_indicators 行リスト"""
    logger.info("Fetching market_indicators...")

    tickers = {
        "vix": YAHOO_TICKERS["vix"],
        "dxy": YAHOO_TICKERS["dxy"],
        "sp500": YAHOO_TICKERS["sp500"],
        "nasdaq": YAHOO_TICKERS["nasdaq"],
        "russell2000": YAHOO_TICKERS["russell2000"],
        "usdjpy": YAHOO_TICKERS["usdjpy"],
    }

    # 各ティッカーのデータを取得
    series_data = {}
    for key, ticker in tickers.items():
        df = _download(ticker, start, end)
        if df is not None:
            series_data[key] = {
                row.Index.strftime("%Y-%m-%d"): float(row.Close)
                for row in df.itertuples()
                if row.Close is not None
            }

    # 全日付を統合
    all_dates = set()
    for sd in series_data.values():
        all_dates |= sd.keys()

    rows = []
    for date in sorted(all_dates):
        row = {"date": date}
        for key in tickers:
            row[key] = series_data.get(key, {}).get(date)
        # 少なくとも1つの値がある行のみ
        if any(row.get(k) is not None for k in tickers):
            rows.append(row)

    logger.info(f"  market_indicators: {len(rows)} rows prepared")
    return rows


def fetch_bank_sector(start: str, end: str) -> List[dict]:
    """KRE 終値 + 52週メトリクス → bank_sector 行リスト"""
    logger.info("Fetching bank_sector...")

    ticker = YAHOO_TICKERS["kre"]
    # 52週計算に1年分余分にデータが必要
    start_dt = datetime.strptime(start, "%Y-%m-%d")
    extended_start = (start_dt - timedelta(days=400)).strftime("%Y-%m-%d")

    df = _download(ticker, extended_start, end)
    if df is None:
        return []

    rows = []
    for i, row in enumerate(df.itertuples()):
        date_str = row.Index.strftime("%Y-%m-%d")
        if date_str < start:
            continue

        close = float(row.Close) if row.Close is not None else None
        if close is None:
            continue

        # 52週 = 約252営業日、ただし利用可能な範囲で計算
        lookback_start = max(0, i - 252)
        window = df.iloc[lookback_start : i + 1]

        kre_52w_high = float(window["High"].max()) if "High" in window.columns else None
        kre_52w_low = float(window["Low"].min()) if "Low" in window.columns else None

        # 52週変化率: (現在 - 52週前) / 52週前 × 100
        kre_52w_change = None
        if len(window) > 1:
            first_close = float(window.iloc[0]["Close"])
            if first_close and first_close != 0:
                kre_52w_change = round(((close - first_close) / first_close) * 100, 4)

        rows.append({
            "date": date_str,
            "kre_close": round(close, 4),
            "kre_52w_high": round(kre_52w_high, 4) if kre_52w_high is not None else None,
            "kre_52w_low": round(kre_52w_low, 4) if kre_52w_low is not None else None,
            "kre_52w_change": kre_52w_change,
        })

    logger.info(f"  bank_sector: {len(rows)} rows prepared")
    return rows
