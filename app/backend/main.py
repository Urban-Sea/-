"""
Open Regime バックエンド API
FastAPI + Supabase
"""
import os
import hmac
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from supabase import create_client, Client
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

_logger = logging.getLogger(__name__)

from routers import stocks, signal, regime, liquidity, employment, market_state, holdings, trades, exit, stock, fx, watchlist, users, admin, admin_mfa

_IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"

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
                "max-age=31536000; includeSubDomains"
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
    """書き込みリクエストのOriginヘッダーを検証（CSRF防止）"""
    async def dispatch(self, request: Request, call_next):
        if _IS_PRODUCTION and request.method in _MUTATING_METHODS:
            origin = request.headers.get("origin", "")
            # C1: X-Proxy-Secret の値を検証（存在チェックだけでは不十分）
            proxy_secret_header = request.headers.get("x-proxy-secret", "")
            has_valid_proxy = (
                bool(_PROXY_SECRET)
                and bool(proxy_secret_header)
                and hmac.compare_digest(proxy_secret_header, _PROXY_SECRET)
            )
            if not has_valid_proxy and origin not in _ALLOWED_ORIGINS:
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
        if not os.getenv("SUPABASE_JWT_SECRET", "").strip():
            missing.append("SUPABASE_JWT_SECRET")
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

    # 起動時: Supabase接続
    supabase_url = (os.getenv("SUPABASE_URL") or "").strip()
    # service_role キーを優先（RLSバイパス）、なければ anon key にフォールバック
    raw_key = os.getenv("SUPABASE_KEY", "").strip()
    raw_anon = os.getenv("SUPABASE_ANON_KEY", "").strip()
    supabase_key = raw_key or raw_anon
    key_type = "service_role" if raw_key else ("anon" if raw_anon else "none")

    if supabase_url and supabase_key:
        supabase = create_client(supabase_url, supabase_key)
        print(f"✅ Supabase connected ({key_type} key): {supabase_url[:30]}...")
    else:
        print(f"⚠️ Supabase credentials not found (key_type={key_type})")

    yield

    # 終了時
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
    allow_headers=["Content-Type", "Authorization", "X-User-Email", "X-MFA-Token"],
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
    """詳細ヘルスチェック（内部情報は返さない）"""
    return {
        "status": "healthy",
        "supabase": "connected" if supabase else "disconnected",
    }



def get_supabase() -> Client:
    """Supabaseクライアントを取得"""
    return supabase


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
