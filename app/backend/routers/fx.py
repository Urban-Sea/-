"""
/api/fx - 為替レートAPI
軽量HTTP経由でリアルタイムUSD/JPYレート取得
"""
import logging
import time
import urllib.request
import json
from fastapi import APIRouter, Depends, HTTPException
from auth import require_proxy

router = APIRouter(dependencies=[Depends(require_proxy)])
logger = logging.getLogger(__name__)

# In-memory cache (5 min TTL)
_cache: dict = {"rate": None, "ts": 0}
_CACHE_TTL = 300  # 5 minutes

# Yahoo Finance v8 chart API — lightweight, no library dependency
_YF_URL = "https://query1.finance.yahoo.com/v8/finance/chart/JPY=X?range=1d&interval=1d"


def _fetch_rate() -> float:
    """Yahoo Finance chart API から USD/JPY を取得 (軽量)"""
    req = urllib.request.Request(_YF_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read())
    price = data["chart"]["result"][0]["meta"]["regularMarketPrice"]
    return round(float(price), 2)


@router.get("/usdjpy")
async def get_usdjpy():
    """
    USD/JPYリアルタイムレートを返す。
    Yahoo Finance chart API経由、5分間キャッシュ。
    """
    now = time.time()
    if _cache["rate"] and (now - _cache["ts"]) < _CACHE_TTL:
        return {"rate": _cache["rate"], "cached": True}

    try:
        rate = _fetch_rate()
        _cache["rate"] = rate
        _cache["ts"] = now
        return {"rate": rate, "cached": False}
    except Exception as e:
        logger.exception("Failed to fetch USD/JPY")
        if _cache["rate"]:
            return {"rate": _cache["rate"], "cached": True, "stale": True}
        raise HTTPException(status_code=503, detail="Failed to fetch USD/JPY rate")
