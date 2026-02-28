"""
/api/me — 現在のユーザー情報
"""
import logging
from fastapi import APIRouter, Depends, HTTPException

import main
from auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter()


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
    return result.data[0]
