"""
認証ミドルウェア — Dual-mode: Supabase Auth JWT + Legacy X-User-Email

Phase 1 (JWT — 新規):
  フロントエンドが Supabase Auth で取得した JWT を Authorization: Bearer ヘッダーで送信。
  Backend は SUPABASE_JWT_SECRET で署名検証し、sub + email からユーザーを解決する。

Phase 2 (Legacy — フォールバック):
  Cloudflare Access 時代の X-User-Email + X-Proxy-Secret ヘッダー検証。
  移行完了後に削除予定。

require_auth() は users テーブルの UUID を返す（メールアドレスではない）。
初回ログイン時にユーザーを自動作成し、古いメールベースの user_id を UUID に移行する。
"""

import os
import re
import hmac
import logging
from datetime import datetime, timezone
from fastapi import Header, HTTPException

import jwt as pyjwt  # PyJWT

logger = logging.getLogger(__name__)

# 本番環境フラグ
_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"
# Worker ↔ Backend 共有シークレット
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")
# Supabase JWT シークレット（Supabase Dashboard → Settings → API → JWT Secret）
_SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

# メールアドレスの簡易バリデーション
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

# email → UUID キャッシュ（プロセスレベル、デプロイで自動クリア）
_user_cache: dict[str, str] = {}
# auth_provider_id (Supabase Auth UUID) → users.id キャッシュ
_provider_id_cache: dict[str, str] = {}

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


# ──────────────────────────────────────────────
# JWT 認証パス (Supabase Auth)
# ──────────────────────────────────────────────

def _resolve_user_by_jwt(sub: str, email: str) -> str:
    """
    Supabase Auth の JWT から users テーブルの UUID を解決する。
    1. auth_provider_id で検索（リピーター高速パス）
    2. email で検索（CF Access → Supabase Auth 移行パス）
    3. 新規ユーザー作成
    """
    if sub in _provider_id_cache:
        return _provider_id_cache[sub]

    from main import get_supabase
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. auth_provider_id で検索
    result = supabase.table("users").select("id, is_active").eq(
        "auth_provider_id", sub
    ).limit(1).execute()

    if result.data:
        user = result.data[0]
        if user.get("is_active") is False:
            raise HTTPException(status_code=403, detail="Account deactivated")
        _provider_id_cache[sub] = user["id"]
        try:
            supabase.table("users").update(
                {"last_login_at": now_iso}
            ).eq("id", user["id"]).execute()
        except Exception:
            pass
        return user["id"]

    # 2. email で検索（CF Access 時代のユーザーを移行）
    if email:
        email_lower = email.strip().lower()
        result = supabase.table("users").select("id, is_active").eq(
            "email", email_lower
        ).limit(1).execute()

        if result.data:
            user = result.data[0]
            if user.get("is_active") is False:
                raise HTTPException(status_code=403, detail="Account deactivated")
            # auth_provider を supabase に更新（CF Access → Supabase 移行完了マーク）
            try:
                supabase.table("users").update({
                    "auth_provider": "supabase",
                    "auth_provider_id": sub,
                    "last_login_at": now_iso,
                }).eq("id", user["id"]).execute()
            except Exception:
                pass
            _provider_id_cache[sub] = user["id"]
            logger.info(f"Migrated auth provider: {email_lower} -> supabase (sub={sub})")
            return user["id"]

    # 3. 新規ユーザー作成
    user_email = email.strip().lower() if email else f"supabase:{sub}"
    try:
        create = supabase.table("users").insert({
            "email": user_email,
            "auth_provider": "supabase",
            "auth_provider_id": sub,
            "last_login_at": now_iso,
        }).execute()
        user_id = create.data[0]["id"]
        logger.info(f"New Supabase Auth user: {user_email} -> {user_id}")
    except Exception:
        # 競合: 別リクエストが先に作成済み
        retry = supabase.table("users").select("id").eq(
            "auth_provider_id", sub
        ).limit(1).execute()
        if not retry.data:
            raise HTTPException(status_code=500, detail="Failed to create user")
        user_id = retry.data[0]["id"]

    _provider_id_cache[sub] = user_id
    return user_id


# ──────────────────────────────────────────────
# Legacy 認証パス (Cloudflare Access)
# ──────────────────────────────────────────────

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


# ──────────────────────────────────────────────
# メインの認証依存関数
# ──────────────────────────────────────────────

async def require_auth(
    authorization: str | None = Header(None),
    x_user_email: str | None = Header(None),
    x_proxy_secret: str | None = Header(None),
) -> str:
    """
    Dual-mode 認証: users テーブルの UUID を返す。

    1. Authorization: Bearer <jwt> (Supabase Auth — 優先)
    2. X-User-Email + X-Proxy-Secret (Legacy CF Access — フォールバック)
    """
    # ── Path 1: Supabase Auth JWT ──
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
        if not _SUPABASE_JWT_SECRET:
            logger.error("SUPABASE_JWT_SECRET not configured")
            raise HTTPException(status_code=503, detail="Service misconfigured")
        try:
            payload = pyjwt.decode(
                token,
                _SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except pyjwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except pyjwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")

        sub = payload.get("sub")
        email = payload.get("email", "")
        if not sub:
            raise HTTPException(status_code=401, detail="Invalid token: missing sub")

        return _resolve_user_by_jwt(sub, email)

    # ── Path 2: Legacy X-User-Email + X-Proxy-Secret ──
    if _IS_PRODUCTION:
        if not _PROXY_SECRET:
            logger.error("PROXY_SECRET is not configured in production!")
            raise HTTPException(status_code=503, detail="Service misconfigured")
        if not x_proxy_secret or not hmac.compare_digest(x_proxy_secret, _PROXY_SECRET):
            # JWT もレガシーヘッダーもない場合
            if not x_user_email:
                raise HTTPException(status_code=401, detail="Authentication required")
            raise HTTPException(status_code=403, detail="Forbidden")

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
