"""
/api/admin — 管理者用エンドポイント
管理者メールリスト (ADMIN_EMAILS 環境変数) で認可制御。
"""
import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Request

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


@router.get("/users")
async def list_users(_: str = Depends(require_admin)):
    """全ユーザー一覧を返す"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    result = (
        supabase.table("users")
        .select("id, email, display_name, plan, auth_provider, created_at")
        .order("created_at", desc=False)
        .execute()
    )
    return {"users": result.data, "total": len(result.data)}


@router.patch("/users/{target_user_id}")
async def update_user(
    target_user_id: str,
    request: Request,
    _: str = Depends(require_admin),
):
    """ユーザーのプランや表示名を更新"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    body = await request.json()
    allowed = {"plan", "display_name"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    # plan バリデーション
    if "plan" in updates and updates["plan"] not in _VALID_PLANS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid plan. Must be one of: {', '.join(sorted(_VALID_PLANS))}",
        )

    supabase.table("users").update(updates).eq("id", target_user_id).execute()
    return {"status": "updated"}
