"""
/api/market-state - 市場状態履歴
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import main
from auth import require_proxy, require_auth
from redis_cache import cache_get as _cache_get, cache_set as _cache_set

router = APIRouter(dependencies=[Depends(require_proxy)])

_MARKET_STATE_TTL = 86400  # 24時間 (layer_stress / market_state は月次集計)


class MarketStateRecord(BaseModel):
    """市場状態レコード"""
    id: Optional[int] = None
    date: str
    spy_regime: Optional[str] = None
    qqq_regime: Optional[str] = None
    btc_regime: Optional[str] = None
    overall_regime: Optional[str] = None
    layer1_stress: Optional[float] = None
    layer2_stress: Optional[float] = None
    layer3_stress: Optional[float] = None
    layer4_stress: Optional[float] = None
    overall_stress: Optional[float] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None


class MarketStateResponse(BaseModel):
    """市場状態一覧レスポンス"""
    records: List[MarketStateRecord]
    total: int


class LatestMarketState(BaseModel):
    """最新の市場状態"""
    date: str
    spy_regime: Optional[str] = None
    qqq_regime: Optional[str] = None
    btc_regime: Optional[str] = None
    overall_regime: Optional[str] = None
    stress_levels: dict
    updated_at: Optional[str] = None


@router.get("", response_model=MarketStateResponse)
async def get_market_state_history(
    limit: int = Query(30, ge=1, le=365, description="取得件数"),
    offset: int = Query(0, ge=0, description="オフセット"),
):
    """
    市場状態履歴を取得

    - デフォルトで直近30日分
    - 日付降順でソート
    """
    cache_key = f"market_state:history:{limit}:{offset}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return MarketStateResponse(**cached)

    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("market_state_history")
            .select("*")
            .order("date", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )

        records = [MarketStateRecord(**row) for row in result.data]

        # 総件数を取得
        count_result = (
            supabase.table("market_state_history")
            .select("id", count="exact")
            .execute()
        )
        total = count_result.count if count_result.count else len(records)

        response = MarketStateResponse(records=records, total=total)
        _cache_set(cache_key, response.model_dump(), ttl=_MARKET_STATE_TTL)
        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/latest", response_model=LatestMarketState)
async def get_latest_market_state():
    """
    最新の市場状態を取得
    """
    cache_key = "market_state:latest"
    cached = _cache_get(cache_key)
    if cached is not None:
        return LatestMarketState(**cached)

    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        result = (
            supabase.table("market_state_history")
            .select("*")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="No market state data found")

        row = result.data[0]

        response = LatestMarketState(
            date=row.get("date", ""),
            spy_regime=row.get("spy_regime"),
            qqq_regime=row.get("qqq_regime"),
            btc_regime=row.get("btc_regime"),
            overall_regime=row.get("overall_regime"),
            stress_levels={
                "layer1": row.get("layer1_stress"),
                "layer2": row.get("layer2_stress"),
                "layer3": row.get("layer3_stress"),
                "layer4": row.get("layer4_stress"),
                "overall": row.get("overall_stress"),
            },
            updated_at=row.get("created_at"),
        )
        _cache_set(cache_key, response.model_dump(), ttl=_MARKET_STATE_TTL)
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("", dependencies=[Depends(require_auth)])
async def add_market_state(record: MarketStateRecord):
    """
    市場状態を記録
    """
    supabase = main.get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    try:
        data = {
            "date": record.date,
            "spy_regime": record.spy_regime,
            "qqq_regime": record.qqq_regime,
            "btc_regime": record.btc_regime,
            "overall_regime": record.overall_regime,
            "layer1_stress": record.layer1_stress,
            "layer2_stress": record.layer2_stress,
            "layer3_stress": record.layer3_stress,
            "layer4_stress": record.layer4_stress,
            "overall_stress": record.overall_stress,
            "notes": record.notes,
        }

        result = supabase.table("market_state_history").insert(data).execute()

        return {"status": "success", "id": result.data[0].get("id") if result.data else None}

    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
