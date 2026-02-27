"""
/api/stocks - stock_master一覧
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import main
from auth import require_proxy

router = APIRouter(dependencies=[Depends(require_proxy)])


class StockMaster(BaseModel):
    """銘柄マスターのレスポンス"""
    ticker: str
    name: Optional[str]
    sector: Optional[str]
    industry: Optional[str]
    price_category: Optional[str]
    watchlist_category: Optional[str]
    market_cap: Optional[int]
    exchange: Optional[str]
    is_active: bool


class StocksResponse(BaseModel):
    """銘柄一覧レスポンス"""
    stocks: list[StockMaster]
    total: int


@router.get("", response_model=StocksResponse)
async def get_stocks(
    category: Optional[str] = Query(None, description="価格カテゴリでフィルタ: penny, mid, large"),
    watchlist: Optional[str] = Query(None, description="ウォッチリストカテゴリでフィルタ"),
    active_only: bool = Query(True, description="アクティブのみ取得"),
):
    """
    stock_master一覧を取得

    - **category**: penny (<$20), mid ($20-100), large ($100+)
    - **watchlist**: robotics, defense, ai など
    - **active_only**: is_active=trueのみ
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("stock_master").select("*")

        if active_only:
            query = query.eq("is_active", True)

        if category:
            query = query.eq("price_category", category)

        if watchlist:
            query = query.eq("watchlist_category", watchlist)

        # ティッカーでソート
        query = query.order("ticker")

        result = query.execute()

        stocks = [StockMaster(**row) for row in result.data]

        return StocksResponse(stocks=stocks, total=len(stocks))

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{ticker}", response_model=StockMaster)
async def get_stock(ticker: str):
    """
    特定の銘柄情報を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("stock_master").select("*").eq("ticker", ticker.upper()).single().execute()

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Stock {ticker} not found")

        return StockMaster(**result.data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/categories/list")
async def get_categories():
    """
    利用可能なカテゴリ一覧を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = supabase.table("stock_master").select("price_category, watchlist_category").execute()

        price_categories = set()
        watchlist_categories = set()

        for row in result.data:
            if row.get("price_category"):
                price_categories.add(row["price_category"])
            if row.get("watchlist_category"):
                watchlist_categories.add(row["watchlist_category"])

        return {
            "price_categories": sorted(list(price_categories)),
            "watchlist_categories": sorted(list(watchlist_categories)),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
