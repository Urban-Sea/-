"""
認証ミドルウェア — JWT 認証

フロントエンドが取得した JWT を Authorization: Bearer ヘッダーで送信。
Backend は JWKS 公開鍵 (ES256) または JWT_SECRET / SUPABASE_JWT_SECRET (HS256) で署名検証し、
sub + email からユーザーを解決する。

require_auth() は users テーブルの UUID を返す（メールアドレスではない）。
初回ログイン時にユーザーを自動作成する。

DB アクセス:
  Docker 環境 (DB_HOST set) → asyncpg (db.py の get_pool())
  Cloud Run 環境 → Supabase SDK (main.py の get_supabase())
"""

import os
import hmac
import logging
from datetime import datetime, timezone
from fastapi import Header, HTTPException

import jwt as pyjwt  # PyJWT
from jwt import PyJWKClient
from cachetools import TTLCache
import sentry_sdk

logger = logging.getLogger(__name__)

# 本番環境フラグ
_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"
# Worker ↔ Backend 共有シークレット
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")
# JWT シークレット（HMAC 用）— Docker: JWT_SECRET, Cloud Run: SUPABASE_JWT_SECRET
_SUPABASE_JWT_SECRET = os.getenv("JWT_SECRET", "") or os.getenv("SUPABASE_JWT_SECRET", "")
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

# auth_provider_id → users.id キャッシュ
_provider_id_cache: TTLCache = TTLCache(maxsize=1000, ttl=300)

# DB_HOST が設定されていれば asyncpg を使う（Docker 環境判定）
_USE_ASYNCPG = bool(os.getenv("DB_HOST", ""))



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
# JWT 認証パス — ユーザー解決
# ──────────────────────────────────────────────

async def _resolve_user_by_jwt(sub: str, email: str) -> str:
    """
    JWT の sub + email から users テーブルの UUID を解決する。
    1. auth_provider_id で検索（リピーター高速パス）
    2. email で検索（CF Access → Supabase Auth 移行パス）
    3. 新規ユーザー作成

    Docker 環境 (DB_HOST set) → asyncpg
    Cloud Run 環境 → Supabase SDK
    """
    if sub in _provider_id_cache:
        return _provider_id_cache[sub]

    now_iso = datetime.now(timezone.utc).isoformat()

    if _USE_ASYNCPG:
        return await _resolve_user_asyncpg(sub, email, now_iso)
    else:
        return _resolve_user_supabase(sub, email, now_iso)


async def _resolve_user_asyncpg(sub: str, email: str, now_iso: str) -> str:
    """asyncpg を使ったユーザー解決（Docker 環境）"""
    from db import get_pool
    pool = get_pool()
    if not pool:
        raise HTTPException(status_code=503, detail="Database not connected")

    # 1. auth_provider_id で検索
    row = await pool.fetchrow(
        "SELECT id, is_active FROM users WHERE auth_provider_id = $1",
        sub,
    )
    if row:
        if row["is_active"] is False:
            raise HTTPException(status_code=403, detail="Account deactivated")
        user_id = str(row["id"])
        _provider_id_cache[sub] = user_id
        try:
            await pool.execute(
                "UPDATE users SET last_login_at = $1 WHERE id = $2",
                datetime.now(timezone.utc), row["id"],
            )
        except Exception as e:
            logger.warning("Failed to update last_login_at for user %s: %s", user_id, e)
        return user_id

    # 2. email で検索
    if email:
        email_lower = email.strip().lower()
        row = await pool.fetchrow(
            "SELECT id, is_active, auth_provider FROM users WHERE email = $1",
            email_lower,
        )
        if row:
            if row["is_active"] is False:
                raise HTTPException(status_code=403, detail="Account deactivated")
            if row["auth_provider"] not in (None, "", "cloudflare_access"):
                logger.warning(
                    "Rejected auth migration: email=%s already bound to provider=%s",
                    email_lower[:3] + "***", row["auth_provider"],
                )
                raise HTTPException(
                    status_code=409,
                    detail="Account already linked to another identity",
                )
            try:
                await pool.execute(
                    "UPDATE users SET auth_provider = $1, auth_provider_id = $2, last_login_at = $3 WHERE id = $4",
                    "supabase", sub, datetime.now(timezone.utc), row["id"],
                )
            except Exception as e:
                logger.warning("Failed to migrate auth_provider for %s: %s", email_lower[:3] + "***", e)
            user_id = str(row["id"])
            _provider_id_cache[sub] = user_id
            logger.info("Migrated auth provider: %s -> supabase (sub=%s)", email_lower[:3] + "***", sub[:8])
            return user_id

    # 3. 新規ユーザー作成
    user_email = email.strip().lower() if email else f"supabase:{sub}"
    try:
        row = await pool.fetchrow(
            "INSERT INTO users (email, auth_provider, auth_provider_id, last_login_at) "
            "VALUES ($1, $2, $3, $4) RETURNING id",
            user_email, "supabase", sub, datetime.now(timezone.utc),
        )
        user_id = str(row["id"])
        logger.info("New user: %s -> %s", user_email[:3] + "***", user_id)
    except Exception as e:
        logger.warning("User creation race for sub=%s: %s", sub[:8], e)
        row = await pool.fetchrow(
            "SELECT id FROM users WHERE auth_provider_id = $1", sub,
        )
        if not row:
            raise HTTPException(status_code=500, detail="Failed to create user")
        user_id = str(row["id"])

    _provider_id_cache[sub] = user_id
    return user_id


