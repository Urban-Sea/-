"""
/api/watchlist - ウォッチリストCRUD
holdings.pyパターンに準拠。
"""
import re
import logging
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, field_validator
from typing import Optional, List
import main
from auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter()

_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


class WatchlistRecord(BaseModel):
    id: Optional[str] = None
    user_id: Optional[str] = None
    name: str = "メイン"
    tickers: List[str] = []
    is_default: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class WatchlistCreate(BaseModel):
    name: str = "メイン"
    tickers: List[str] = []
    is_default: bool = False

    @field_validator("tickers")
    @classmethod
    def validate_tickers(cls, v: list[str]) -> list[str]:
        if len(v) > 50:
            raise ValueError("Maximum 50 tickers")
        return [t.upper() for t in v if _TICKER_RE.match(t.upper())]


class WatchlistUpdate(BaseModel):
    name: Optional[str] = None
    tickers: Optional[List[str]] = None
    is_default: Optional[bool] = None


class WatchlistsResponse(BaseModel):
    watchlists: List[WatchlistRecord]
    total: int


@router.get("", response_model=WatchlistsResponse)
async def get_watchlists(user_email: str = Depends(require_auth)):
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        result = (
            supabase.table("user_watchlists")
            .select("*")
            .eq("user_id", user_email)
            .order("is_default", desc=True)
            .order("name")
            .execute()
        )
        watchlists = [WatchlistRecord(**row) for row in result.data]
        return WatchlistsResponse(watchlists=watchlists, total=len(watchlists))
    except Exception as e:
        logger.exception("Watchlist get error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=WatchlistRecord)
async def create_watchlist(body: WatchlistCreate, user_email: str = Depends(require_auth)):
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        data = {
            "user_id": user_email,
            "name": body.name,
            "tickers": body.tickers,
            "is_default": body.is_default,
        }
        result = supabase.table("user_watchlists").insert(data).execute()
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create")
        return WatchlistRecord(**result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Watchlist create error")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{watchlist_id}", response_model=WatchlistRecord)
async def update_watchlist(
    watchlist_id: str,
    body: WatchlistUpdate,
    user_email: str = Depends(require_auth),
):
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        update_data = {}
        if body.name is not None:
            update_data["name"] = body.name
        if body.tickers is not None:
            update_data["tickers"] = [t.upper() for t in body.tickers if _TICKER_RE.match(t.upper())]
        if body.is_default is not None:
            update_data["is_default"] = body.is_default
        if not update_data:
            raise HTTPException(status_code=400, detail="No update data")
        result = (
            supabase.table("user_watchlists")
            .update(update_data)
            .eq("id", watchlist_id)
            .eq("user_id", user_email)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        return WatchlistRecord(**result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Watchlist update error")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{watchlist_id}")
async def delete_watchlist(watchlist_id: str, user_email: str = Depends(require_auth)):
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        result = (
            supabase.table("user_watchlists")
            .delete()
            .eq("id", watchlist_id)
            .eq("user_id", user_email)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        return {"status": "deleted", "id": watchlist_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Watchlist delete error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add-ticker")
async def add_ticker(
    ticker: str = Query(...),
    user_email: str = Depends(require_auth),
):
    """デフォルトウォッチリストにティッカー追加（auto-create）"""
    ticker = ticker.upper()
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker")
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        result = (
            supabase.table("user_watchlists")
            .select("*")
            .eq("user_id", user_email)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        if result.data:
            wl = result.data[0]
            tickers = wl["tickers"] or []
            if ticker not in tickers:
                tickers.append(ticker)
                supabase.table("user_watchlists").update({"tickers": tickers}).eq("id", wl["id"]).eq("user_id", user_email).execute()
            return {"tickers": tickers}
        else:
            supabase.table("user_watchlists").insert({
                "user_id": user_email,
                "name": "メイン",
                "tickers": [ticker],
                "is_default": True,
            }).execute()
            return {"tickers": [ticker]}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Add ticker error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/remove-ticker")
async def remove_ticker(
    ticker: str = Query(...),
    user_email: str = Depends(require_auth),
):
    """デフォルトウォッチリストからティッカー削除"""
    ticker = ticker.upper()
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    try:
        result = (
            supabase.table("user_watchlists")
            .select("*")
            .eq("user_id", user_email)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        if result.data:
            wl = result.data[0]
            tickers = [t for t in (wl["tickers"] or []) if t != ticker]
            supabase.table("user_watchlists").update({"tickers": tickers}).eq("id", wl["id"]).eq("user_id", user_email).execute()
            return {"tickers": tickers}
        return {"tickers": []}
    except Exception as e:
        logger.exception("Remove ticker error")
        raise HTTPException(status_code=500, detail=str(e))
