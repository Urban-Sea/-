"""
事前計算結果の高速読み取り (Redis キャッシュ)

バッチが precomputed:{key} で Redis に書き込み、API はここから読む。
"""

import logging
from typing import Any

from redis_cache import cache_get

logger = logging.getLogger(__name__)


def get_precomputed(key: str, max_age_seconds: int = 86400) -> Any | None:
    """
    事前計算結果を取得。Redis (L1 インメモリ → L2 Redis) から探す。

    Args:
        key: "risk_score", "plumbing_summary", "market_events", "policy_regime"
        max_age_seconds: 未使用 (TTL は Redis 側で管理)

    Returns:
        事前計算結果のdict、または None（フォールバック計算が必要）
    """
    redis_key = f"precomputed:{key}"
    cached = cache_get(redis_key)
    if cached is not None:
        return cached

    return None
