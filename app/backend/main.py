"""
Open Regime バックエンド API
FastAPI + asyncpg (Docker) / Supabase (Cloud Run フォールバック)
"""
import os
import hmac
import logging
import logging.handlers
from contextlib import asynccontextmanager

from pythonjsonlogger import jsonlogger


def setup_logging():
    """本番のみ JSON ファイル出力 (Wazuh SIEM 連携用)"""
    if os.getenv("ENVIRONMENT") != "production":
        return
    log_dir = "/var/log/open-regime/api-python"
    try:
        os.makedirs(log_dir, exist_ok=True)
    except Exception:
        return
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(name)s %(levelname)s %(message)s",
        rename_fields={"asctime": "time", "levelname": "level"},
    )
    file_handler = logging.handlers.RotatingFileHandler(
        filename=f"{log_dir}/app.log",
        maxBytes=50 * 1024 * 1024,
        backupCount=3,
    )
    file_handler.setFormatter(formatter)
    stdout_handler = logging.StreamHandler()
    stdout_handler.setFormatter(formatter)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(file_handler)
    root.addHandler(stdout_handler)


setup_logging()

from fastapi import FastAPI, Header as fastapi_Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from supabase import create_client, Client
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import sentry_sdk

_logger = logging.getLogger(__name__)

from db import init_pool, close_pool
from routers import stocks, signal, regime, liquidity, employment, market_state, holdings, trades, exit, stock, fx, watchlist, users, admin, admin_mfa

_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"


# --- Sentry error monitoring ---
def _sentry_before_send(event, hint):
    """4xx HTTPException は Sentry に送らない（5K/月の無料枠を節約）"""
    if "exc_info" in hint:
        _, exc_value, _ = hint["exc_info"]
        if isinstance(exc_value, HTTPException) and exc_value.status_code < 500:
            return None
    return event


_SENTRY_DSN = os.getenv("SENTRY_DSN", "")
if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        environment=os.getenv("ENVIRONMENT", "development"),
        traces_sample_rate=0.05,
        send_default_pii=False,
        before_send=_sentry_before_send,
    )
    _logger.info("Sentry initialized (env=%s)", os.getenv("ENVIRONMENT"))

# レート制限 (60 req/min per IP)
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])


class SecurityHeaderMiddleware(BaseHTTPMiddleware):
    """全レスポンスにセキュリティヘッダーを付与"""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if _IS_PRODUCTION:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )
        return response


# CSRF対策: 書き込みリクエストのOrigin検証
_ALLOWED_ORIGINS = {
    "https://open-regime.pages.dev",
    "https://open-regime-api.ryu3ta-ke-mo100307.workers.dev",
}
_MUTATING_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
# C1: CSRF検証で使うプロキシシークレット（値まで検証）
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")


class CSRFOriginMiddleware(BaseHTTPMiddleware):
    """書き込みリクエストの PROXY_SECRET を検証（CSRF 防止）
    本番では Origin バイパスなし — Cloud Run への正規リクエストは全て Worker 経由。
    """
    async def dispatch(self, request: Request, call_next):
        if _IS_PRODUCTION and request.method in _MUTATING_METHODS:
            proxy_secret_header = request.headers.get("x-proxy-secret", "")
            has_valid_proxy = (
                bool(_PROXY_SECRET)
                and bool(proxy_secret_header)
                and hmac.compare_digest(proxy_secret_header, _PROXY_SECRET)
            )
            if not has_valid_proxy:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Origin not allowed"},
                )
        return await call_next(request)

