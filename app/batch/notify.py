#!/usr/bin/env python3
"""
銘柄発掘 → Signal 分析 → Slack/Discord 通知パイプライン

Usage:
  python -m app.batch.run --notify
"""

import json
import logging
import os
import urllib.request
import urllib.error
from datetime import datetime

logger = logging.getLogger("batch.notify")

# batch コンテナから api-python / api-go を直接叩く (Docker 内部ネットワーク)
_API_GO_URL = os.getenv("API_GO_URL", "http://api-go:8080")
_API_PYTHON_URL = os.getenv("API_PYTHON_URL", "http://api-python:8081")

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")


def _api_get(base_url: str, path: str, timeout: int = 30) -> dict:
    """GET リクエストを送って JSON を返す"""
    url = f"{base_url}{path}"
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _api_post(base_url: str, path: str, body: dict, timeout: int = 120) -> dict:
    """POST リクエストを送って JSON を返す"""
    url = f"{base_url}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _fetch_discovered_tickers() -> list[str]:
    """GET /api/discovery/today から当日の発掘銘柄を取得"""
    try:
        data = _api_get(_API_GO_URL, "/api/discovery/today")
        # レスポンス形式: { tickers: [{ticker, ...}, ...], total_unique, ... }
        stocks = data.get("tickers") or data.get("stocks") or data.get("data") or []
        if isinstance(data, list):
            stocks = data
        tickers = [s["ticker"] for s in stocks if s.get("ticker")]
        logger.info(f"Discovery: {len(tickers)} tickers found")
        return tickers
    except Exception as e:
        logger.error(f"Failed to fetch discovered stocks: {e}")
        return []


def _analyze_batch(tickers: list[str], mode: str = "balanced") -> dict:
    """POST /api/signal/batch で一括分析"""
    if not tickers:
        return {"results": [], "entry_ready_count": 0, "total_analyzed": 0}
    # 50 銘柄ずつ分割
    all_results = []
    entry_ready_total = 0
    for i in range(0, len(tickers), 50):
        chunk = tickers[i:i + 50]
        try:
            resp = _api_post(_API_PYTHON_URL, "/api/signal/batch", {
                "tickers": chunk,
                "mode": mode,
            })
            all_results.extend(resp.get("results", []))
            entry_ready_total += resp.get("entry_ready_count", 0)
        except Exception as e:
            logger.error(f"Signal batch failed for chunk {i}: {e}")

    return {
        "results": all_results,
        "entry_ready_count": entry_ready_total,
        "total_analyzed": len(tickers),
    }


def _format_slack_message(entry_ready: list[dict], total: int, date_str: str) -> dict:
    """Slack Block Kit 形式のメッセージを作成"""
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"Entry Signal (機械判定) — {date_str}",
            },
        },
    ]

    if not entry_ready:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"発掘 {total} 銘柄を分析しましたが、エントリー条件に合致する銘柄はありませんでした。",
            },
        })
        return {"blocks": blocks}

    for s in entry_ready:
        ticker = s.get("ticker", "???")
        price = s.get("price")
        rs = s.get("relative_strength", {}) or {}
        rs_pct = rs.get("change_pct", 0)
        rs_trend = rs.get("trend", "?")
        size = s.get("position_size_pct", 0)
        name = s.get("name", "")

        price_str = f"${price:.2f}" if price else ""
        name_str = f" ({name})" if name else ""

        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*{ticker}*{name_str} {price_str}\n"
                    f"RS: {rs_pct:+.1f}% ({rs_trend}) | Size: {size}%"
                ),
            },
        })

    blocks.append({"type": "divider"})
    blocks.append({
        "type": "context",
        "elements": [
            {
                "type": "mrkdwn",
                "text": f"発掘 {total} 銘柄中 {len(entry_ready)} 銘柄がエントリー条件合致",
            },
        ],
    })

    return {"blocks": blocks}


