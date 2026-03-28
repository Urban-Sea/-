"""
過去のポートフォリオスナップショットをバックフィル

取引履歴を日付順に再生し、各営業日の保有状態を yfinance の過去終値で時価評価。
一度だけ実行すれば OK。以降は日次バッチ (snapshot.py) が引き継ぐ。

Usage:
  python app/batch/run.py --backfill-snapshots --since 2024-06-01 --verbose
"""

import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

from .config import get_conn
from .db import upsert_portfolio_snapshots

logger = logging.getLogger("batch.backfill")

_JP_RE = re.compile(r"^\d+(\.T)?$", re.IGNORECASE)


def _is_jp(ticker: str) -> bool:
    """日本株ティッカーか判定（7203, 7203.T → True）"""
    return bool(_JP_RE.match(ticker))


def _to_yf(ticker: str) -> str:
    """ティッカーをyfinance形式に正規化（7203 → 7203.T）"""
    if _is_jp(ticker) and not ticker.upper().endswith(".T"):
        return f"{ticker}.T"
    return ticker


def backfill_snapshots(since: str = "2024-06-01") -> int:
    """
    since 以降の取引履歴からポートフォリオ状態を再構築し、
    営業日ごとのスナップショットを生成して upsert。
    Returns: upsert した行数
    """
    conn = get_conn()
    logger.info(f"Backfilling portfolio snapshots since {since}")

    # 1. 全ユーザーの取引を取得
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM trades WHERE trade_date >= %s ORDER BY trade_date",
            (since,),
        )
        col_names = [desc[0] for desc in cur.description]
        trades = [dict(zip(col_names, row)) for row in cur.fetchall()]
    if not trades:
        logger.info("No trades found — nothing to backfill")
        return 0

    # ユーザー別に分類
    trades_by_user: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        trades_by_user[t["user_id"]].append(t)

    # 2. 全ティッカーを収集
    all_tickers = sorted({t["ticker"] for t in trades})

    # 取引より前のポジションも含めるため、既存 holdings を取得
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM holdings")
        h_col_names = [desc[0] for desc in cur.description]
        holdings_rows = [dict(zip(h_col_names, row)) for row in cur.fetchall()]
    for h in holdings_rows:
        all_tickers = sorted(set(all_tickers) | {h["ticker"]})

    logger.info(f"  Users: {len(trades_by_user)}, Tickers: {all_tickers}")

    # 3. 過去の終値を一括ダウンロード
    end_date = datetime.now().strftime("%Y-%m-%d")
    logger.info(f"  Downloading historical prices: {since} → {end_date}")
    price_history = _download_history(all_tickers, since, end_date)
    logger.info(f"  Price history: {len(price_history)} trading days")

    # 4. USD/JPY の過去レートを取得
    fx_history = _get_fx_history(conn, since)
    logger.info(f"  FX history: {len(fx_history)} days")

    # 5. 営業日リストを生成
    if not price_history:
        logger.warning("No price history available — aborting backfill")
        return 0

    trading_days = sorted(price_history.keys())

    # 6. 取引前の初期保有状態を構築（since より前の取引から）
    initial_state = _build_initial_state(conn, trades_by_user, since)

    # 7. 各ユーザーの日次スナップショットを生成
    all_rows = []

    for user_id in set(list(trades_by_user.keys()) + list(initial_state.keys())):
        user_trades = trades_by_user.get(user_id, [])
        holdings_state = dict(initial_state.get(user_id, {}))  # deep copy
        trade_idx = 0

        for day in trading_days:
            # この日までの取引を適用
            while trade_idx < len(user_trades):
                td = user_trades[trade_idx]["trade_date"][:10]
                if td > day:
                    break
                trade = user_trades[trade_idx]
                _apply_trade(holdings_state, trade)
                trade_idx += 1

            if not holdings_state:
                continue

            # 時価評価
            day_prices = price_history.get(day, {})
            fx_rate = fx_history.get(day, 150.0)

            total_market = 0.0
            total_cost = 0.0
            detail = []

            for ticker, pos in holdings_state.items():
                shares = pos["shares"]
                avg_price = pos["avg_price"]
                close_price = day_prices.get(ticker, avg_price)
                jp = _is_jp(ticker)

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
                })

            all_rows.append({
                "user_id": user_id,
                "snapshot_date": day,
                "total_market_value_usd": round(total_market, 2),
                "total_cost_usd": round(total_cost, 2),
                "unrealized_pnl_usd": round(total_market - total_cost, 2),
                "cash_usd": 0,  # 過去の現金は不明
                "total_assets_usd": round(total_market, 2),
                "fx_rate_usdjpy": fx_rate,
                "holdings_count": len(holdings_state),
                "holdings_detail": detail,
            })

    logger.info(f"  Generated {len(all_rows)} snapshot rows")

    if all_rows:
        count = upsert_portfolio_snapshots(all_rows)
        logger.info(f"  Backfill complete: {count} rows upserted")
        return count

    return 0


