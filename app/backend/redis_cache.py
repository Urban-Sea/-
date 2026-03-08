"""
redis_cache.py - L1 (インメモリ) + L2 (Upstash Redis) キャッシュ

L1: プロセスローカル dict（0ms、同一インスタンス内のみ）
L2: Upstash Redis REST（再起動・スケール to ゼロでも生存）

Redis 未設定 or 障害時は L1 のみで動作（グレースフルデグレード）。
"""
import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── L1: インメモリキャッシュ ──

_l1_cache: dict[str, dict] = {}  # key → {"data": ..., "expires": float}
_L1_MAX_SIZE = 500


def _evict_l1() -> None:
    """期限切れエントリを削除し、上限超過時は最古を削除"""
    now = time.time()
    expired = [k for k, v in _l1_cache.items() if v["expires"] < now]
    for k in expired:
        del _l1_cache[k]
    if len(_l1_cache) > _L1_MAX_SIZE:
        sorted_keys = sorted(_l1_cache, key=lambda k: _l1_cache[k]["expires"])
        for k in sorted_keys[: len(_l1_cache) - _L1_MAX_SIZE]:
            del _l1_cache[k]


# ── L2: Upstash Redis (lazy init) ──

_redis = None
_redis_init_attempted = False


def get_redis():
    """Upstash Redis クライアントを遅延初期化。未設定なら None。"""
    global _redis, _redis_init_attempted
    if _redis is not None:
        return _redis
    if _redis_init_attempted:
        return None

    _redis_init_attempted = True
    url = os.getenv("UPSTASH_REDIS_REST_URL", "")
    token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
    if not url or not token:
        return None
    try:
        from upstash_redis import Redis

        _redis = Redis(url=url, token=token)
        logger.info("Upstash Redis connected")
        return _redis
    except Exception as e:
        logger.warning(f"Upstash Redis init failed: {e}")
        return None


# ── 公開 API ──


def cache_get(key: str) -> Optional[Any]:
    """L1 → L2 の順でキャッシュ取得。ミスなら None。"""
    now = time.time()

    # L1
    if key in _l1_cache and _l1_cache[key]["expires"] > now:
        return _l1_cache[key]["data"]

    # L2
    redis = get_redis()
    if redis:
        try:
            raw = redis.get(key)
            if raw is not None:
                data = json.loads(raw) if isinstance(raw, str) else raw
                # L1 にバックフィル（短め TTL）
                _l1_cache[key] = {"data": data, "expires": now + 60}
                _evict_l1()
                return data
        except Exception as e:
            logger.debug(f"Redis GET error for {key}: {e}")

    return None


def _serialize(data: Any) -> Any:
    """Pydantic モデルを dict に変換。dict/list/プリミティブはそのまま返す。"""
    if hasattr(data, "model_dump"):
        return data.model_dump()
    if hasattr(data, "dict"):
        return data.dict()
    return data


def cache_set(key: str, data: Any, ttl: int = 300) -> None:
    """L1 と L2 の両方に保存。"""
    now = time.time()
    serializable = _serialize(data)

    # L1
    _l1_cache[key] = {"data": serializable, "expires": now + ttl}
    _evict_l1()

    # L2
    redis = get_redis()
    if redis:
        try:
            redis.set(key, json.dumps(serializable, default=str), ex=ttl)
        except Exception as e:
            logger.debug(f"Redis SET error for {key}: {e}")
