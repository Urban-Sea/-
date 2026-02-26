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
import re
import hmac
import logging
from fastapi import Header, HTTPException

logger = logging.getLogger(__name__)

# 本番環境フラグ
_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"
# Worker ↔ Backend 共有シークレット
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")

# メールアドレスの簡易バリデーション
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


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
    if _IS_PRODUCTION:
        if not _PROXY_SECRET:
            # PROXY_SECRET 未設定は致命的な設定ミス — 全リクエスト拒否
            logger.error("PROXY_SECRET is not configured in production!")
            raise HTTPException(status_code=503, detail="Service misconfigured")
        if not x_proxy_secret or not hmac.compare_digest(x_proxy_secret, _PROXY_SECRET):
            raise HTTPException(status_code=403, detail="Forbidden")

    # メールヘッダー検証
    if x_user_email:
        email = x_user_email.strip().lower()
        if len(email) > 254 or not _EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Invalid email format")
        return email

    if not _IS_PRODUCTION:
        # 開発環境: ヘッダーなしでも通過（デフォルトユーザー）
        return "dev@localhost"

    raise HTTPException(
        status_code=401,
        detail="Authentication required",
    )