def _download_history(
    tickers: list[str], start: str, end: str
) -> dict[str, dict[str, float]]:
    """
    yfinance で過去終値を一括ダウンロード。
    JP株ティッカーは .T に正規化して取得し、元のキーで返す。
    Returns: {date_str: {user_ticker: close_price}}
    """
    if not tickers:
        return {}

    # ユーザーティッカー → yfinanceティッカー のマッピング
    yf_map = {t: _to_yf(t) for t in tickers}
    rev_map = {v: k for k, v in yf_map.items()}
    yf_tickers = sorted(set(yf_map.values()))

    result: dict[str, dict[str, float]] = {}

    try:
        df = yf.download(yf_tickers, start=start, end=end, progress=False)
        if df.empty:
            return result

        if len(yf_tickers) == 1:
            yf_t = yf_tickers[0]
            if hasattr(df.columns, "levels") and len(df.columns.levels) > 1:
                close = df["Close"][yf_t]
            else:
                close = df["Close"]
            user_t = rev_map.get(yf_t, yf_t)
            for idx, val in close.dropna().items():
                date_str = idx.strftime("%Y-%m-%d")
                result[date_str] = {user_t: float(val)}
        else:
            close_df = df["Close"]
            for idx in close_df.index:
                date_str = idx.strftime("%Y-%m-%d")
                day_prices = {}
                for yf_t in yf_tickers:
                    if yf_t in close_df.columns:
                        val = close_df.loc[idx, yf_t]
                        if pd.notna(val):
                            user_t = rev_map.get(yf_t, yf_t)
                            day_prices[user_t] = float(val)
                if day_prices:
                    result[date_str] = day_prices

    except Exception as e:
        logger.error(f"yfinance download error: {e}")

    return result


def _get_fx_history(conn, since: str) -> dict[str, float]:
    """market_indicators テーブルから USD/JPY の日次履歴を取得。"""
    fx: dict[str, float] = {}
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT date, usdjpy FROM market_indicators "
                "WHERE date >= %s AND usdjpy IS NOT NULL ORDER BY date",
                (since,),
            )
            for row_date, usdjpy in cur.fetchall():
                if usdjpy:
                    fx[str(row_date)] = float(usdjpy)
    except Exception as e:
        logger.warning(f"Failed to get FX history: {e}")

    # 前日値で埋める
    if fx:
        last_rate = list(fx.values())[0]
        all_dates = sorted(fx.keys())
        start_dt = datetime.strptime(since, "%Y-%m-%d")
        end_dt = datetime.now()
        current = start_dt
        while current <= end_dt:
            ds = current.strftime("%Y-%m-%d")
            if ds in fx:
                last_rate = fx[ds]
            else:
                fx[ds] = last_rate
            current += timedelta(days=1)

    return fx


def _build_initial_state(
    conn, trades_by_user: dict[str, list[dict]], since: str
) -> dict[str, dict[str, dict]]:
    """
    since より前の取引から、各ユーザーの初期保有状態を構築。
    Returns: {user_id: {ticker: {shares, avg_price}}}
    """
    initial: dict[str, dict[str, dict]] = defaultdict(dict)

    for user_id in trades_by_user:
        # since 以前の取引を取得
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM trades WHERE user_id = %s AND trade_date < %s ORDER BY trade_date",
                (user_id, since),
            )
            col_names = [desc[0] for desc in cur.description]
            pre_trades = [dict(zip(col_names, row)) for row in cur.fetchall()]

        state: dict[str, dict] = {}
        for trade in pre_trades:
            _apply_trade(state, trade)

        if state:
            initial[user_id] = state

    return dict(initial)


def _apply_trade(state: dict[str, dict], trade: dict):
    """取引を保有状態に適用。"""
    ticker = trade["ticker"]
    action = trade["action"]
    shares = float(trade["shares"])
    price = float(trade["price"])

    if action == "BUY":
        if ticker in state:
            old = state[ticker]
            new_shares = old["shares"] + shares
            new_avg = ((old["shares"] * old["avg_price"]) + (shares * price)) / new_shares
            state[ticker] = {"shares": new_shares, "avg_price": new_avg}
        else:
            state[ticker] = {"shares": shares, "avg_price": price}
    elif action == "SELL":
        if ticker in state:
            remaining = state[ticker]["shares"] - shares
            if remaining <= 0.001:
                del state[ticker]
            else:
                state[ticker] = {"shares": remaining, "avg_price": state[ticker]["avg_price"]}
