"""
株式AI バックエンド API
FastAPI + Supabase
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client

from routers import stocks, signal, regime, liquidity, employment, market_state, holdings, trades, exit, stock


# Supabase client (global)
supabase: Client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """アプリケーションのライフサイクル管理"""
    global supabase

    # 起動時: Supabase接続
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_ANON_KEY")

    if supabase_url and supabase_key:
        supabase = create_client(supabase_url, supabase_key)
        print(f"✅ Supabase connected: {supabase_url[:30]}...")
    else:
        print("⚠️ Supabase credentials not found")

    yield

    # 終了時
    print("👋 Shutting down...")


app = FastAPI(
    title="株式AI API",
    description="V10シグナル計算・Market Regime判定・流動性データAPI",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://open-regime.pages.dev",  # Cloudflare Pages
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@app.get("/")
async def root():
    """ヘルスチェック"""
    return {
        "status": "ok",
        "message": "株式AI API",
        "version": "1.0.0",
    }


@app.get("/health")
async def health_check():
    """詳細ヘルスチェック"""
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