# Supabase client (global)
supabase: Client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """アプリケーションのライフサイクル管理"""
    global supabase

    # M2: 本番環境で必須シークレットの検証
    if _IS_PRODUCTION:
        missing = []
        if not os.getenv("PROXY_SECRET", "").strip():
            missing.append("PROXY_SECRET")
        if not os.getenv("JWT_SECRET", "").strip() and not os.getenv("SUPABASE_JWT_SECRET", "").strip():
            missing.append("JWT_SECRET or SUPABASE_JWT_SECRET")
        if missing:
            raise RuntimeError(
                f"Missing required secrets in production: {', '.join(missing)}"
            )
    else:
        _logger.warning(
            "Running in DEVELOPMENT mode (ENVIRONMENT=%s). "
            "Set ENVIRONMENT=production for production deployments.",
            os.getenv("ENVIRONMENT", "development"),
        )

    # 起動時: asyncpg pool (Docker 環境)
    if os.getenv("DB_HOST"):
        await init_pool()
        print("✅ asyncpg pool initialized")
    else:
        print("⚠️ DB_HOST not set — asyncpg pool skipped")

    # 起動時: Supabase接続 (Cloud Run フォールバック)
    supabase_url = (os.getenv("SUPABASE_URL") or "").strip()
    raw_key = os.getenv("SUPABASE_KEY", "").strip()
    raw_anon = os.getenv("SUPABASE_ANON_KEY", "").strip()
    supabase_key = raw_key or raw_anon
    key_type = "service_role" if raw_key else ("anon" if raw_anon else "none")

    if supabase_url and supabase_key:
        supabase = create_client(supabase_url, supabase_key)
        print(f"✅ Supabase connected ({key_type} key): {supabase_url[:30]}...")
    else:
        print(f"⚠️ Supabase credentials not found — CRUD routers will not work")

    yield

    # 終了時
    await close_pool()
    print("👋 Shutting down...")


app = FastAPI(
    title="Open Regime API",
    description="V10シグナル計算・Market Regime判定・流動性データAPI",
    version="1.0.0",
    lifespan=lifespan,
)

# レート制限をアプリに登録
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# セキュリティヘッダーミドルウェア（CORS より先に登録 = レスポンス処理は後）
app.add_middleware(SecurityHeaderMiddleware)
# CSRF Origin検証ミドルウェア
app.add_middleware(CSRFOriginMiddleware)

# CORS設定（本番では localhost を除外）
_cors_origins = [
    "https://open-regime.pages.dev",  # Cloudflare Pages
    "https://open-regime-api.ryu3ta-ke-mo100307.workers.dev",  # CF Worker proxy
]
if not _IS_PRODUCTION:
    _cors_origins += ["http://localhost:3000", "http://localhost:3001"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-MFA-Token"],
)


