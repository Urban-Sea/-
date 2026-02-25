"""
NY Fed SRF フェッチャー

Standing Repo Facility 利用データを NY Fed Markets API から取得。
"""

import logging
from collections import defaultdict
from typing import List

import requests

from ..config import NYFED_SRF_URL

logger = logging.getLogger("batch.fetchers.nyfed")


def fetch_srf_data(start: str, end: str) -> List[dict]:
    """SRF 利用データ → srf_usage 行リスト"""
    logger.info("Fetching srf_usage...")

    params = {
        "startDate": start,
        "endDate": end,
        "operationType": "Repo",
    }
    resp = requests.get(NYFED_SRF_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    operations = data.get("repo", {}).get("operations", [])
    if not operations:
        logger.info("  srf_usage: no operations found")
        return []

    # 日付ごとに集約（複数オペレーションの合計）
    daily: dict = defaultdict(float)
    for op in operations:
        op_date = op.get("operationDate", "")[:10]
        total = op.get("totalAmtAccepted") or op.get("totalAmtSubmitted") or 0
        try:
            # ドル → 十億ドル
            daily[op_date] += float(total) / 1_000_000_000
        except (ValueError, TypeError):
            continue

    rows = [
        {"date": d, "amount": round(v, 4)}
        for d, v in sorted(daily.items())
        if d  # 空文字除外
    ]

    logger.info(f"  srf_usage: {len(rows)} rows prepared")
    return rows
