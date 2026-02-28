"""
/api/admin — 管理者用エンドポイント
管理者メールリスト (ADMIN_EMAILS 環境変数) で認可制御。
"""
import hashlib
import json
import os
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request

import main
from auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter()

# カンマ区切りの管理者メールリスト
_ADMIN_EMAILS: set[str] = set(
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "").split(",")
    if e.strip()
)

_VALID_PLANS = {"free", "pro_trial", "pro", "demo"}


def is_admin_email(email: str) -> bool:
    """メールアドレスが管理者かどうか判定"""
    return email.strip().lower() in _ADMIN_EMAILS


async def require_admin(user_id: str = Depends(require_auth)) -> str:
    """管理者権限を検証。users テーブルから email を取得し ADMIN_EMAILS と照合。"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    result = (
        supabase.table("users")
        .select("email")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Not Found")

    email = result.data[0]["email"].lower()
    if email not in _ADMIN_EMAILS:
        raise HTTPException(status_code=404, detail="Not Found")

    return user_id


async def require_admin_mfa(
    admin_id: str = Depends(require_admin),
    x_mfa_token: str | None = Header(None),
) -> str:
    """
    管理者認証 + MFA セッション検証。
    MFA が有効な管理者は有効なセッショントークンが必須。
    MFA 未設定の場合はそのまま通過（段階的導入のため）。
    """
    supabase = main.get_supabase()

    # MFA 設定状態チェック
    mfa_result = (
        supabase.table("admin_mfa")
        .select("enabled")
        .eq("user_id", admin_id)
        .limit(1)
        .execute()
    )

    # MFA 未設定 or 無効 → そのまま通過
    if not mfa_result.data or not mfa_result.data[0]["enabled"]:
        return admin_id

    # MFA 有効 → トークン検証必須
    if not x_mfa_token:
        raise HTTPException(status_code=403, detail="MFA verification required")

    token_hash = hashlib.sha256(x_mfa_token.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()

    session = (
        supabase.table("admin_mfa_sessions")
        .select("id")
        .eq("user_id", admin_id)
        .eq("token_hash", token_hash)
        .gte("expires_at", now)
        .limit(1)
        .execute()
    )

    if not session.data:
        raise HTTPException(status_code=403, detail="MFA session expired or invalid")

    return admin_id


def _audit_log(supabase, admin_user_id: str, action: str,
               target_type: str = None, target_id: str = None,
               old_value: dict = None, new_value: dict = None):
    """監査ログを記録（失敗しても例外にしない）"""
    try:
        supabase.table("admin_audit_logs").insert({
            "admin_user_id": admin_user_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "old_value": json.dumps(old_value) if old_value else None,
            "new_value": json.dumps(new_value) if new_value else None,
        }).execute()
    except Exception as e:
        logger.warning(f"Audit log failed: {e}")


# ============================================================
# Users
# ============================================================

@router.get("/users")
async def list_users(_: str = Depends(require_admin_mfa)):
    """全ユーザー一覧を返す"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    result = (
        supabase.table("users")
        .select("id, email, display_name, plan, auth_provider, is_active, last_login_at, created_at")
        .order("created_at", desc=False)
        .execute()
    )
    return {"users": result.data, "total": len(result.data)}


@router.patch("/users/{target_user_id}")
async def update_user(
    target_user_id: str,
    request: Request,
    admin_id: str = Depends(require_admin_mfa),
):
    """ユーザーのプラン・表示名・有効状態を更新"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    body = await request.json()
    allowed = {"plan", "display_name", "is_active"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    # plan バリデーション
    if "plan" in updates and updates["plan"] not in _VALID_PLANS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan. Must be one of: {', '.join(sorted(_VALID_PLANS))}",
        )

    # is_active バリデーション
    if "is_active" in updates and not isinstance(updates["is_active"], bool):
        raise HTTPException(status_code=400, detail="is_active must be boolean")

    # 変更前の値を取得（監査ログ用）
    old = (
        supabase.table("users")
        .select("plan, display_name, is_active")
        .eq("id", target_user_id)
        .limit(1)
        .execute()
    )
    old_value = old.data[0] if old.data else {}

    supabase.table("users").update(updates).eq("id", target_user_id).execute()

    # 監査ログ
    _audit_log(
        supabase, admin_id, "update_user",
        target_type="user", target_id=target_user_id,
        old_value=old_value, new_value=updates,
    )

    return {"status": "updated"}


# ============================================================
# Stats
# ============================================================

@router.get("/stats")
async def get_stats(_: str = Depends(require_admin_mfa)):
    """ユーザー統計を返す"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    now = datetime.now(timezone.utc)
    day7 = (now - timedelta(days=7)).isoformat()
    day30 = (now - timedelta(days=30)).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    # 総ユーザー数
    all_users = supabase.table("users").select("id", count="exact").execute()
    total = all_users.count or 0

    # 7日アクティブ
    active_7d = (
        supabase.table("users")
        .select("id", count="exact")
        .gte("last_login_at", day7)
        .execute()
    )

    # 30日アクティブ
    active_30d = (
        supabase.table("users")
        .select("id", count="exact")
        .gte("last_login_at", day30)
        .execute()
    )

    # 今月新規
    new_this_month = (
        supabase.table("users")
        .select("id", count="exact")
        .gte("created_at", month_start)
        .execute()
    )

    # 日別登録数（過去30日）
    recent_users = (
        supabase.table("users")
        .select("created_at")
        .gte("created_at", day30)
        .order("created_at", desc=False)
        .execute()
    )
    daily_signups: dict[str, int] = {}
    for u in recent_users.data:
        day = u["created_at"][:10]
        daily_signups[day] = daily_signups.get(day, 0) + 1

    return {
        "total_users": total,
        "active_7d": active_7d.count or 0,
        "active_30d": active_30d.count or 0,
        "new_this_month": new_this_month.count or 0,
        "daily_signups": [
            {"date": k, "count": v} for k, v in sorted(daily_signups.items())
        ],
    }


