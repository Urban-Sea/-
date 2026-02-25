"""
認証ミドルウェア — Cloudflare Access ヘッダー検証

Cloudflare Access が付与するヘッダー:
  CF-Access-Authenticated-User-Email — 認証済みユーザーのメールアドレス

開発環境 (ENVIRONMENT != "production") ではヘッダーなしでも通過させる。
"""

import os
from fastapi import Header, HTTPException

# 本番環境フラグ
_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"


async def require_auth(
    cf_access_authenticated_user_email: str | None = Header(None),
) -> str:
    """
    Cloudflare Access 認証を検証し、ユーザーメールを返す。
    本番環境ではヘッダー必須。開発環境ではフォールバック値を使用。
    """
    if cf_access_authenticated_user_email:
        return cf_access_authenticated_user_email

    if not _IS_PRODUCTION:
        # 開発環境: ヘッダーなしでも通過（デフォルトユーザー）
        return "dev@localhost"

    raise HTTPException(
        status_code=401,
        detail="Authentication required",
    )