def _format_discord_message(entry_ready: list[dict], total: int, date_str: str) -> dict:
    """Discord Embed 形式のメッセージを作成"""
    if not entry_ready:
        return {
            "embeds": [{
                "title": f"Entry Signal (機械判定) — {date_str}",
                "description": f"発掘 {total} 銘柄を分析しましたが、エントリー条件に合致する銘柄はありませんでした。",
                "color": 0x808080,
            }],
        }

    fields = []
    for s in entry_ready:
        ticker = s.get("ticker", "???")
        price = s.get("price")
        rs = s.get("relative_strength", {}) or {}
        rs_pct = rs.get("change_pct", 0)
        rs_trend = rs.get("trend", "?")
        size = s.get("position_size_pct", 0)
        name = s.get("name", "")

        price_str = f"${price:.2f}" if price else ""
        name_str = f" ({name})" if name else ""

        fields.append({
            "name": f"{ticker}{name_str} {price_str}",
            "value": f"RS: {rs_pct:+.1f}% ({rs_trend}) | Size: {size}%",
            "inline": False,
        })

    return {
        "embeds": [{
            "title": f"Entry Signal (機械判定) — {date_str}",
            "description": f"発掘 {total} 銘柄中 {len(entry_ready)} 銘柄がエントリー条件合致",
            "fields": fields,
            "color": 0x22C55E,  # green
        }],
    }


def _send_slack(payload: dict):
    """Slack webhook に POST"""
    if not SLACK_WEBHOOK_URL:
        logger.debug("SLACK_WEBHOOK_URL not set, skipping")
        return
    try:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(SLACK_WEBHOOK_URL, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        urllib.request.urlopen(req, timeout=10)
        logger.info("Slack notification sent")
    except Exception as e:
        logger.error(f"Slack notification failed: {e}")


def _send_discord(payload: dict):
    """Discord webhook に POST"""
    if not DISCORD_WEBHOOK_URL:
        logger.debug("DISCORD_WEBHOOK_URL not set, skipping")
        return
    try:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(DISCORD_WEBHOOK_URL, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        urllib.request.urlopen(req, timeout=10)
        logger.info("Discord notification sent")
    except Exception as e:
        logger.error(f"Discord notification failed: {e}")


def check_and_notify():
    """メイン: 発掘銘柄の entry 判定 + Slack/Discord 通知"""
    if not SLACK_WEBHOOK_URL and not DISCORD_WEBHOOK_URL:
        logger.warning("No webhook URLs configured (SLACK_WEBHOOK_URL / DISCORD_WEBHOOK_URL)")
        return

    date_str = datetime.now().strftime("%Y-%m-%d")
    logger.info(f"=== Notify pipeline: {date_str} ===")

    # 1. 発掘銘柄を取得
    tickers = _fetch_discovered_tickers()
    if not tickers:
        logger.info("No discovered stocks for today, skipping notification")
        return

    # 2. 一括 signal 分析
    result = _analyze_batch(tickers)
    total = result["total_analyzed"]
    entry_ready = [r for r in result["results"] if r.get("entry_allowed")]

    logger.info(f"Analysis complete: {len(entry_ready)}/{total} entry ready")

    # 3. 通知送信
    if SLACK_WEBHOOK_URL:
        slack_msg = _format_slack_message(entry_ready, total, date_str)
        _send_slack(slack_msg)

    if DISCORD_WEBHOOK_URL:
        discord_msg = _format_discord_message(entry_ready, total, date_str)
        _send_discord(discord_msg)

    logger.info("=== Notify pipeline done ===")


# ===== Exit 通知 =====

def _fetch_holdings() -> list[dict]:
    """DB から保有中の銘柄を取得 (shares > 0)"""
    try:
        from app.batch.config import get_conn
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT ticker, avg_price, entry_date, user_id "
                "FROM holdings WHERE shares > 0"
            )
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
        logger.info(f"Holdings: {len(rows)} active positions")
        return rows
    except Exception as e:
        logger.error(f"Failed to fetch holdings: {e}")
        return []


def _check_exit(ticker: str, entry_price: float, entry_date: str) -> dict | None:
    """GET /api/exit/{ticker} で exit 判定"""
    try:
        params = f"?entry_price={entry_price}&entry_date={entry_date}"
        return _api_get(_API_PYTHON_URL, f"/api/exit/{ticker}{params}", timeout=60)
    except Exception as e:
        logger.error(f"Exit check failed for {ticker}: {e}")
        return None


def _format_exit_slack(alerts: list[dict], date_str: str) -> dict:
    """Exit 通知の Slack メッセージ"""
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"Exit Signal (マイポジション) — {date_str}"},
        },
    ]

    for a in alerts:
        ticker = a["ticker"]
        current = a.get("current_price", 0)
        pnl = a.get("pnl_pct", 0)
        reason = a.get("exit_reason", "")
        urgency = a.get("urgency", "")
        should_exit = a.get("should_exit", False)
        exit_pct = a.get("exit_pct", 0)
        entry_price = a.get("entry_price", 0)
        days = a.get("holding_days", 0)

        if should_exit:
            icon = "🔴" if exit_pct >= 100 else "🟠"
            action = f"全売却" if exit_pct >= 100 else f"{exit_pct}%売却"
        else:
            icon = "✅"
            action = "保有継続"

        pnl_str = f"+{pnl:.1f}%" if pnl >= 0 else f"{pnl:.1f}%"
        price_str = f"${current:.2f}" if current else ""

        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"{icon} *{ticker}* {price_str} — {action}\n"
                    f"   理由: {reason}\n"
                    f"   含み{'益' if pnl >= 0 else '損'}: {pnl_str} | 保有 {days}日"
                ),
            },
        })

    blocks.append({"type": "divider"})
    blocks.append({
        "type": "context",
        "elements": [{"type": "mrkdwn", "text": f"保有 {len(alerts)} 銘柄の exit 判定結果"}],
    })

    return {"blocks": blocks}


