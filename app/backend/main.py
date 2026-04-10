"""
Open Regime バックエンド API
FastAPI + asyncpg — 計算 API (signal / regime / exit / stock / fx)
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
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(name)s %(levelname)s %(message)s",
        rename_fields={"asctime": "time", "levelname": "level"},
    )
    stdout_handler = logging.StreamHandler()
    stdout_handler.setFormatter(formatter)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(stdout_handler)

    log_dir = "/var/log/open-regime/api-python"
    try:
        os.makedirs(log_dir, exist_ok=True)
        file_handler = logging.handlers.RotatingFileHandler(
            filename=f"{log_dir}/app.log",
            maxBytes=50 * 1024 * 1024,
            backupCount=3,
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except Exception as e:
        _logger.warning("File logging disabled: %s", e)


setup_logging()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import sentry_sdk

_logger = logging.getLogger(__name__)

from db import init_pool, close_pool
from routers import signal, regime, exit, stock, fx

_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"


# --- Sentry error monitoring ---
def _sentry_before_send(event, hint):
    """4xx HTTPException は Sentry に送らない（5K/月の無料枠を節約）"""
    if "exc_info" in hint:
        _, exc_value, _ = hint["exc_info"]
        from fastapi import HTTPException
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
    "https://open-regime.com",
    "https://admin.open-regime.com",
}
_MUTATING_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
_PROXY_SECRET = os.getenv("PROXY_SECRET", "")


class CSRFOriginMiddleware(BaseHTTPMiddleware):
    """書き込みリクエストの PROXY_SECRET を検証（CSRF 防止）"""
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """アプリケーションのライフサイクル管理"""
    # M2: 本番環境で必須シークレットの検証
    if _IS_PRODUCTION:
        missing = []
        if not os.getenv("PROXY_SECRET", "").strip():
            missing.append("PROXY_SECRET")
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

    # 起動時: asyncpg pool
    if os.getenv("DB_HOST"):
        await init_pool()
        print("asyncpg pool initialized")
    else:
        print("DB_HOST not set — asyncpg pool skipped")

    yield

    # 終了時
    await close_pool()
    print("Shutting down...")


app = FastAPI(
    title="Open Regime API",
    description="シグナル計算・Market Regime判定・Exit分析API",
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
    "https://open-regime.com",
    "https://admin.open-regime.com",
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


# ルーター登録 (計算 API のみ — CRUD は api-go が担当)
app.include_router(signal.router, prefix="/api/signal", tags=["signal"])
app.include_router(regime.router, prefix="/api/regime", tags=["regime"])
app.include_router(exit.router, prefix="/api/exit", tags=["exit"])
app.include_router(stock.router, prefix="/api/stock", tags=["stock"])
app.include_router(fx.router, prefix="/api/fx", tags=["fx"])


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8081")), reload=True)
