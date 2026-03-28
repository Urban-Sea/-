"""
日次ポートフォリオスナップショット

全ユーザーの保有銘柄を終値で時価評価し、portfolio_snapshots テーブルに保存。
日次バッチ (_run_daily) の末尾で呼ばれるほか、--snapshot フラグで単独実行可能。
"""

import json
import logging
import re
from collections import defaultdict
from datetime import datetime

import yfinance as yf

from .config import get_conn
from .db import upsert_portfolio_snapshots

logger = logging.getLogger("batch.snapshot")

_JP_RE = re.compile(r"^\d+(\.T)?$", re.IGNORECASE)


def _is_jp(ticker: str) -> bool:
    """日本株ティッカーか判定（7203, 7203.T → True）"""
    return bool(_JP_RE.match(ticker))


def _to_yf(ticker: str) -> str:
    """ティッカーをyfinance形式に正規化（7203 → 7203.T）"""
    if _is_jp(ticker) and not ticker.upper().endswith(".T"):
        return f"{ticker}.T"
    return ticker


def take_daily_snapshot(snapshot_date: str | None = None) -> int:
    """
    全ユーザーの保有銘柄を時価評価してスナップショットを作成。
    Returns: upsert した行数
    """
    if snapshot_date is None:
        snapshot_date = datetime.now().strftime("%Y-%m-%d")

    logger.info(f"Taking portfolio snapshot for {snapshot_date}")

    conn = get_conn()

    # 1. 全ユーザーの保有銘柄を取得
    holdings_by_user = _get_all_holdings(conn)
    if not holdings_by_user:
        logger.info("No holdings found — skipping snapshot")
        return 0

    # 2. 全ティッカーを集約
    all_tickers = set()
    for holdings in holdings_by_user.values():
        for h in holdings:
            all_tickers.add(h["ticker"])

    logger.info(f"  Users: {len(holdings_by_user)}, Tickers: {sorted(all_tickers)}")

    # 3. 終値を一括取得
    prices = _fetch_closing_prices(sorted(all_tickers))
    logger.info(f"  Prices fetched: {len(prices)}/{len(all_tickers)}")

    # 4. USD/JPY レートを取得
    fx_rate = _get_fx_rate(conn, snapshot_date)
    logger.info(f"  USD/JPY: {fx_rate}")

    # 5. 現金残高を取得
    cash_by_user = _get_all_cash(conn)

    # 6. ユーザーごとにスナップショット行を構築
    rows = []
    for user_id, holdings in holdings_by_user.items():
        total_market = 0.0
        total_cost = 0.0
        detail = []

        for h in holdings:
            ticker = h["ticker"]
            shares = float(h["shares"])
            avg_price = float(h["avg_price"])
            close_price = prices.get(ticker)
            jp = _is_jp(ticker)

            if close_price is None:
                close_price = avg_price
                logger.warning(f"  No price for {ticker}, using avg_price={avg_price}")

            # 時価・原価を計算（JP株は¥建て）
            market_value_native = shares * close_price
            cost_native = shares * avg_price

            # USD換算（JP株: ¥→$ に変換）
            if jp and fx_rate > 0:
                market_value_usd = market_value_native / fx_rate
                cost_usd = cost_native / fx_rate
            else:
                market_value_usd = market_value_native
                cost_usd = cost_native

            total_market += market_value_usd
            total_cost += cost_usd

            detail.append({
                "ticker": ticker,
                "shares": shares,
                "avg_price": round(avg_price, 2),
                "close_price": round(close_price, 2),
                "market_value_usd": round(market_value_usd, 2),
                "cost_usd": round(cost_usd, 2),
                "unrealized_pnl_usd": round(market_value_usd - cost_usd, 2),
                "currency": "JPY" if jp else "USD",
                "sector": h.get("sector"),
                "account_type": h.get("account_type"),
            })

        # 現金計算
        cash_usd = _calc_cash_usd(cash_by_user.get(user_id, []), fx_rate)

        rows.append({
            "user_id": user_id,
            "snapshot_date": snapshot_date,
            "total_market_value_usd": round(total_market, 2),
            "total_cost_usd": round(total_cost, 2),
            "unrealized_pnl_usd": round(total_market - total_cost, 2),
            "cash_usd": round(cash_usd, 2),
            "total_assets_usd": round(total_market + cash_usd, 2),
            "fx_rate_usdjpy": fx_rate,
            "holdings_count": len(holdings),
            "holdings_detail": json.dumps(detail, ensure_ascii=False),
        })

    # 7. Upsert
    count = upsert_portfolio_snapshots(rows)
    logger.info(f"  Snapshot complete: {count} rows upserted")
    return count


