"""
過去のポートフォリオスナップショットをバックフィル

取引履歴を日付順に再生し、各営業日の保有状態を yfinance の過去終値で時価評価。
一度だけ実行すれば OK。以降は日次バッチ (snapshot.py) が引き継ぐ。

Usage:
  python app/batch/run.py --backfill-snapshots --since 2024-06-01 --verbose
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

from .config import get_supabase
from .db import upsert_portfolio_snapshots

logger = logging.getLogger("batch.backfill")


def backfill_snapshots(since: str = "2024-06-01") -> int:
    """
    since 以降の取引履歴からポートフォリオ状態を再構築し、
    営業日ごとのスナップショットを生成して upsert。
    Returns: upsert した行数
    """
    sb = get_supabase()
    logger.info(f"Backfilling portfolio snapshots since {since}")

    # 1. 全ユーザーの取引を取得
    trades_result = (
        sb.table("trades")
        .select("*")
        .gte("trade_date", since)
        .order("trade_date", desc=False)
        .execute()
    )
    trades = trades_result.data or []
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
    holdings_result = sb.table("holdings").select("*").execute()
    for h in holdings_result.data or []:
        all_tickers = sorted(set(all_tickers) | {h["ticker"]})

    logger.info(f"  Users: {len(trades_by_user)}, Tickers: {all_tickers}")

    # 3. 過去の終値を一括ダウンロード
    end_date = datetime.now().strftime("%Y-%m-%d")
    logger.info(f"  Downloading historical prices: {since} → {end_date}")
    price_history = _download_history(all_tickers, since, end_date)
    logger.info(f"  Price history: {len(price_history)} trading days")

    # 4. USD/JPY の過去レートを取得
    fx_history = _get_fx_history(sb, since)
    logger.info(f"  FX history: {len(fx_history)} days")

    # 5. 営業日リストを生成
    if not price_history:
        logger.warning("No price history available — aborting backfill")
        return 0

    trading_days = sorted(price_history.keys())

    # 6. 取引前の初期保有状態を構築（since より前の取引から）
    initial_state = _build_initial_state(sb, trades_by_user, since)

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
                close_price = day_prices.get(ticker, avg_price)  # フォールバック: 原価

                market_value = shares * close_price
                cost = shares * avg_price
                total_market += market_value
                total_cost += cost

                detail.append({
                    "ticker": ticker,
                    "shares": shares,
                    "avg_price": round(avg_price, 2),
                    "close_price": round(close_price, 2),
                    "market_value_usd": round(market_value, 2),
                    "cost_usd": round(cost, 2),
                    "unrealized_pnl_usd": round(market_value - cost, 2),
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
    Returns: {date_str: {ticker: close_price}}
    """
    if not tickers:
        return {}

    result: dict[str, dict[str, float]] = {}

    try:
        df = yf.download(tickers, start=start, end=end, progress=False)
        if df.empty:
            return result

        if len(tickers) == 1:
            ticker = tickers[0]
            if hasattr(df.columns, "levels") and len(df.columns.levels) > 1:
                close = df["Close"][ticker]
            else:
                close = df["Close"]
            for idx, val in close.dropna().items():
                date_str = idx.strftime("%Y-%m-%d")
                result[date_str] = {ticker: float(val)}
        else:
            close_df = df["Close"]
            for idx in close_df.index:
                date_str = idx.strftime("%Y-%m-%d")
                day_prices = {}
                for ticker in tickers:
                    if ticker in close_df.columns:
                        val = close_df.loc[idx, ticker]
                        if pd.notna(val):
                            day_prices[ticker] = float(val)
                if day_prices:
                    result[date_str] = day_prices

    except Exception as e:
        logger.error(f"yfinance download error: {e}")

    return result


def _get_fx_history(sb, since: str) -> dict[str, float]:
    """market_indicators テーブルから USD/JPY の日次履歴を取得。"""
    fx: dict[str, float] = {}
    try:
        result = (
            sb.table("market_indicators")
            .select("date, usdjpy")
            .gte("date", since)
            .not_.is_("usdjpy", "null")
            .order("date")
            .execute()
        )
        for row in result.data or []:
            if row.get("usdjpy"):
                fx[row["date"]] = float(row["usdjpy"])
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
    sb, trades_by_user: dict[str, list[dict]], since: str
) -> dict[str, dict[str, dict]]:
    """
    since より前の取引から、各ユーザーの初期保有状態を構築。
    Returns: {user_id: {ticker: {shares, avg_price}}}
    """
    initial: dict[str, dict[str, dict]] = defaultdict(dict)

    for user_id in trades_by_user:
        # since 以前の取引を取得
        pre_trades_result = (
            sb.table("trades")
            .select("*")
            .eq("user_id", user_id)
            .lt("trade_date", since)
            .order("trade_date", desc=False)
            .execute()
        )
        pre_trades = pre_trades_result.data or []

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
