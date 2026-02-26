"""
認証ミドルウェア — X-User-Email ヘッダー検証

フロントエンドが Cloudflare Access の get-identity から取得したメールを
X-User-Email ヘッダーとして送信する。
※ CF-Access-* ヘッダーは Cloudflare エッジでストリップされるため使用不可。

開発環境 (ENVIRONMENT != "production") ではヘッダーなしでも通過させる。
"""

import os
from fastapi import Header, HTTPException

# 本番環境フラグ
_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"


async def require_auth(
    x_user_email: str | None = Header(None),
) -> str:
    """
    ユーザー認証を検証し、メールを返す。
    本番環境ではヘッダー必須。開発環境ではフォールバック値を使用。
    """
    if x_user_email:
        return x_user_email

    if not _IS_PRODUCTION:
        # 開発環境: ヘッダーなしでも通過（デフォルトユーザー）
        return "dev@localhost"

    raise HTTPException(
        status_code=401,
        detail="Authentication required",
    )
