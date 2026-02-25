"""
/api/holdings - 保有銘柄CRUD
設計ドキュメント準拠
"""
import re
import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, field_validator
from typing import Optional, List
import main
from auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter()

# --- 入力バリデーション ---
_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")
_ACCOUNT_TYPES = {"nisa", "tokutei"}


def _validate_ticker(v: str) -> str:
    v = v.upper()
    if not _TICKER_RE.match(v):
        raise ValueError("Invalid ticker format")
    return v


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

    @field_validator("ticker")
    @classmethod
    def validate_ticker(cls, v: str) -> str:
        return _validate_ticker(v)

    @field_validator("shares")
    @classmethod
    def validate_shares(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("shares must be positive")
        return v

    @field_validator("avg_price")
    @classmethod
    def validate_price(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("avg_price must be positive")
        return v


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
    user_email: str = Depends(require_auth),
):
    """
    保有銘柄一覧を取得（認証済みユーザーのデータのみ）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        query = supabase.table("holdings").select("*").eq("user_id", user_email)

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
        logger.exception("Holdings API error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@router.get("/{ticker}", response_model=HoldingRecord)
async def get_holding(
    ticker: str,
    user_email: str = Depends(require_auth),
):
    """
    特定銘柄の保有情報を取得（認証済みユーザーのデータのみ）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    ticker = _validate_ticker(ticker)

    try:
        result = (
            supabase.table("holdings")
            .select("*")
            .eq("ticker", ticker)
            .eq("user_id", user_email)
            .limit(1)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail=f"Holding {ticker} not found")

        return HoldingRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Holdings API error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@router.post("", response_model=HoldingRecord)
async def create_holding(
    holding: HoldingCreate,
    user_email: str = Depends(require_auth),
):
    """
    保有銘柄を追加（認証済みユーザーに紐付け）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        data = {
            "user_id": user_email,
            "ticker": holding.ticker,
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

        result = supabase.table("holdings").insert(data).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create holding")

        return HoldingRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Holdings API error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@router.put("/{holding_id}", response_model=HoldingRecord)
async def update_holding(
    holding_id: str,
    holding: HoldingUpdate,
    user_email: str = Depends(require_auth),
):
    """
    保有銘柄を更新（所有権検証あり）
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

        # 所有権を検証しつつ更新
        result = (
            supabase.table("holdings")
            .update(update_data)
            .eq("id", holding_id)
            .eq("user_id", user_email)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Holding not found")

        return HoldingRecord(**result.data[0])

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Holdings API error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@router.delete("/{holding_id}")
async def delete_holding(
    holding_id: str,
    user_email: str = Depends(require_auth),
):
    """
    保有銘柄を削除（所有権検証あり）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("holdings")
            .delete()
            .eq("id", holding_id)
            .eq("user_id", user_email)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Holding not found")

        return {"status": "deleted", "holding_id": holding_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Holdings API error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@router.post("/{holding_id}/add-shares")
async def add_shares(
    holding_id: str,
    shares: float = Query(..., gt=0, description="追加株数"),
    price: float = Query(..., gt=0, description="取得単価"),
    user_email: str = Depends(require_auth),
):
    """
    既存の保有銘柄に買い増し（平均取得単価を再計算、所有権検証あり）
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        # 所有権を検証しつつ取得
        current = (
            supabase.table("holdings")
            .select("*")
            .eq("id", holding_id)
            .eq("user_id", user_email)
            .single()
            .execute()
        )

        if not current.data:
            raise HTTPException(status_code=404, detail="Holding not found")

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
            .eq("user_id", user_email)
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
        logger.exception("Holdings API error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")
