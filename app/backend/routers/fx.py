"""
/api/fx - 為替レートAPI
軽量HTTP経由でリアルタイムUSD/JPYレート取得
"""
import logging
import urllib.request
import json
from fastapi import APIRouter, Depends, HTTPException
from auth import require_proxy
from redis_cache import cache_get as _cache_get, cache_set as _cache_set

router = APIRouter(dependencies=[Depends(require_proxy)])
logger = logging.getLogger(__name__)

_FX_TTL = 300  # 5分

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
    cached = _cache_get("fx:usdjpy")
    if cached is not None:
        return {"rate": cached["rate"], "cached": True}

    try:
        rate = _fetch_rate()
        _cache_set("fx:usdjpy", {"rate": rate}, ttl=_FX_TTL)
        return {"rate": rate, "cached": False}
    except Exception as e:
        logger.exception("Failed to fetch USD/JPY")
        # Redis にスタールデータが残っている可能性
        stale = _cache_get("fx:usdjpy")
        if stale is not None:
            return {"rate": stale["rate"], "cached": True, "stale": True}
        raise HTTPException(status_code=503, detail="Failed to fetch USD/JPY rate")
