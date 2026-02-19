"""
/api/trades - 取引履歴CRUD
設計ドキュメント準拠（BUY/SELLは別レコード）
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import main

router = APIRouter()


class TradeRecord(BaseModel):
    """取引レコード"""
    id: Optional[str] = None
    user_id: Optional[str] = None
    holding_id: Optional[str] = None
    ticker: str
    action: str  # "BUY" or "SELL"
    shares: float
    price: float
    fees: Optional[float] = 0
    trade_date: str
    account_type: Optional[str] = None
    regime: Optional[str] = None  # 取引時のMarket Regime
    rs_trend: Optional[str] = None  # 取引時のRS Trend
    reason: Optional[str] = None  # entry_reason / exit_reason
    lessons_learned: Optional[str] = None
    profit_loss: Optional[float] = None  # SELL時
    profit_loss_pct: Optional[float] = None  # SELL時
    holding_days: Optional[int] = None  # SELL時
    created_at: Optional[str] = None


class TradeCreate(BaseModel):
    """取引作成"""
    ticker: str
    action: str  # "BUY" or "SELL"
    shares: float
    price: float
    fees: Optional[float] = 0
    trade_date: str
    account_type: Optional[str] = None
    regime: Optional[str] = None
    rs_trend: Optional[str] = None
    reason: Optional[str] = None
    holding_id: Optional[str] = None
    # SELL時のみ
    profit_loss: Optional[float] = None
    profit_loss_pct: Optional[float] = None
    holding_days: Optional[int] = None
    lessons_learned: Optional[str] = None


class TradesResponse(BaseModel):
    """取引一覧レスポンス"""
    trades: List[TradeRecord]
    total: int


class TradeStats(BaseModel):
    """取引統計"""
    total_trades: int
    buy_count: int
    sell_count: int
    total_profit_loss: float
    win_count: int
    loss_count: int
    win_rate: float
    avg_profit: float
    avg_loss: float
    profit_factor: float


@router.get("", response_model=TradesResponse)
async def get_trades(
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
    ticker: Optional[str] = Query(None, description="銘柄でフィルタ"),
    action: Optional[str] = Query(None, description="BUY/SELLでフィルタ"),
    limit: int = Query(100, ge=1, le=500, description="取得件数"),
):
    """
    取引履歴を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("trades").select("*")

        if user_id:
            query = query.eq("user_id", user_id)

        if ticker:
            query = query.eq("ticker", ticker.upper())

        if action:
            query = query.eq("action", action.upper())

        result = query.order("trade_date", desc=True).limit(limit).execute()

        trades = [TradeRecord(**row) for row in result.data]

        return TradesResponse(
            trades=trades,
            total=len(trades)
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=TradeStats)
async def get_trade_stats(
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    取引統計を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("trades").select("*")

        if user_id:
            query = query.eq("user_id", user_id)

        result = query.execute()
        trades = result.data

        buys = [t for t in trades if t.get("action") == "BUY"]
        sells = [t for t in trades if t.get("action") == "SELL"]

        # 利益のあるSELL
        wins = [t for t in sells if t.get("profit_loss") and t["profit_loss"] > 0]
        losses = [t for t in sells if t.get("profit_loss") and t["profit_loss"] <= 0]

        total_profit_loss = sum(t.get("profit_loss", 0) or 0 for t in sells)
        win_count = len(wins)
        loss_count = len(losses)
        win_rate = (win_count / len(sells) * 100) if sells else 0

        avg_profit = (sum(t["profit_loss"] for t in wins) / len(wins)) if wins else 0
        avg_loss = (sum(t["profit_loss"] for t in losses) / len(losses)) if losses else 0

        gross_profit = sum(t["profit_loss"] for t in wins) if wins else 0
        gross_loss = abs(sum(t["profit_loss"] for t in losses)) if losses else 1
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0

        return TradeStats(
            total_trades=len(trades),
            buy_count=len(buys),
            sell_count=len(sells),
            total_profit_loss=total_profit_loss,
            win_count=win_count,
            loss_count=loss_count,
            win_rate=win_rate,
            avg_profit=avg_profit,
            avg_loss=avg_loss,
            profit_factor=profit_factor
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{trade_id}", response_model=TradeRecord)
async def get_trade(
    trade_id: str,
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    特定の取引を取得
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("trades").select("*").eq("id", trade_id)

        if user_id:
            query = query.eq("user_id", user_id)

        result = query.single().execute()

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
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    新規取引を記録（BUYまたはSELL）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        data = {
            "ticker": trade.ticker.upper(),
            "action": trade.action.upper(),
            "shares": trade.shares,
            "price": trade.price,
            "fees": trade.fees,
            "trade_date": trade.trade_date,
            "account_type": trade.account_type,
            "regime": trade.regime,
            "rs_trend": trade.rs_trend,
            "reason": trade.reason,
            "holding_id": trade.holding_id,
        }

        # SELL時は損益情報も含める
        if trade.action.upper() == "SELL":
            data["profit_loss"] = trade.profit_loss
            data["profit_loss_pct"] = trade.profit_loss_pct
            data["holding_days"] = trade.holding_days
            data["lessons_learned"] = trade.lessons_learned

        if user_id:
            data["user_id"] = user_id

        result = supabase.table("trades").insert(data).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create trade")

        return TradeRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sell-from-holding")
async def sell_from_holding(
    holding_id: str = Query(..., description="保有銘柄ID"),
    shares: float = Query(..., description="売却株数"),
    price: float = Query(..., description="売却単価"),
    trade_date: str = Query(..., description="売却日"),
    fees: float = Query(0, description="手数料"),
    reason: Optional[str] = Query(None, description="売却理由"),
    lessons_learned: Optional[str] = Query(None, description="学び"),
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    保有銘柄から売却（損益自動計算）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 保有銘柄を取得
        query = supabase.table("holdings").select("*").eq("id", holding_id)

        if user_id:
            query = query.eq("user_id", user_id)

        holding = query.single().execute()

        if not holding.data:
            raise HTTPException(status_code=404, detail="Holding not found")

        h = holding.data
        ticker = h["ticker"]
        avg_price = h["avg_price"]
        entry_date = h.get("entry_date")

        # 損益計算
        profit_loss = (price - avg_price) * shares - fees
        profit_loss_pct = ((price / avg_price) - 1) * 100 if avg_price else 0

        # 保有日数計算
        holding_days = None
        if entry_date and trade_date:
            from datetime import datetime
            try:
                entry_dt = datetime.strptime(entry_date, "%Y-%m-%d")
                trade_dt = datetime.strptime(trade_date, "%Y-%m-%d")
                holding_days = (trade_dt - entry_dt).days
            except ValueError:
                pass

        # SELL取引を記録
        trade_data = {
            "ticker": ticker,
            "action": "SELL",
            "shares": shares,
            "price": price,
            "fees": fees,
            "trade_date": trade_date,
            "holding_id": holding_id,
            "account_type": h.get("account_type"),
            "reason": reason,
            "lessons_learned": lessons_learned,
            "profit_loss": round(profit_loss, 2),
            "profit_loss_pct": round(profit_loss_pct, 2),
            "holding_days": holding_days,
        }

        if user_id:
            trade_data["user_id"] = user_id

        trade_result = supabase.table("trades").insert(trade_data).execute()

        # 保有株数を減らす（全売却の場合は削除）
        new_shares = h["shares"] - shares

        if new_shares <= 0:
            # 全売却 → 保有を削除
            supabase.table("holdings").delete().eq("id", holding_id).execute()
            holding_status = "deleted"
        else:
            # 部分売却 → 株数更新
            supabase.table("holdings").update({"shares": new_shares}).eq("id", holding_id).execute()
            holding_status = "updated"

        return {
            "status": "success",
            "trade": trade_result.data[0] if trade_result.data else None,
            "holding_status": holding_status,
            "profit_loss": round(profit_loss, 2),
            "profit_loss_pct": round(profit_loss_pct, 2),
            "holding_days": holding_days,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{trade_id}")
async def delete_trade(
    trade_id: str,
    user_id: Optional[str] = Query(None, description="ユーザーID（UUID）"),
):
    """
    取引を削除
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("trades").delete().eq("id", trade_id)

        if user_id:
            query = query.eq("user_id", user_id)

        result = query.execute()

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

        return {"status": "deleted", "trade_id": trade_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
