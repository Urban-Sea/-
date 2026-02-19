"""
/api/trades - 取引履歴CRUD
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import main

router = APIRouter()


class TradeRecord(BaseModel):
    """取引レコード"""
    id: Optional[int] = None
    user_id: str
    ticker: str
    trade_type: str  # "BUY" or "SELL"
    shares: float
    price: float
    entry_date: str
    exit_date: Optional[str] = None
    exit_price: Optional[float] = None
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    bos_grade: Optional[str] = None
    exit_reason: Optional[str] = None
    notes: Optional[str] = None
    is_closed: bool = False
    created_at: Optional[str] = None


class TradeCreate(BaseModel):
    """取引作成"""
    ticker: str
    trade_type: str = "BUY"
    shares: float
    price: float
    entry_date: str
    bos_grade: Optional[str] = None
    notes: Optional[str] = None


class TradeClose(BaseModel):
    """取引クローズ"""
    exit_date: str
    exit_price: float
    exit_reason: Optional[str] = None
    notes: Optional[str] = None


class TradesResponse(BaseModel):
    """取引一覧レスポンス"""
    trades: List[TradeRecord]
    total: int
    total_pnl: Optional[float] = None
    win_rate: Optional[float] = None


class TradeStats(BaseModel):
    """取引統計"""
    total_trades: int
    closed_trades: int
    active_trades: int
    total_pnl: float
    win_count: int
    loss_count: int
    win_rate: float
    avg_win: float
    avg_loss: float
    profit_factor: float


@router.get("", response_model=TradesResponse)
async def get_trades(
    user_id: str = Query(..., description="ユーザーID"),
    status: Optional[str] = Query(None, description="active/closed/all"),
    limit: int = Query(100, ge=1, le=500, description="取得件数"),
):
    """
    取引履歴を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = (
            supabase.table("trades")
            .select("*")
            .eq("user_id", user_id)
        )

        if status == "active":
            query = query.eq("is_closed", False)
        elif status == "closed":
            query = query.eq("is_closed", True)

        result = query.order("entry_date", desc=True).limit(limit).execute()

        trades = [TradeRecord(**row) for row in result.data]

        # 統計計算
        closed_trades = [t for t in trades if t.is_closed and t.pnl is not None]
        total_pnl = sum(t.pnl for t in closed_trades) if closed_trades else 0
        win_count = sum(1 for t in closed_trades if t.pnl and t.pnl > 0)
        win_rate = (win_count / len(closed_trades) * 100) if closed_trades else 0

        return TradesResponse(
            trades=trades,
            total=len(trades),
            total_pnl=total_pnl,
            win_rate=win_rate
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=TradeStats)
async def get_trade_stats(
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    取引統計を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("trades")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        )

        trades = result.data
        closed = [t for t in trades if t.get("is_closed") and t.get("pnl") is not None]
        active = [t for t in trades if not t.get("is_closed")]

        wins = [t for t in closed if t["pnl"] > 0]
        losses = [t for t in closed if t["pnl"] <= 0]

        total_pnl = sum(t["pnl"] for t in closed) if closed else 0
        win_count = len(wins)
        loss_count = len(losses)
        win_rate = (win_count / len(closed) * 100) if closed else 0

        avg_win = (sum(t["pnl"] for t in wins) / len(wins)) if wins else 0
        avg_loss = (sum(t["pnl"] for t in losses) / len(losses)) if losses else 0

        gross_profit = sum(t["pnl"] for t in wins) if wins else 0
        gross_loss = abs(sum(t["pnl"] for t in losses)) if losses else 1
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0

        return TradeStats(
            total_trades=len(trades),
            closed_trades=len(closed),
            active_trades=len(active),
            total_pnl=total_pnl,
            win_count=win_count,
            loss_count=loss_count,
            win_rate=win_rate,
            avg_win=avg_win,
            avg_loss=avg_loss,
            profit_factor=profit_factor
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{trade_id}", response_model=TradeRecord)
async def get_trade(
    trade_id: int,
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    特定の取引を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("trades")
            .select("*")
            .eq("id", trade_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

        return TradeRecord(**result.data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=TradeRecord)
async def create_trade(
    trade: TradeCreate,
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    新規取引を記録
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        data = {
            "user_id": user_id,
            "ticker": trade.ticker.upper(),
            "trade_type": trade.trade_type.upper(),
            "shares": trade.shares,
            "price": trade.price,
            "entry_date": trade.entry_date,
            "bos_grade": trade.bos_grade,
            "notes": trade.notes,
            "is_closed": False,
        }

        result = supabase.table("trades").insert(data).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create trade")

        return TradeRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{trade_id}/close", response_model=TradeRecord)
async def close_trade(
    trade_id: int,
    close_data: TradeClose,
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    取引をクローズ（決済）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 現在の取引を取得
        current = (
            supabase.table("trades")
            .select("*")
            .eq("id", trade_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )

        if not current.data:
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

        if current.data.get("is_closed"):
            raise HTTPException(status_code=400, detail="Trade is already closed")

        entry_price = current.data["price"]
        shares = current.data["shares"]
        trade_type = current.data.get("trade_type", "BUY")

        # PnL計算
        if trade_type == "BUY":
            pnl = (close_data.exit_price - entry_price) * shares
            pnl_pct = (close_data.exit_price / entry_price - 1) * 100
        else:  # SELL (short)
            pnl = (entry_price - close_data.exit_price) * shares
            pnl_pct = (entry_price / close_data.exit_price - 1) * 100

        update_data = {
            "exit_date": close_data.exit_date,
            "exit_price": close_data.exit_price,
            "exit_reason": close_data.exit_reason,
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 2),
            "is_closed": True,
        }

        if close_data.notes:
            update_data["notes"] = close_data.notes

        result = (
            supabase.table("trades")
            .update(update_data)
            .eq("id", trade_id)
            .eq("user_id", user_id)
            .execute()
        )

        return TradeRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{trade_id}")
async def delete_trade(
    trade_id: int,
    user_id: str = Query(..., description="ユーザーID"),
):
    """
    取引を削除
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("trades")
            .delete()
            .eq("id", trade_id)
            .eq("user_id", user_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

        return {"status": "deleted", "trade_id": trade_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
