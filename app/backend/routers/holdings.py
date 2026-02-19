"""
/api/holdings - 保有銘柄CRUD
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import main

router = APIRouter()


class HoldingRecord(BaseModel):
    """保有銘柄レコード"""
    id: Optional[int] = None
    user_id: str
    ticker: str
    shares: float
    avg_cost: float
    entry_date: Optional[str] = None
    sector: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class HoldingCreate(BaseModel):
    """保有銘柄作成"""
    ticker: str
    shares: float
    avg_cost: float
    entry_date: Optional[str] = None
    sector: Optional[str] = None
    notes: Optional[str] = None


class HoldingUpdate(BaseModel):
    """保有銘柄更新"""
    shares: Optional[float] = None
    avg_cost: Optional[float] = None
    sector: Optional[str] = None
    notes: Optional[str] = None


class HoldingsResponse(BaseModel):
    """保有銘柄一覧レスポンス"""
    holdings: List[HoldingRecord]
    total: int
    total_value: Optional[float] = None


@router.get("", response_model=HoldingsResponse)
async def get_holdings(
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    保有銘柄一覧を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("holdings")
            .select("*")
            .eq("user_id", user_id)
            .order("ticker")
            .execute()
        )

        holdings = [HoldingRecord(**row) for row in result.data]

        # 合計評価額（avg_cost * shares）
        total_value = sum(h.shares * h.avg_cost for h in holdings)

        return HoldingsResponse(
            holdings=holdings,
            total=len(holdings),
            total_value=total_value
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{ticker}", response_model=HoldingRecord)
async def get_holding(
    ticker: str,
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    特定銘柄の保有情報を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("holdings")
            .select("*")
            .eq("user_id", user_id)
            .eq("ticker", ticker.upper())
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Holding {ticker} not found")

        return HoldingRecord(**result.data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=HoldingRecord)
async def create_holding(
    holding: HoldingCreate,
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    保有銘柄を追加
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        data = {
            "user_id": user_id,
            "ticker": holding.ticker.upper(),
            "shares": holding.shares,
            "avg_cost": holding.avg_cost,
            "entry_date": holding.entry_date,
            "sector": holding.sector,
            "notes": holding.notes,
        }

        result = supabase.table("holdings").insert(data).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create holding")

        return HoldingRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{ticker}", response_model=HoldingRecord)
async def update_holding(
    ticker: str,
    holding: HoldingUpdate,
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    保有銘柄を更新
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 更新データを構築（Noneでない値のみ）
        update_data = {}
        if holding.shares is not None:
            update_data["shares"] = holding.shares
        if holding.avg_cost is not None:
            update_data["avg_cost"] = holding.avg_cost
        if holding.sector is not None:
            update_data["sector"] = holding.sector
        if holding.notes is not None:
            update_data["notes"] = holding.notes

        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")

        result = (
            supabase.table("holdings")
            .update(update_data)
            .eq("user_id", user_id)
            .eq("ticker", ticker.upper())
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Holding {ticker} not found")

        return HoldingRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{ticker}")
async def delete_holding(
    ticker: str,
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    保有銘柄を削除
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("holdings")
            .delete()
            .eq("user_id", user_id)
            .eq("ticker", ticker.upper())
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Holding {ticker} not found")

        return {"status": "deleted", "ticker": ticker.upper()}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{ticker}/add")
async def add_to_holding(
    ticker: str,
    shares: float = Query(..., description="追加株数"),
    price: float = Query(..., description="取得単価"),
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    既存の保有銘柄に買い増し（平均取得単価を再計算）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 現在の保有を取得
        current = (
            supabase.table("holdings")
            .select("*")
            .eq("user_id", user_id)
            .eq("ticker", ticker.upper())
            .single()
            .execute()
        )

        if not current.data:
            raise HTTPException(status_code=404, detail=f"Holding {ticker} not found")

        old_shares = current.data["shares"]
        old_cost = current.data["avg_cost"]

        # 平均取得単価を再計算
        new_shares = old_shares + shares
        new_avg_cost = ((old_shares * old_cost) + (shares * price)) / new_shares

        # 更新
        result = (
            supabase.table("holdings")
            .update({"shares": new_shares, "avg_cost": new_avg_cost})
            .eq("user_id", user_id)
            .eq("ticker", ticker.upper())
            .execute()
        )

        return {
            "status": "updated",
            "ticker": ticker.upper(),
            "old_shares": old_shares,
            "new_shares": new_shares,
            "old_avg_cost": old_cost,
            "new_avg_cost": round(new_avg_cost, 4),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
