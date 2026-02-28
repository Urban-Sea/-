"""
認証ミドルウェア — X-User-Email + X-Proxy-Secret ヘッダー検証

フロントエンドが Cloudflare Access の get-identity から取得したメールを
X-User-Email ヘッダーとして送信する。
※ CF-Access-* ヘッダーは Cloudflare エッジでストリップされるため使用不可。

本番環境では Worker → Backend 間の共有シークレット (X-Proxy-Secret) も検証し、
Railway への直接アクセスによるヘッダー偽装攻撃を防止する。

開発環境 (ENVIRONMENT != "production") ではヘッダーなしでも通過させる。

require_auth() は users テーブルの UUID を返す（メールアドレスではない）。
初回ログイン時にユーザーを自動作成し、古いメールベースの user_id を UUID に移行する。
"""

import os
import re
import hmac
import logging
from datetime import datetime, timezone
from fastapi import Header, HTTPException

logger = logging.getLogger(__name__)

# 本番環境フラグ
_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"
# Worker ↔ Backend 共有シークレット
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")

# メールアドレスの簡易バリデーション
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

# email → UUID キャッシュ（プロセスレベル、デプロイで自動クリア）
_user_cache: dict[str, str] = {}

# 初回ログイン時に自動移行するテーブル一覧
_USER_TABLES = [
    "holdings", "trades", "cash_balances",
    "portfolio_snapshots", "user_watchlists", "user_settings",
]


async def require_proxy(
    x_proxy_secret: str | None = Header(None),
) -> None:
    """
    プロキシ経由アクセスを検証（メール不要）。
    Worker → Backend 間の共有シークレットのみチェック。
    開発環境ではスキップ。
    """
    if not _IS_PRODUCTION:
        return
    if not _PROXY_SECRET:
        logger.error("PROXY_SECRET is not configured in production!")
        raise HTTPException(status_code=503, detail="Service misconfigured")
    if not x_proxy_secret or not hmac.compare_digest(x_proxy_secret, _PROXY_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")


def _resolve_user_id(email: str) -> str:
    """
    メールアドレスから users テーブルの UUID を解決する。
    未登録なら自動作成し、古いメールベースの user_id を UUID に移行する。
    """
    # キャッシュチェック
    if email in _user_cache:
        return _user_cache[email]

    from main import get_supabase
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    # users テーブル検索
    result = supabase.table("users").select("id, is_active").eq("email", email).limit(1).execute()

    if result.data:
        user_id = result.data[0]["id"]
        # アカウント凍結チェック
        if result.data[0].get("is_active") is False:
            raise HTTPException(status_code=403, detail="Account deactivated")
        # last_login_at を更新（キャッシュミス時 = セッション初回のみ）
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            supabase.table("users").update(
                {"last_login_at": now_iso}
            ).eq("id", user_id).execute()
        except Exception:
            pass  # ログイン時刻更新失敗は無視
    else:
        # 初回ログイン: ユーザー自動作成
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            create = supabase.table("users").insert({
                "email": email,
                "auth_provider": "cloudflare_access",
                "last_login_at": now_iso,
            }).execute()
            user_id = create.data[0]["id"]
        except Exception:
            # 競合: 別リクエストが先に作成済み
            retry = supabase.table("users").select("id").eq("email", email).limit(1).execute()
            if not retry.data:
                raise HTTPException(status_code=500, detail="Failed to create user")
            user_id = retry.data[0]["id"]

        # 古いメールベースの user_id を UUID に自動移行（このユーザー分のみ）
        migrated = []
        for table in _USER_TABLES:
            try:
                res = supabase.table(table).update(
                    {"user_id": user_id}
                ).eq("user_id", email).execute()
                if res.data:
                    migrated.append(f"{table}({len(res.data)})")
            except Exception as e:
                logger.warning(f"Migration skip {table}: {e}")

        if migrated:
            logger.info(f"Migrated user data: {email} -> {user_id} [{', '.join(migrated)}]")
        else:
            logger.info(f"New user created: {email} -> {user_id}")

    _user_cache[email] = user_id
    return user_id


async def require_auth(
    x_user_email: str | None = Header(None),
    x_proxy_secret: str | None = Header(None),
) -> str:
    """
    ユーザー認証を検証し、users テーブルの UUID を返す。
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
        return _resolve_user_id(email)

    if not _IS_PRODUCTION:
        # 開発環境: ヘッダーなしでも通過（デフォルトユーザー）
        return _resolve_user_id("dev@localhost")

    raise HTTPException(
        status_code=401,
        detail="Authentication required",
    )
