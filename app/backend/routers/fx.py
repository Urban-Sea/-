"""
/api/fx - 為替レートAPI
リアルタイムUSD/JPYレート取得
"""
import logging
import time
from fastapi import APIRouter, HTTPException

import yfinance as yf

router = APIRouter()
logger = logging.getLogger(__name__)

# Simple in-memory cache (5 min TTL)
_cache: dict = {"rate": None, "ts": 0}
_CACHE_TTL = 300  # 5 minutes


@router.get("/usdjpy")
async def get_usdjpy():
    """
    USD/JPYリアルタイムレートを返す。
    yfinance経由で取得し、5分間キャッシュ。
    """
    now = time.time()
    if _cache["rate"] and (now - _cache["ts"]) < _CACHE_TTL:
        return {"rate": _cache["rate"], "cached": True}

    try:
        ticker = yf.Ticker("JPY=X")
        info = ticker.fast_info
        rate = float(info.last_price)
        _cache["rate"] = round(rate, 2)
        _cache["ts"] = now
        return {"rate": _cache["rate"], "cached": False}
    except Exception as e:
        logger.exception("Failed to fetch USD/JPY")
        # Return cached value if available
        if _cache["rate"]:
            return {"rate": _cache["rate"], "cached": True, "stale": True}
        raise HTTPException(status_code=503, detail=f"Failed to fetch USD/JPY: {e}")
