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
from jwt import PyJWKClient
from cachetools import TTLCache

logger = logging.getLogger(__name__)

# 本番環境フラグ
_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"
# Worker ↔ Backend 共有シークレット
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")
# Supabase JWT シークレット（HMAC 用フォールバック）
_SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
# Supabase URL（JWT issuer 検証 + JWKS エンドポイント用）
_SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")

# JWKS クライアント（ES256 等の非対称鍵アルゴリズム用）
_jwks_client: PyJWKClient | None = None
if _SUPABASE_URL:
    _jwks_client = PyJWKClient(
        f"{_SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        cache_keys=True,
        lifespan=3600,  # 1時間キャッシュ
    )

# メールアドレスの簡易バリデーション
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

# email → UUID キャッシュ（5分TTL, 最大1000件 — M1: 無制限dict脆弱性修正）
_user_cache: TTLCache = TTLCache(maxsize=1000, ttl=300)
# auth_provider_id (Supabase Auth UUID) → users.id キャッシュ
_provider_id_cache: TTLCache = TTLCache(maxsize=1000, ttl=300)

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
        except Exception as e:
            logger.warning("Failed to update last_login_at for user %s: %s", user["id"], e)
        return user["id"]

    # 2. email で検索（CF Access 時代のユーザーを移行）
    if email:
        email_lower = email.strip().lower()
        # H2: auth_provider も取得（移行済みアカウントの乗っ取り防止）
        result = supabase.table("users").select("id, is_active, auth_provider").eq(
            "email", email_lower
        ).limit(1).execute()

        if result.data:
            user = result.data[0]
            if user.get("is_active") is False:
                raise HTTPException(status_code=403, detail="Account deactivated")
            # H2: 既に Supabase Auth に移行済みなら別 sub での紐付けを拒否
            if user.get("auth_provider") not in (None, "", "cloudflare_access"):
                logger.warning(
                    "Rejected auth migration: email=%s already bound to provider=%s",
                    email_lower[:3] + "***", user.get("auth_provider"),
                )
                raise HTTPException(
                    status_code=409,
                    detail="Account already linked to another identity",
                )
            # auth_provider を supabase に更新（CF Access → Supabase 移行完了マーク）
            try:
                supabase.table("users").update({
                    "auth_provider": "supabase",
                    "auth_provider_id": sub,
                    "last_login_at": now_iso,
                }).eq("id", user["id"]).execute()
            except Exception as e:
                logger.warning("Failed to migrate auth_provider for %s: %s", email_lower[:3] + "***", e)
            _provider_id_cache[sub] = user["id"]
            logger.info("Migrated auth provider: %s -> supabase (sub=%s)", email_lower[:3] + "***", sub[:8])
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
        logger.info("New Supabase Auth user: %s -> %s", user_email[:3] + "***", user_id)
    except Exception as e:
        # 競合: 別リクエストが先に作成済み
        logger.warning("User creation race for sub=%s: %s", sub[:8], e)
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
        except Exception as e:
            logger.warning("Failed to update last_login_at: %s", e)
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
        except Exception as e:
            # 競合: 別リクエストが先に作成済み
            logger.warning("User creation race for email=%s: %s", email[:3] + "***", e)
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
        try:
            # トークンヘッダーからアルゴリズムを判定
            try:
                header = pyjwt.get_unverified_header(token)
            except Exception:
                header = {}
            token_alg = header.get("alg", "HS256")

            if token_alg.startswith("ES") or token_alg.startswith("RS") or token_alg.startswith("PS"):
                # ── 非対称鍵 (ES256, RS256 等): JWKS 公開鍵で検証 ──
                if not _jwks_client:
                    logger.error("JWKS client not available (SUPABASE_URL not set)")
                    raise HTTPException(status_code=503, detail="Service misconfigured")
                signing_key = _jwks_client.get_signing_key_from_jwt(token)
                payload = pyjwt.decode(
                    token,
                    signing_key.key,
                    algorithms=[token_alg],
                    audience="authenticated",
                )
            else:
                # ── 対称鍵 (HS256 等): SUPABASE_JWT_SECRET で検証 ──
                if not _SUPABASE_JWT_SECRET:
                    logger.error("SUPABASE_JWT_SECRET not configured")
                    raise HTTPException(status_code=503, detail="Service misconfigured")
                allowed_algs = list({"HS256", "HS384", "HS512"} & {token_alg, "HS256", "HS384", "HS512"})
                if not allowed_algs:
                    logger.error("JWT uses unsupported algorithm: %s", token_alg)
                    raise HTTPException(status_code=401, detail="Unsupported token algorithm")
                payload = pyjwt.decode(
                    token,
                    _SUPABASE_JWT_SECRET,
                    algorithms=allowed_algs,
                    audience="authenticated",
                )

            # H1: issuer 検証（警告のみ — URL不一致でもブロックしない）
            if _SUPABASE_URL:
                expected_iss = f"{_SUPABASE_URL}/auth/v1"
                actual_iss = payload.get("iss", "")
                if actual_iss != expected_iss:
                    logger.warning(
                        "JWT issuer mismatch: expected=%s, got=%s",
                        expected_iss, actual_iss,
                    )
        except pyjwt.ExpiredSignatureError:
            logger.warning("JWT expired for request")
            raise HTTPException(status_code=401, detail="Token expired")
        except pyjwt.InvalidSignatureError:
            logger.error("JWT signature verification failed (alg=%s)", token_alg)
            raise HTTPException(status_code=401, detail="Invalid token")
        except pyjwt.InvalidAudienceError:
            logger.error("JWT audience mismatch — expected 'authenticated'")
            raise HTTPException(status_code=401, detail="Invalid token")
        except pyjwt.InvalidTokenError as e:
            logger.error("JWT validation failed: %s: %s", type(e).__name__, e)
            raise HTTPException(status_code=401, detail="Invalid token")

        sub = payload.get("sub")
        email = payload.get("email", "")
        if not sub:
            raise HTTPException(status_code=401, detail="Invalid token: missing sub")

        # M9: メール未確認チェック（警告のみ — Supabase版によりJWTにクレームがない場合あり）
        if not payload.get("email_confirmed_at"):
            logger.warning(
                "JWT missing email_confirmed_at (sub=%s). "
                "Supabase may not include this claim.",
                sub[:8],
            )

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
        # C5: レガシーパス使用の非推奨ログ
        logger.warning(
            "DEPRECATED: X-User-Email auth used (email=%s). Migrate to JWT.",
            x_user_email[:3] + "***",
        )
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
