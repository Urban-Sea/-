"""
/api/trades - 取引履歴CRUD
設計ドキュメント準拠（BUY/SELLは別レコード）
"""
import re
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, field_validator
from typing import Optional, List
import main
from auth import require_auth

router = APIRouter()

# --- 入力バリデーション ---
_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")
_ACTIONS = {"BUY", "SELL"}


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

    @field_validator("ticker")
    @classmethod
    def validate_ticker(cls, v: str) -> str:
        v = v.upper()
        if not _TICKER_RE.match(v):
            raise ValueError("Invalid ticker format")
        return v

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        v = v.upper()
        if v not in _ACTIONS:
            raise ValueError("action must be BUY or SELL")
        return v

    @field_validator("shares")
    @classmethod
    def validate_shares(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("shares must be positive")
        return v

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("price must be positive")
        return v


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
    user_email: str = Depends(require_auth),
    ticker: Optional[str] = Query(None, description="銘柄でフィルタ"),
    action: Optional[str] = Query(None, description="BUY/SELLでフィルタ"),
    limit: int = Query(100, ge=1, le=500, description="取得件数"),
):
    """
    取引履歴を取得（認証済みユーザーのデータのみ）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("trades").select("*").eq("user_id", user_email)

        if ticker:
            t = ticker.upper()
            if not _TICKER_RE.match(t):
                raise HTTPException(status_code=400, detail="Invalid ticker format")
            query = query.eq("ticker", t)

        if action:
            a = action.upper()
            if a not in _ACTIONS:
                raise HTTPException(status_code=400, detail="action must be BUY or SELL")
            query = query.eq("action", a)

        result = query.order("trade_date", desc=True).limit(limit).execute()

        trades = [TradeRecord(**row) for row in result.data]

        return TradesResponse(
            trades=trades,
            total=len(trades)
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trades error: {type(e).__name__}: {e}")


@router.get("/stats", response_model=TradeStats)
async def get_trade_stats(
    user_email: str = Depends(require_auth),
):
    """
    取引統計を取得（認証済みユーザーのデータのみ）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("trades")
            .select("*")
            .eq("user_id", user_email)
            .execute()
        )
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
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{trade_id}", response_model=TradeRecord)
async def get_trade(
    trade_id: str,
    user_email: str = Depends(require_auth),
):
    """
    特定の取引を取得（所有権検証あり）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("trades")
            .select("*")
            .eq("id", trade_id)
            .eq("user_id", user_email)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

        return TradeRecord(**result.data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("", response_model=TradeRecord)
async def create_trade(
    trade: TradeCreate,
    user_email: str = Depends(require_auth),
):
    """
    新規取引を記録（認証済みユーザーに紐付け）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        data = {
            "user_id": user_email,
            "ticker": trade.ticker,
            "action": trade.action,
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
        if trade.action == "SELL":
            data["profit_loss"] = trade.profit_loss
            data["profit_loss_pct"] = trade.profit_loss_pct
            data["holding_days"] = trade.holding_days
            data["lessons_learned"] = trade.lessons_learned

        result = supabase.table("trades").insert(data).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create trade")

        return TradeRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/sell-from-holding")
async def sell_from_holding(
    holding_id: str = Query(..., description="保有銘柄ID"),
    shares: float = Query(..., gt=0, description="売却株数"),
    price: float = Query(..., gt=0, description="売却単価"),
    trade_date: str = Query(..., description="売却日"),
    fees: float = Query(0, ge=0, description="手数料"),
    reason: Optional[str] = Query(None, max_length=500, description="売却理由"),
    lessons_learned: Optional[str] = Query(None, max_length=500, description="学び"),
    user_email: str = Depends(require_auth),
):
    """
    保有銘柄から売却（損益自動計算、所有権検証あり）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 所有権を検証しつつ保有銘柄を取得
        holding = (
            supabase.table("holdings")
            .select("*")
            .eq("id", holding_id)
            .eq("user_id", user_email)
            .single()
            .execute()
        )

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
            "user_id": user_email,
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

        trade_result = supabase.table("trades").insert(trade_data).execute()

        # 保有株数を減らす（全売却の場合は削除）
        new_shares = h["shares"] - shares

        if new_shares <= 0:
            # 全売却 → 保有を削除（所有権検証付き）
            supabase.table("holdings").delete().eq("id", holding_id).eq("user_id", user_email).execute()
            holding_status = "deleted"
        else:
            # 部分売却 → 株数更新（所有権検証付き）
            supabase.table("holdings").update({"shares": new_shares}).eq("id", holding_id).eq("user_id", user_email).execute()
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
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{trade_id}")
async def delete_trade(
    trade_id: str,
    user_email: str = Depends(require_auth),
):
    """
    取引を削除（所有権検証あり）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("trades")
            .delete()
            .eq("id", trade_id)
            .eq("user_id", user_email)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

        return {"status": "deleted", "trade_id": trade_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
