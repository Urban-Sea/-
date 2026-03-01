"""
事前計算: バックエンドAPIを呼び出し、結果をSupabase + Redis に保存。
APIの計算ロジックを移動せずに、結果だけをキャッシュする。
"""

import json
import logging
import os
from datetime import datetime, timezone

import requests

from app.batch.config import get_supabase

logger = logging.getLogger("batch")

# バックエンドURL（Cloud Run 本番）
_API_BASE = "https://open-regime-backend-1073412395842.us-east1.run.app"

# 事前計算対象エンドポイント
_ENDPOINTS = {
    "risk_score": "/api/employment/risk-score",
    "plumbing_summary": "/api/liquidity/plumbing-summary",
    "market_events": "/api/liquidity/events",
    "policy_regime": "/api/liquidity/policy-regime",
}

_PRECOMPUTE_TTL = 86400  # 24時間


def _get_redis():
    """Upstash Redis クライアントを取得。未設定なら None。"""
    url = os.getenv("UPSTASH_REDIS_REST_URL", "")
    token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
    if not url or not token:
        return None
    try:
        from upstash_redis import Redis
        return Redis(url=url, token=token)
    except Exception:
        return None


def precompute_all() -> None:
    """全エンドポイントの結果を取得してSupabase + Redis に保存"""
    sb = get_supabase()
    redis = _get_redis()
    success = 0
    failed = 0

    for key, path in _ENDPOINTS.items():
        url = f"{_API_BASE}{path}"
        try:
            logger.info(f"Precomputing {key} ...")
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()

            result_data = resp.json()

            # Supabase に保存（フォールバック）
            sb.table("precomputed_results").upsert({
                "key": key,
                "result": result_data,
                "computed_at": datetime.now(timezone.utc).isoformat(),
            }).execute()

            # Redis に保存（高速読み取り用）
            if redis:
                try:
                    redis.set(
                        f"precomputed:{key}",
                        json.dumps(result_data, default=str),
                        ex=_PRECOMPUTE_TTL,
                    )
                except Exception as e:
                    logger.warning(f"  {key}: Redis write failed - {e}")

            success += 1
            logger.info(f"  {key}: OK ({resp.elapsed.total_seconds():.1f}s)")

        except requests.RequestException as e:
            failed += 1
            logger.warning(f"  {key}: FAILED - {e}")
        except Exception as e:
            failed += 1
            logger.warning(f"  {key}: FAILED (DB) - {e}")

    logger.info(f"Precompute done: {success} OK, {failed} failed")