def _format_exit_discord(alerts: list[dict], date_str: str) -> dict:
    """Exit 通知の Discord メッセージ"""
    fields = []
    for a in alerts:
        ticker = a["ticker"]
        current = a.get("current_price", 0)
        pnl = a.get("pnl_pct", 0)
        reason = a.get("exit_reason", "")
        should_exit = a.get("should_exit", False)
        exit_pct = a.get("exit_pct", 0)
        days = a.get("holding_days", 0)

        icon = "🔴" if should_exit and exit_pct >= 100 else ("🟠" if should_exit else "✅")
        action = "全売却" if should_exit and exit_pct >= 100 else (f"{exit_pct}%売却" if should_exit else "保有継続")
        pnl_str = f"+{pnl:.1f}%" if pnl >= 0 else f"{pnl:.1f}%"

        fields.append({
            "name": f"{icon} {ticker} (${current:.2f}) — {action}",
            "value": f"{reason} | {pnl_str} | {days}日",
            "inline": False,
        })

    color = 0xEF4444 if any(a.get("should_exit") for a in alerts) else 0x22C55E
    return {
        "embeds": [{
            "title": f"Exit Signal (マイポジション) — {date_str}",
            "fields": fields,
            "color": color,
        }],
    }


def check_exit_signals():
    """保有銘柄の exit 判定 + Slack/Discord 通知"""
    if not SLACK_WEBHOOK_URL and not DISCORD_WEBHOOK_URL:
        return

    date_str = datetime.now().strftime("%Y-%m-%d")
    logger.info(f"=== Exit check: {date_str} ===")

    holdings = _fetch_holdings()
    if not holdings:
        logger.info("No active holdings, skipping exit check")
        return

    alerts = []
    for h in holdings:
        ticker = h["ticker"]
        entry_price = float(h["avg_price"])
        entry_date = str(h.get("entry_date") or "")[:10]

        result = _check_exit(ticker, entry_price, entry_date)
        if not result:
            continue

        should_exit = result.get("should_exit", False)
        urgency = result.get("urgency", "LOW")

        # 保有日数を計算
        holding_days = 0
        if entry_date:
            try:
                from datetime import date as _date
                ed = _date.fromisoformat(entry_date)
                holding_days = (_date.today() - ed).days
            except Exception:
                pass

        alert = {
            "ticker": ticker,
            "current_price": result.get("current_price", 0),
            "entry_price": entry_price,
            "pnl_pct": result.get("pnl_pct", 0),
            "should_exit": should_exit,
            "exit_pct": result.get("exit_pct", 0),
            "exit_reason": result.get("exit_reason", ""),
            "urgency": urgency,
            "holding_days": holding_days,
        }

        # 通知条件: should_exit=true または urgency=HIGH/CRITICAL
        if should_exit or urgency in ("HIGH", "CRITICAL"):
            alerts.append(alert)

    logger.info(f"Exit check: {len(alerts)}/{len(holdings)} need attention")

    if not alerts:
        logger.info("No exit signals, skipping notification")
        return

    if SLACK_WEBHOOK_URL:
        _send_slack(_format_exit_slack(alerts, date_str))

    if DISCORD_WEBHOOK_URL:
        _send_discord(_format_exit_discord(alerts, date_str))

    logger.info("=== Exit check done ===")
