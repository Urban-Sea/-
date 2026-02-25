"""
事前計算結果の高速読み取り

バッチ処理で計算された結果がSupabaseに保存されている場合、
重い計算をスキップして直接返す。24時間以内の結果のみ有効。
"""

from datetime import datetime, timezone
from typing import Any
import main


_last_debug: dict = {}


def get_precomputed(key: str, max_age_seconds: int = 86400) -> Any | None:
    """
    事前計算結果を取得。有効期限内なら結果を返し、なければNoneを返す。

    Args:
        key: "risk_score", "plumbing_summary", "market_events", "policy_regime"
        max_age_seconds: 最大有効期間（デフォルト24時間）

    Returns:
        事前計算結果のdict、または None（フォールバック計算が必要）
    """
    supabase = main.get_supabase()
    if not supabase:
        _last_debug[key] = "no supabase"
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
            _last_debug[key] = "no data"
            return None

        row = resp.data[0]
        computed_at = datetime.fromisoformat(row["computed_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - computed_at).total_seconds()

        if age < max_age_seconds:
            _last_debug[key] = f"hit: age={age:.0f}s"
            return row["result"]

        _last_debug[key] = f"expired: age={age:.0f}s"
        return None
    except Exception as e:
        _last_debug[key] = f"error: {type(e).__name__}: {e}"
        return None
