"""
/api/holdings - 保有銘柄CRUD
設計ドキュメント準拠
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import main

router = APIRouter()


class HoldingRecord(BaseModel):
    """保有銘柄レコード"""
    id: Optional[str] = None
    user_id: Optional[str] = None
    ticker: str
    shares: float
    avg_price: float
    entry_date: Optional[str] = None
    account_type: Optional[str] = None  # 'nisa', 'tokutei'
    sector: Optional[str] = None
    regime_at_entry: Optional[str] = None  # 'BULL', 'BEAR', 'RECOVERY', 'WEAKENING'
    rs_at_entry: Optional[str] = None  # 'UP', 'FLAT', 'DOWN'
    fx_rate: Optional[float] = 150.0
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    thesis: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class HoldingCreate(BaseModel):
    """保有銘柄作成"""
    ticker: str
    shares: float
    avg_price: float
    entry_date: Optional[str] = None
    account_type: Optional[str] = "tokutei"
    sector: Optional[str] = None
    regime_at_entry: Optional[str] = None
    rs_at_entry: Optional[str] = None
    fx_rate: Optional[float] = 150.0
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    thesis: Optional[str] = None
    notes: Optional[str] = None


class HoldingUpdate(BaseModel):
    """保有銘柄更新"""
    shares: Optional[float] = None
    avg_price: Optional[float] = None
    account_type: Optional[str] = None
    sector: Optional[str] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    thesis: Optional[str] = None
    notes: Optional[str] = None


class HoldingsResponse(BaseModel):
    """保有銘柄一覧レスポンス"""
    holdings: List[HoldingRecord]
    total: int
    total_value: Optional[float] = None


@router.get("", response_model=HoldingsResponse)
async def get_holdings(
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    保有銘柄一覧を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("holdings").select("*")

        if user_id:
            query = query.eq("user_id", user_id)

        result = query.order("ticker").execute()

        holdings = [HoldingRecord(**row) for row in result.data]

        # 合計評価額（avg_price * shares）
        total_value = sum(h.shares * h.avg_price for h in holdings)

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
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    特定銘柄の保有情報を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("holdings").select("*").eq("ticker", ticker.upper())

        if user_id:
            query = query.eq("user_id", user_id)

        result = query.limit(1).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Holding {ticker} not found")

        return HoldingRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=HoldingRecord)
async def create_holding(
    holding: HoldingCreate,
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    保有銘柄を追加
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        data = {
            "ticker": holding.ticker.upper(),
            "shares": holding.shares,
            "avg_price": holding.avg_price,
            "entry_date": holding.entry_date,
            "account_type": holding.account_type,
            "sector": holding.sector,
            "regime_at_entry": holding.regime_at_entry,
            "rs_at_entry": holding.rs_at_entry,
            "fx_rate": holding.fx_rate,
            "target_price": holding.target_price,
            "stop_loss": holding.stop_loss,
            "thesis": holding.thesis,
            "notes": holding.notes,
        }

        if user_id:
            data["user_id"] = user_id

        result = supabase.table("holdings").insert(data).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create holding")

        return HoldingRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{holding_id}", response_model=HoldingRecord)
async def update_holding(
    holding_id: str,
    holding: HoldingUpdate,
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
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
        if holding.avg_price is not None:
            update_data["avg_price"] = holding.avg_price
        if holding.account_type is not None:
            update_data["account_type"] = holding.account_type
        if holding.sector is not None:
            update_data["sector"] = holding.sector
        if holding.target_price is not None:
            update_data["target_price"] = holding.target_price
        if holding.stop_loss is not None:
            update_data["stop_loss"] = holding.stop_loss
        if holding.thesis is not None:
            update_data["thesis"] = holding.thesis
        if holding.notes is not None:
            update_data["notes"] = holding.notes

        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")

        query = supabase.table("holdings").update(update_data).eq("id", holding_id)

        if user_id:
            query = query.eq("user_id", user_id)

        result = query.execute()

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Holding not found")

        return HoldingRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{holding_id}")
async def delete_holding(
    holding_id: str,
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    保有銘柄を削除
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("holdings").delete().eq("id", holding_id)

        if user_id:
            query = query.eq("user_id", user_id)

        result = query.execute()

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Holding not found")

        return {"status": "deleted", "holding_id": holding_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{holding_id}/add-shares")
async def add_shares(
    holding_id: str,
    shares: float = Query(..., description="追加株数"),
    price: float = Query(..., description="取得単価"),
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    既存の保有銘柄に買い増し（平均取得単価を再計算）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 現在の保有を取得
        query = supabase.table("holdings").select("*").eq("id", holding_id)

        if user_id:
            query = query.eq("user_id", user_id)

        current = query.single().execute()

        if not current.data:
            raise HTTPException(status_code=404, detail=f"Holding not found")

        old_shares = current.data["shares"]
        old_price = current.data["avg_price"]

        # 平均取得単価を再計算
        new_shares = old_shares + shares
        new_avg_price = ((old_shares * old_price) + (shares * price)) / new_shares

        # 更新
        result = (
            supabase.table("holdings")
            .update({"shares": new_shares, "avg_price": new_avg_price})
            .eq("id", holding_id)
            .execute()
        )

        return {
            "status": "updated",
            "holding_id": holding_id,
            "old_shares": old_shares,
            "new_shares": new_shares,
            "old_avg_price": old_price,
            "new_avg_price": round(new_avg_price, 4),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
