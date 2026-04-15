#!/usr/bin/env python3
"""
finviz-publish.py — スキャン結果を open-regime VPS に送信する。

ローカルで finviz-scan.py が出力した JSON を VPS の
POST /api/admin/discovery/upsert に送るだけのスクリプト。

使い方:
    python tools/finviz/finviz-publish.py                     # 今日のファイルを送信
    python tools/finviz/finviz-publish.py 2026-04-10          # 日付指定
    python tools/finviz/finviz-publish.py path/to/file.json   # ファイルパス指定

環境変数 (必須):
    OPEN_REGIME_API_URL        例: https://open-regime.com
    OPEN_REGIME_PUBLISH_TOKEN  VPS 側の PUBLISH_TOKEN と同じ値
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "output"

API_URL = os.environ.get("OPEN_REGIME_API_URL", "").rstrip("/")
PUBLISH_TOKEN = os.environ.get("OPEN_REGIME_PUBLISH_TOKEN", "")

ENDPOINT = "/api/discovery/upsert"


def resolve_json_path(arg: str | None) -> Path:
    """引数から JSON ファイルパスを解決する。

    - None → 今日の日付 (output/YYYY-MM-DD.json)
    - "2026-04-10" のような日付文字列 → output/2026-04-10.json
    - それ以外 → そのままファイルパスとして扱う
    """
    if arg is None:
        return DEFAULT_OUTPUT_DIR / f"{date.today().isoformat()}.json"

    # 日付っぽければ output/ 配下を探す
    if len(arg) == 10 and arg[4] == "-" and arg[7] == "-":
        return DEFAULT_OUTPUT_DIR / f"{arg}.json"

    return Path(arg)


def main() -> int:
    if not API_URL:
        print("ERROR: OPEN_REGIME_API_URL is not set", file=sys.stderr)
        return 1
    if not PUBLISH_TOKEN:
        print("ERROR: OPEN_REGIME_PUBLISH_TOKEN is not set", file=sys.stderr)
        return 1

    arg = sys.argv[1] if len(sys.argv) > 1 else None
    json_path = resolve_json_path(arg)

    if not json_path.exists():
        print(f"ERROR: File not found: {json_path}", file=sys.stderr)
        return 1

    with json_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    # Basic validation.
    if "scan_date" not in payload or "tickers" not in payload:
        print("ERROR: JSON missing required fields (scan_date, tickers)", file=sys.stderr)
        return 1

    ticker_count = len(payload["tickers"])
    scan_date = payload["scan_date"]
    print(f"Publishing {ticker_count} tickers for {scan_date} to {API_URL}{ENDPOINT}")

    headers = {
        "X-Publish-Token": PUBLISH_TOKEN,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/json",
    }

    # CF Access Service Token (optional — set if site is behind Cloudflare Access)
    cf_client_id = os.environ.get("CF_ACCESS_CLIENT_ID", "")
    cf_client_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET", "")
    if cf_client_id and cf_client_secret:
        headers["CF-Access-Client-Id"] = cf_client_id
        headers["CF-Access-Client-Secret"] = cf_client_secret

    resp = requests.post(
        f"{API_URL}{ENDPOINT}",
        json=payload,
        headers=headers,
        timeout=30,
        allow_redirects=False,
    )

    if resp.status_code == 200:
        try:
            result = resp.json()
        except Exception:
            print(f"ERROR: Got HTTP 200 but response is not JSON", file=sys.stderr)
            print(resp.text[:500], file=sys.stderr)
            return 1
        print(f"OK: {result.get('count', '?')} tickers upserted for {result.get('scan_date', '?')}")
        return 0

    if resp.status_code in (301, 302, 303):
        print("ERROR: Redirected (Cloudflare Access is blocking the request)", file=sys.stderr)
        print("Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET env vars.", file=sys.stderr)
        print("See: https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/", file=sys.stderr)
        return 1

    print(f"ERROR: HTTP {resp.status_code}", file=sys.stderr)
    print(resp.text[:500], file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