def _resolve_user_supabase(sub: str, email: str, now_iso: str) -> str:
    """Supabase SDK を使ったユーザー解決（Cloud Run フォールバック）"""
    from main import get_supabase
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

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

    # 2. email で検索
    if email:
        email_lower = email.strip().lower()
        result = supabase.table("users").select("id, is_active, auth_provider").eq(
            "email", email_lower
        ).limit(1).execute()

        if result.data:
            user = result.data[0]
            if user.get("is_active") is False:
                raise HTTPException(status_code=403, detail="Account deactivated")
            if user.get("auth_provider") not in (None, "", "cloudflare_access"):
                logger.warning(
                    "Rejected auth migration: email=%s already bound to provider=%s",
                    email_lower[:3] + "***", user.get("auth_provider"),
                )
                raise HTTPException(
                    status_code=409,
                    detail="Account already linked to another identity",
                )
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
# メインの認証依存関数
# ──────────────────────────────────────────────

async def require_auth(
    authorization: str | None = Header(None),
) -> str:
    """
    JWT 認証: users テーブルの UUID を返す。
    Authorization: Bearer <jwt> (Supabase Auth)
    """
    # ── Path 1: Supabase Auth JWT ──
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
        token_alg = "unknown"
        try:
            # トークンヘッダーを取得（kid の有無でパスを分岐）
            try:
                header = pyjwt.get_unverified_header(token)
            except Exception:
                header = {}
            token_alg = header.get("alg", "HS256")
            token_kid = header.get("kid")

            # issuer 検証用パラメータ（設定済みなら強制）
            _issuer_kwargs: dict = {}
            if _SUPABASE_URL:
                _issuer_kwargs["issuer"] = f"{_SUPABASE_URL}/auth/v1"

            if token_kid and _jwks_client:
                # ── kid あり → JWKS 公開鍵で検証（ES256 等）──
                # kid の有無でパスを決定し、攻撃者が alg を偽装しても JWKS パスを通る
                signing_key = _jwks_client.get_signing_key_from_jwt(token)
                # JWKS から取得した鍵のアルゴリズムのみ許可（トークン自称の alg は使わない）
                key_alg = getattr(signing_key, "_algorithm", None) or token_alg
                payload = pyjwt.decode(
                    token,
                    signing_key.key,
                    algorithms=[key_alg],
                    audience="authenticated",
                    **_issuer_kwargs,
                )
            elif _IS_PRODUCTION and _jwks_client:
                # ── 本番で JWKS が使えるのに kid なし → alg confusion 防止で拒否 ──
                # Supabase ES256 トークンは必ず kid を持つ。
                # kid なしトークンは HMAC 偽造の可能性があるため本番では拒否。
                logger.warning(
                    "Rejected token without kid in production (alg=%s)", token_alg
                )
                raise HTTPException(status_code=401, detail="Invalid token")
            else:
                # ── kid なし → HMAC シークレットで検証（開発環境のみ）──
                if not _SUPABASE_JWT_SECRET:
                    logger.error("SUPABASE_JWT_SECRET not configured")
                    raise HTTPException(status_code=503, detail="Service misconfigured")
                # token_alg が HS ファミリーであることを検証し、それだけを許可
                if token_alg not in ("HS256", "HS384", "HS512"):
                    logger.error("JWT uses unsupported HMAC algorithm: %s", token_alg)
                    raise HTTPException(status_code=401, detail="Unsupported token algorithm")
                payload = pyjwt.decode(
                    token,
                    _SUPABASE_JWT_SECRET,
                    algorithms=[token_alg],
                    audience="authenticated",
                    **_issuer_kwargs,
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
        except pyjwt.InvalidIssuerError:
            logger.error("JWT issuer mismatch — rejected")
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

        # Sentry: エラー発生時にユーザーを特定するためのコンテキスト
        sentry_sdk.set_user({"id": sub})

        return await _resolve_user_by_jwt(sub, email)

    raise HTTPException(
        status_code=401,
        detail="Authentication required",
    )
