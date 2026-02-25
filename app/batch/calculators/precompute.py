"""
事前計算: バックエンドAPIを呼び出し、結果をSupabaseに保存。
APIの計算ロジックを移動せずに、結果だけをキャッシュする。
"""

import logging
from datetime import datetime, timezone

import requests

from app.batch.config import get_supabase

logger = logging.getLogger("batch")

# バックエンドURL（Railway本番）
_API_BASE = "https://empathetic-hope-production.up.railway.app"

# 事前計算対象エンドポイント
_ENDPOINTS = {
    "risk_score": "/api/employment/risk-score",
    "plumbing_summary": "/api/liquidity/plumbing-summary",
    "market_events": "/api/liquidity/events",
    "policy_regime": "/api/liquidity/policy-regime",
}


def precompute_all() -> None:
    """全エンドポイントの結果を取得してSupabaseに保存"""
    sb = get_supabase()
    success = 0
    failed = 0

    for key, path in _ENDPOINTS.items():
        url = f"{_API_BASE}{path}"
        try:
            logger.info(f"Precomputing {key} ...")
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()

            sb.table("precomputed_results").upsert({
                "key": key,
                "result": resp.json(),
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }).execute()

            success += 1
            logger.info(f"  {key}: OK ({resp.elapsed.total_seconds():.1f}s)")

        except requests.RequestException as e:
            failed += 1
            logger.warning(f"  {key}: FAILED - {e}")
        except Exception as e:
            failed += 1
            logger.warning(f"  {key}: FAILED (DB) - {e}")

    logger.info(f"Precompute done: {success} OK, {failed} failed")
