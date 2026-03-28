"""
事前計算: バックエンドAPIを呼び出し、結果を PostgreSQL + Redis に保存。
APIの計算ロジックを移動せずに、結果だけをキャッシュする。
"""

import json
import logging
import os
from datetime import datetime, timezone

import requests

from app.batch.config import get_conn

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
    """Redis クライアントを取得。REDIS_URL が設定されていれば直接接続、なければ None。"""
    redis_url = os.getenv("REDIS_URL", "")
    if redis_url:
        try:
            import redis
            return redis.from_url(redis_url, decode_responses=True)
        except Exception:
            return None

    # Upstash フォールバック（非Docker環境）
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
    """全エンドポイントの結果を取得して PostgreSQL + Redis に保存"""
    conn = get_conn()
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

            # PostgreSQL に保存（フォールバック）
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO precomputed_results (key, result, computed_at) "
                    "VALUES (%s, %s, %s) "
                    "ON CONFLICT (key) DO UPDATE SET result = EXCLUDED.result, computed_at = EXCLUDED.computed_at",
                    (key, json.dumps(result_data, default=str),
                     datetime.now(timezone.utc).isoformat()),
                )

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
