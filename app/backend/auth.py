"""
認証ミドルウェア — X-User-Email + X-Proxy-Secret ヘッダー検証

フロントエンドが Cloudflare Access の get-identity から取得したメールを
X-User-Email ヘッダーとして送信する。
※ CF-Access-* ヘッダーは Cloudflare エッジでストリップされるため使用不可。

本番環境では Worker → Backend 間の共有シークレット (X-Proxy-Secret) も検証し、
Railway への直接アクセスによるヘッダー偽装攻撃を防止する。

開発環境 (ENVIRONMENT != "production") ではヘッダーなしでも通過させる。
"""

import os
import hmac
from fastapi import Header, HTTPException

# 本番環境フラグ
_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"
# Worker ↔ Backend 共有シークレット
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")


async def require_auth(
    x_user_email: str | None = Header(None),
    x_proxy_secret: str | None = Header(None),
) -> str:
    """
    ユーザー認証を検証し、メールを返す。
    本番環境ではプロキシシークレット + メールヘッダー必須。
    開発環境ではフォールバック値を使用。
    """
    # 本番環境: プロキシシークレット検証（Railway 直接アクセス防止）
    if _IS_PRODUCTION and _PROXY_SECRET:
        if not x_proxy_secret or not hmac.compare_digest(x_proxy_secret, _PROXY_SECRET):
            raise HTTPException(status_code=403, detail="Forbidden")

    if x_user_email:
        return x_user_email

    if not _IS_PRODUCTION:
        # 開発環境: ヘッダーなしでも通過（デフォルトユーザー）
        return "dev@localhost"

    raise HTTPException(
        status_code=401,
        detail="Authentication required",
    )
