"""
NASDAQ 100 構成銘柄の履歴を Wikipedia 改訂履歴から取得する。

戦略:
  1. Wikipedia の Nasdaq-100 ページの全 revision を MediaWiki API で列挙
  2. 期間 (start, end) の各月初付近の revision を 1 つずつ選択
  3. その revision の HTML を取得し、構成銘柄テーブルをパース
  4. 各スナップショット日 + 銘柄リストを CSV に出力

出力フォーマット:
  date,ticker
  2016-01-15,AAPL
  2016-01-15,MSFT
  ...

  → universe.py 側で日付ごとの set に変換して使う

ティッカー正規化:
  Wikipedia 表記 → yfinance 表記
    BRK.B → BRK-B (yfinance はハイフン)
    GOOG/GOOGL は別銘柄として両方扱う
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

import requests

WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_PAGE = "Nasdaq-100"
USER_AGENT = "open-regime-backtest/0.1 (research; contact: local)"

# yfinance 命名へのマッピング (ピリオド → ハイフン)
TICKER_FIXES = {
    "BRK.B": "BRK-B",
    "BF.B": "BF-B",
    # GOOG / GOOGL は両方そのまま (FB → META は revision 内の文字列がそのまま META)
}


@dataclass
class Snapshot:
    """1 つの構成銘柄スナップショット"""
    date: datetime
    revid: int
    tickers: list[str]


def _http_get(url: str, params: dict | None = None, retries: int = 3) -> requests.Response:
    headers = {"User-Agent": USER_AGENT}
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=30)
            if r.status_code == 200:
                return r
            time.sleep(1.5 * (attempt + 1))
        except Exception as e:  # noqa: BLE001
            last_exc = e
            time.sleep(1.5 * (attempt + 1))
    if last_exc:
        raise last_exc
    raise RuntimeError(f"HTTP failed after {retries} retries: {url}")


def list_revisions(start: datetime, end: datetime) -> list[dict]:
    """
    Wikipedia 改訂履歴を MediaWiki API で取得。

    Returns:
        list of {revid, timestamp, parentid}
    """
    revisions: list[dict] = []
    rvcontinue: str | None = None

    # 改訂履歴は新しい順 (rvdir=older) で取得し、end → start の範囲を取る
    while True:
        params = {
            "action": "query",
            "format": "json",
            "prop": "revisions",
            "titles": WIKI_PAGE,
            "rvprop": "ids|timestamp",
            "rvlimit": "500",
            "rvdir": "older",
            "rvstart": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "rvend": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        if rvcontinue:
            params["rvcontinue"] = rvcontinue

        r = _http_get(WIKI_API, params=params)
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            for rev in page.get("revisions", []):
                revisions.append({
                    "revid": int(rev["revid"]),
                    "timestamp": datetime.strptime(rev["timestamp"], "%Y-%m-%dT%H:%M:%SZ"),
                })

        cont = data.get("continue", {}).get("rvcontinue")
        if not cont:
            break
        rvcontinue = cont
        time.sleep(0.3)

    revisions.sort(key=lambda x: x["timestamp"])
    return revisions


def pick_monthly_revisions(revisions: list[dict], start: datetime, end: datetime) -> list[dict]:
    """
    各月で「その月の最初の revision」を 1 件ずつ採択する。
    """
    seen: dict[str, dict] = {}
    for rev in revisions:
        ts = rev["timestamp"]
        if ts < start or ts > end:
            continue
        key = ts.strftime("%Y-%m")
        if key not in seen:
            seen[key] = rev
    return [seen[k] for k in sorted(seen.keys())]


# 構成銘柄テーブルから ticker を抽出する正規表現
# wikitable 行内の最初の <td> の中の <a> リンクや太字を ticker として抽出
_TICKER_PATTERN = re.compile(
    r"<tr>\s*<td[^>]*>\s*(?:<[^>]+>\s*)*"  # 行の最初のセル
    r"(?:<a[^>]*>)?\s*"
    r"([A-Z][A-Z0-9.\-]{0,5})"
    r"\s*(?:</a>)?",
    re.IGNORECASE,
)

# wikitable に「Ticker」「Symbol」を含む列ヘッダがある場合は信頼度高い
_TABLE_PATTERN = re.compile(
    r'<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>(.*?)</table>',
    re.DOTALL,
)


def parse_revision_tickers(revid: int) -> list[str]:
    """
    指定 revision の Wikipedia ページから NASDAQ-100 構成銘柄を抽出。

    Wikipedia の Nasdaq-100 ページには通常「Components」セクションに wikitable があり、
    各行の最初のセルに ticker symbol が入っている。

    実装方針: HTML レンダリング済みを取得して正規表現で抽出 (BeautifulSoup 未使用で
    依存を増やさない)。
    """
    params = {
        "action": "parse",
        "format": "json",
        "oldid": str(revid),
        "prop": "text",
    }
    r = _http_get(WIKI_API, params=params)
    data = r.json()
    html = data.get("parse", {}).get("text", {}).get("*", "")
    if not html:
        return []

    # ticker を含みそうな wikitable を全部探索
    candidate_tickers: list[str] = []
    for tbl_match in _TABLE_PATTERN.finditer(html):
        tbl = tbl_match.group(1)
        # ヘッダに Symbol/Ticker/Company が含まれるテーブルだけ対象
        if not re.search(r"(Ticker|Symbol|Company)", tbl, re.IGNORECASE):
            continue

        # 各行の <td> の最初のセルから ticker を取る
        rows = re.findall(r"<tr>(.*?)</tr>", tbl, re.DOTALL)
        for row in rows:
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.DOTALL)
            if not cells:
                continue
            # 最初のセル
            first = cells[0]
            # HTML タグ除去
            text = re.sub(r"<[^>]+>", "", first).strip()
            text = text.replace("&amp;", "&").replace("&nbsp;", "").strip()
            # よくあるパターンの ticker (1-5 文字大文字 + 任意の .X)
            m = re.match(r"^([A-Z][A-Z0-9.\-]{0,5})$", text)
            if m:
                candidate_tickers.append(m.group(1))

        if candidate_tickers:
            # 最初に見つかった candidates テーブルを優先
            break

    # 重複除去 + ティッカー正規化
    seen = set()
    result = []
    for t in candidate_tickers:
        normalized = TICKER_FIXES.get(t, t)
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def fetch_snapshots(start: datetime, end: datetime) -> list[Snapshot]:
    print(f"[fetch_constituents] Listing revisions {start.date()} → {end.date()}", file=sys.stderr)
    all_revs = list_revisions(start, end)
    print(f"[fetch_constituents] {len(all_revs)} total revisions", file=sys.stderr)

    monthly = pick_monthly_revisions(all_revs, start, end)
    print(f"[fetch_constituents] {len(monthly)} monthly snapshots will be fetched", file=sys.stderr)

    snapshots: list[Snapshot] = []
    for i, rev in enumerate(monthly):
        ts = rev["timestamp"]
        revid = rev["revid"]
        print(f"  [{i+1}/{len(monthly)}] {ts.date()} revid={revid}", file=sys.stderr)
        try:
            tickers = parse_revision_tickers(revid)
        except Exception as e:  # noqa: BLE001
            print(f"    failed: {e}", file=sys.stderr)
            tickers = []

        # NASDAQ 100 は 100 銘柄あるはず。極端に少ない場合は warning
        if len(tickers) < 80:
            print(
                f"    WARN: only {len(tickers)} tickers parsed (expected ~100)",
                file=sys.stderr,
            )
        snapshots.append(Snapshot(date=ts, revid=revid, tickers=tickers))
        time.sleep(0.5)  # Wikipedia API への配慮

    return snapshots


def write_csv(snapshots: list[Snapshot], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "ticker"])
        for snap in snapshots:
            for t in snap.tickers:
                w.writerow([snap.date.strftime("%Y-%m-%d"), t])
    print(f"[fetch_constituents] wrote {output}", file=sys.stderr)


def main() -> None:
    p = argparse.ArgumentParser(description="Fetch NASDAQ 100 historical constituents from Wikipedia")
    p.add_argument("--start", default="2016-01-01", help="Start date (YYYY-MM-DD)")
    p.add_argument("--end", default="2026-04-08", help="End date (YYYY-MM-DD)")
    p.add_argument(
        "--output",
        default="data/nasdaq100_constituents.csv",
        help="Output CSV path (relative to project root)",
    )
    args = p.parse_args()

    start = datetime.strptime(args.start, "%Y-%m-%d")
    end = datetime.strptime(args.end, "%Y-%m-%d")

    snapshots = fetch_snapshots(start, end)
    write_csv(snapshots, Path(args.output))

    # ざっくりレポート
    n_snap = len(snapshots)
    n_total = sum(len(s.tickers) for s in snapshots)
    n_unique = len({t for s in snapshots for t in s.tickers})
    print(
        f"[fetch_constituents] DONE: {n_snap} snapshots, {n_total} rows, "
        f"{n_unique} unique tickers",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