def _get_all_holdings(conn) -> dict[str, list[dict]]:
    """全ユーザーの保有銘柄を {user_id: [holdings]} で返す。"""
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM holdings")
        col_names = [desc[0] for desc in cur.description]
        rows = [dict(zip(col_names, row)) for row in cur.fetchall()]

    by_user: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_user[row["user_id"]].append(row)
    return dict(by_user)


def _fetch_closing_prices(tickers: list[str]) -> dict[str, float]:
    """
    yfinance で終値を一括取得。最新の利用可能な終値を返す。
    1回のAPI呼び出しで全ティッカーをダウンロード。
    JP株ティッカーは .T に正規化して取得し、元のキーで返す。
    """
    if not tickers:
        return {}

    # ユーザーティッカー → yfinanceティッカー のマッピング
    yf_map = {t: _to_yf(t) for t in tickers}
    rev_map = {v: k for k, v in yf_map.items()}
    yf_tickers = sorted(set(yf_map.values()))

    prices: dict[str, float] = {}
    try:
        df = yf.download(yf_tickers, period="5d", progress=False)
        if df.empty:
            logger.warning("yfinance returned empty dataframe")
            return prices

        if len(yf_tickers) == 1:
            yf_t = yf_tickers[0]
            if hasattr(df.columns, "levels") and len(df.columns.levels) > 1:
                close = df["Close"][yf_t]
            else:
                close = df["Close"]
            if not close.empty:
                user_t = rev_map.get(yf_t, yf_t)
                prices[user_t] = float(close.dropna().iloc[-1])
        else:
            close_df = df["Close"] if "Close" in df.columns.get_level_values(0) else df
            for yf_t in yf_tickers:
                if yf_t in close_df.columns:
                    series = close_df[yf_t].dropna()
                    if not series.empty:
                        user_t = rev_map.get(yf_t, yf_t)
                        prices[user_t] = float(series.iloc[-1])

    except Exception as e:
        logger.error(f"yfinance download error: {e}")

    return prices


def _get_fx_rate(conn, date: str) -> float:
    """USD/JPY レートを market_indicators から取得。フォールバック 150.0。"""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT usdjpy FROM market_indicators "
                "WHERE date <= %s AND usdjpy IS NOT NULL "
                "ORDER BY date DESC LIMIT 1",
                (date,),
            )
            row = cur.fetchone()
            if row and row[0]:
                return float(row[0])
    except Exception as e:
        logger.warning(f"Failed to get FX rate: {e}")

    return 150.0


def _get_all_cash(conn) -> dict[str, list[dict]]:
    """全ユーザーの現金残高を {user_id: [cash_rows]} で返す。"""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM cash_balances")
            col_names = [desc[0] for desc in cur.description]
            rows = [dict(zip(col_names, row)) for row in cur.fetchall()]

        by_user: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            by_user[row["user_id"]].append(row)
        return dict(by_user)
    except Exception:
        return {}


def _calc_cash_usd(cash_rows: list[dict], fx_rate: float) -> float:
    """現金残高リストをUSD合計に変換。"""
    total = 0.0
    for row in cash_rows:
        amount = float(row.get("amount", 0))
        currency = row.get("currency", "JPY")
        if currency == "USD":
            total += amount
        else:
            total += amount / fx_rate if fx_rate > 0 else 0
    return total
