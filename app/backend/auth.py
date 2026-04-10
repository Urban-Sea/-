"""
認証ミドルウェア — PROXY_SECRET 認証

nginx が計算 API (signal / regime / exit / stock / fx) へのリクエストに
X-Proxy-Secret ヘッダーを注入し、ここで検証する。
CRUD 認証 (JWT) は api-go が担当。
"""

import os
import hmac
import logging

from fastapi import Header, HTTPException

logger = logging.getLogger(__name__)

_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")


async def require_proxy(
    x_proxy_secret: str | None = Header(None),
) -> None:
    """
    プロキシ経由アクセスを検証（メール不要）。
    nginx → Backend 間の共有シークレットのみチェック。
    開発環境ではスキップ。
    """
    if not _IS_PRODUCTION:
        return
    if not _PROXY_SECRET:
        logger.error("PROXY_SECRET is not configured in production!")
        raise HTTPException(status_code=503, detail="Service misconfigured")
    if not x_proxy_secret or not hmac.compare_digest(x_proxy_secret, _PROXY_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")
