"""
/api/me — 現在のユーザー情報
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Request

import main
from auth import require_auth
from routers.admin import is_admin_email

logger = logging.getLogger(__name__)

router = APIRouter()

_UPDATABLE_FIELDS = {"display_name"}


@router.get("")
async def get_me(user_id: str = Depends(require_auth)):
    """現在のユーザープロフィールを返す"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    result = (
        supabase.table("users")
        .select("id, email, display_name, plan, auth_provider, created_at")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    user = result.data[0]
    user["is_admin"] = is_admin_email(user.get("email", ""))
    return user


@router.patch("")
async def update_me(request: Request, user_id: str = Depends(require_auth)):
    """表示名などユーザー情報を更新"""
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    body = await request.json()
    updates = {k: v for k, v in body.items() if k in _UPDATABLE_FIELDS}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    # display_name のバリデーション
    if "display_name" in updates:
        name = updates["display_name"]
        if name is not None:
            name = str(name).strip()
            if len(name) > 50:
                raise HTTPException(status_code=400, detail="Display name too long (max 50)")
            updates["display_name"] = name if name else None

    supabase.table("users").update(updates).eq("id", user_id).execute()
    return {"status": "updated"}
