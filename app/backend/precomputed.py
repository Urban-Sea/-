"""
事前計算結果の高速読み取り

バッチ処理で計算された結果がSupabaseに保存されている場合、
重い計算をスキップして直接返す。24時間以内の結果のみ有効。
"""

from datetime import datetime, timezone
from typing import Any
import main


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
        return None

    try:
        resp = (
            supabase.table("precomputed_results")
            .select("result, computed_at")
            .eq("key", key)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            return None

        computed_at = datetime.fromisoformat(resp.data["computed_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - computed_at).total_seconds()

        if age < max_age_seconds:
            return resp.data["result"]

        return None
    except Exception:
        # DB読み取りエラー時はフォールバック（従来計算）
        return None