# ============================================================
# Audit Logs
# ============================================================

@router.get("/audit-logs")
async def list_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    _: str = Depends(require_admin_mfa),
):
    """監査ログ一覧"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    result = (
        supabase.table("admin_audit_logs")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    # admin_user_id → email のマッピング
    admin_ids = list({r["admin_user_id"] for r in result.data})
    email_map: dict[str, str] = {}
    if admin_ids:
        admins = (
            supabase.table("users")
            .select("id, email")
            .in_("id", admin_ids)
            .execute()
        )
        email_map = {a["id"]: a["email"] for a in admins.data}

    logs = []
    for r in result.data:
        logs.append({
            **r,
            "admin_email": email_map.get(r["admin_user_id"], "unknown"),
        })

    return {"logs": logs, "total": len(logs)}


# ============================================================
# Batch Logs
# ============================================================

@router.get("/batch-logs")
async def list_batch_logs(
    limit: int = Query(50, ge=1, le=200),
    _: str = Depends(require_admin_mfa),
):
    """バッチ実行ログ一覧"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    result = (
        supabase.table("batch_logs")
        .select("*")
        .order("started_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"logs": result.data, "total": len(result.data)}


# ============================================================
# Feature Flags
# ============================================================

@router.get("/feature-flags")
async def list_feature_flags(_: str = Depends(require_admin_mfa)):
    """機能フラグ一覧"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    result = (
        supabase.table("feature_flags")
        .select("*")
        .order("created_at", desc=False)
        .execute()
    )
    return {"flags": result.data, "total": len(result.data)}


@router.post("/feature-flags")
async def create_feature_flag(
    request: Request,
    admin_id: str = Depends(require_admin_mfa),
):
    """機能フラグ作成"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    body = await request.json()
    flag_key = body.get("flag_key", "").strip()
    description = body.get("description", "").strip()

    if not flag_key:
        raise HTTPException(status_code=400, detail="flag_key is required")

    try:
        result = supabase.table("feature_flags").insert({
            "flag_key": flag_key,
            "description": description or None,
            "enabled": False,
        }).execute()
    except Exception:
        raise HTTPException(status_code=409, detail="Flag key already exists")

    _audit_log(
        supabase, admin_id, "create_feature_flag",
        target_type="feature_flag", target_id=flag_key,
        new_value={"flag_key": flag_key, "enabled": False},
    )

    return {"flag": result.data[0]}


@router.patch("/feature-flags/{flag_id}")
async def update_feature_flag(
    flag_id: int,
    request: Request,
    admin_id: str = Depends(require_admin_mfa),
):
    """機能フラグの ON/OFF 切替"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    body = await request.json()
    enabled = body.get("enabled")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=400, detail="enabled must be boolean")

    # 変更前を取得
    old = (
        supabase.table("feature_flags")
        .select("flag_key, enabled")
        .eq("id", flag_id)
        .limit(1)
        .execute()
    )
    if not old.data:
        raise HTTPException(status_code=404, detail="Flag not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("feature_flags").update({
        "enabled": enabled,
        "updated_at": now_iso,
    }).eq("id", flag_id).execute()

    _audit_log(
        supabase, admin_id, "update_feature_flag",
        target_type="feature_flag", target_id=old.data[0]["flag_key"],
        old_value={"enabled": old.data[0]["enabled"]},
        new_value={"enabled": enabled},
    )

    return {"status": "updated"}