# ルーター登録
app.include_router(stocks.router, prefix="/api/stocks", tags=["stocks"])
app.include_router(signal.router, prefix="/api/signal", tags=["signal"])
app.include_router(regime.router, prefix="/api/regime", tags=["regime"])
app.include_router(liquidity.router, prefix="/api/liquidity", tags=["liquidity"])
app.include_router(employment.router, prefix="/api/employment", tags=["employment"])
app.include_router(market_state.router, prefix="/api/market-state", tags=["market-state"])
app.include_router(holdings.router, prefix="/api/holdings", tags=["holdings"])
app.include_router(trades.router, prefix="/api/trades", tags=["trades"])
app.include_router(exit.router, prefix="/api/exit", tags=["exit"])
app.include_router(stock.router, prefix="/api/stock", tags=["stock"])
app.include_router(fx.router, prefix="/api/fx", tags=["fx"])
app.include_router(watchlist.router, prefix="/api/watchlist", tags=["watchlist"])
app.include_router(users.router, prefix="/api/me", tags=["user"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(admin_mfa.router, prefix="/api/admin/mfa", tags=["admin-mfa"])


# ── JWT 診断エンドポイント ──
import jwt as pyjwt
from jwt import PyJWKClient as _DiagPyJWKClient

@app.get("/api/auth/check", tags=["auth"])
async def auth_check(
    authorization: str | None = fastapi_Header(None),
):
    """JWT 検証診断。本番では ok/ng のみ返す（情報漏洩防止）。"""
    if not authorization or not authorization.lower().startswith("bearer "):
        return {"ok": False, "error": "No Bearer token"}

    # 本番: 最小限の結果のみ返す（偵察防止）
    if _IS_PRODUCTION:
        try:
            from auth import require_auth
            await require_auth(authorization=authorization)
            return {"ok": True}
        except Exception:
            return {"ok": False, "error": "Invalid token"}

    # 開発環境: 詳細な診断情報を返す
    _jwt_secret = os.getenv("SUPABASE_JWT_SECRET", "")
    _supa_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    result: dict = {"step": "start", "ok": False}

    token = authorization[7:]
    result["step"] = "token_received"
    result["token_length"] = len(token)
    result["jwt_secret_configured"] = bool(_jwt_secret)
    result["supabase_url_configured"] = bool(_supa_url)

    # Step 1: ヘッダー + ペイロード確認（署名検証なし）
    try:
        header = pyjwt.get_unverified_header(token)
        result["header_alg"] = header.get("alg")
        result["header_kid"] = header.get("kid")
    except Exception:
        header = {}
    try:
        unverified = pyjwt.decode(token, options={"verify_signature": False})
        result["step"] = "unverified_decode_ok"
        result["claims"] = {
            "sub": (unverified.get("sub", "")[:8] + "...") if unverified.get("sub") else "MISSING",
            "aud": unverified.get("aud"),
            "iss": unverified.get("iss"),
            "email": (unverified.get("email", "")[:3] + "***") if unverified.get("email") else "MISSING",
            "email_confirmed_at": bool(unverified.get("email_confirmed_at")),
            "exp": unverified.get("exp"),
            "role": unverified.get("role"),
        }
    except Exception as e:
        result["error"] = f"Token malformed: {type(e).__name__}: {e}"
        return result

    # Step 2: 署名検証
    token_alg = header.get("alg", "HS256")
    result["verification_method"] = "jwks" if token_alg.startswith(("ES", "RS", "PS")) else "hmac_secret"

    try:
        if token_alg.startswith(("ES", "RS", "PS")):
            if not _supa_url:
                result["error"] = "SUPABASE_URL not configured — cannot fetch JWKS for asymmetric JWT"
                return result
            jwks_url = f"{_supa_url}/auth/v1/.well-known/jwks.json"
            result["jwks_url"] = jwks_url
            diag_jwks = _DiagPyJWKClient(jwks_url)
            signing_key = diag_jwks.get_signing_key_from_jwt(token)
            payload = pyjwt.decode(
                token, signing_key.key, algorithms=[token_alg], audience="authenticated",
            )
        else:
            if not _jwt_secret:
                result["error"] = "SUPABASE_JWT_SECRET not configured on server"
                return result
            allowed_algs = list({"HS256", "HS384", "HS512"} & {token_alg, "HS256", "HS384", "HS512"})
            result["allowed_algs"] = allowed_algs
            payload = pyjwt.decode(
                token, _jwt_secret, algorithms=allowed_algs, audience="authenticated",
            )
        result["step"] = "verified_decode_ok"
        result["ok"] = True
    except pyjwt.ExpiredSignatureError:
        result["error"] = "Token expired (ExpiredSignatureError)"
        return result
    except pyjwt.InvalidAudienceError:
        result["error"] = f"Audience mismatch: token aud={unverified.get('aud')!r}, expected='authenticated'"
        return result
    except pyjwt.InvalidSignatureError:
        result["error"] = "Signature mismatch — key does not match the token signing key"
        return result
    except pyjwt.InvalidTokenError as e:
        result["error"] = f"{type(e).__name__}: {e}"
        return result
    except Exception as e:
        result["error"] = f"JWKS fetch/verify error: {type(e).__name__}: {e}"
        return result

    # Step 3: issuer チェック
    if _supa_url:
        expected_iss = f"{_supa_url}/auth/v1"
        actual_iss = payload.get("iss", "")
        result["issuer_match"] = actual_iss == expected_iss
        if not result["issuer_match"]:
            result["issuer_warning"] = f"expected={expected_iss}, got={actual_iss}"

    # Step 4: email_confirmed_at チェック
    if not payload.get("email_confirmed_at"):
        result["email_confirmed_warning"] = "email_confirmed_at missing/null in JWT"

    return result


@app.get("/")
async def root():
    """ヘルスチェック"""
    return {
        "status": "ok",
        "message": "Open Regime API",
        "version": "1.0.0",
    }


@app.get("/health")
async def health_check():
    """ヘルスチェック（内部情報は返さない）"""
    return {"status": "healthy"}



def get_supabase() -> Client:
    """Supabaseクライアントを取得"""
    return supabase


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8081")), reload=True)
