"""
事前計算結果の高速読み取り（Redis → Supabase フォールバック）

L1: Redis（バッチが書き込み、TTL 24h）
L2: Supabase precomputed_results テーブル（永続フォールバック）
"""

import logging
from datetime import datetime, timezone
from typing import Any

import main
from redis_cache import cache_get, get_redis

logger = logging.getLogger(__name__)


def get_precomputed(key: str, max_age_seconds: int = 86400) -> Any | None:
    """
    事前計算結果を取得。Redis → Supabase の順で探す。

    Args:
        key: "risk_score", "plumbing_summary", "market_events", "policy_regime"
        max_age_seconds: 最大有効期間（デフォルト24時間）

    Returns:
        事前計算結果のdict、または None（フォールバック計算が必要）
    """
    # L1: Redis（cache_get は L1 インメモリ → L2 Redis の順）
    redis_key = f"precomputed:{key}"
    cached = cache_get(redis_key)
    if cached is not None:
        return cached

    # L2: Supabase フォールバック
    supabase = main.get_supabase()
    if not supabase:
        return None

    try:
        resp = (
            supabase.table("precomputed_results")
            .select("result, computed_at")
            .eq("key", key)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return None

        row = resp.data[0]
        computed_at = datetime.fromisoformat(row["computed_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - computed_at).total_seconds()

        if age < max_age_seconds:
            return row["result"]

        return None
    except Exception:
        return None
