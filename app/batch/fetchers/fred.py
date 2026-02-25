"""
FRED API フェッチャー

6テーブル分のデータを FRED REST API から取得:
  - fed_balance_sheet  (TOTRESNS, RRPONTSYD, WTREGEN, WALCL)
  - interest_rates     (FEDFUNDS, DGS2, DGS10)
  - credit_spreads     (BAMLH0A0HYM2, BAMLC0A0CM)
  - mmf_assets         (MMMFFAQ027S)
  - weekly_claims      (ICSA, CCSA, IC4WSA)
  - economic_indicators (PAYEMS, UNRATE, U6RATE, CES0500000003, CIVPART, JTSJOL)
"""

import logging
from collections import defaultdict
from typing import Dict, List, Optional

import requests

from ..config import FRED_API_KEY, FRED_SERIES, FRED_EMPLOYMENT_SERIES, FRED_CONSUMER_SERIES

logger = logging.getLogger("batch.fetchers.fred")

FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"


def _fetch_series(series_id: str, start: str, end: str) -> List[dict]:
    """FRED 系列を取得。返値は [{"date": "YYYY-MM-DD", "value": float}, ...]"""
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": start,
        "observation_end": end,
    }
    resp = requests.get(FRED_BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    results = []
    for obs in data.get("observations", []):
        val = obs.get("value")
        if val is None or val == ".":
            continue
        results.append({"date": obs["date"], "value": float(val)})

    logger.info(f"  FRED {series_id}: {len(results)} observations")
    return results


def _merge_by_date(series_data: Dict[str, List[dict]]) -> Dict[str, dict]:
    """複数系列を日付キーで結合。{date: {key1: val, key2: val, ...}}"""
    merged: Dict[str, dict] = defaultdict(dict)
    for key, observations in series_data.items():
        for obs in observations:
            merged[obs["date"]][key] = obs["value"]
    return merged


# ===== テーブル別フェッチ =====

def fetch_fed_balance_sheet(start: str, end: str) -> List[dict]:
    """FRBバランスシート 4系列 → fed_balance_sheet 行リスト"""
    logger.info("Fetching fed_balance_sheet...")
    series_map = {
        "reserves": FRED_SERIES["reserves"],
        "rrp": FRED_SERIES["rrp"],
        "tga": FRED_SERIES["tga"],
        "soma_assets": FRED_SERIES["soma"],
    }

    raw = {}
    for key, sid in series_map.items():
        raw[key] = _fetch_series(sid, start, end)

    merged = _merge_by_date(raw)

    rows = []
    for date in sorted(merged):
        vals = merged[date]
        row = {"date": date}
        for key in series_map:
            v = vals.get(key)
            # FRED は百万ドル → 十億ドルに変換
            row[key] = round(v / 1000, 4) if v is not None else None
        rows.append(row)

    logger.info(f"  fed_balance_sheet: {len(rows)} rows prepared")
    return rows


def fetch_interest_rates(start: str, end: str) -> List[dict]:
    """金利 3系列 → interest_rates 行リスト"""
    logger.info("Fetching interest_rates...")
    series_map = {
        "fed_funds": FRED_SERIES["fed_funds"],
        "treasury_2y": FRED_SERIES["treasury_2y"],
        "treasury_10y": FRED_SERIES["treasury_10y"],
    }

    raw = {}
    for key, sid in series_map.items():
        raw[key] = _fetch_series(sid, start, end)

    merged = _merge_by_date(raw)

    rows = []
    for date in sorted(merged):
        vals = merged[date]
        row = {"date": date}
        for key in series_map:
            row[key] = vals.get(key)
        rows.append(row)

    logger.info(f"  interest_rates: {len(rows)} rows prepared")
    return rows


def fetch_credit_spreads(start: str, end: str) -> List[dict]:
    """クレジットスプレッド 2系列 → credit_spreads 行リスト"""
    logger.info("Fetching credit_spreads...")
    series_map = {
        "hy_spread": FRED_SERIES["hy_spread"],
        "ig_spread": FRED_SERIES["ig_spread"],
    }

    raw = {}
    for key, sid in series_map.items():
        raw[key] = _fetch_series(sid, start, end)

    merged = _merge_by_date(raw)

    rows = []
    for date in sorted(merged):
        vals = merged[date]
        row = {"date": date}
        for key in series_map:
            row[key] = vals.get(key)
        rows.append(row)

    logger.info(f"  credit_spreads: {len(rows)} rows prepared")
    return rows


def fetch_mmf_data(start: str, end: str) -> List[dict]:
    """MMF 四半期データ → mmf_assets 行リスト（change_3m 自動計算）"""
    logger.info("Fetching mmf_assets...")
    obs = _fetch_series(FRED_SERIES["mmf"], start, end)

    rows = []
    for i, o in enumerate(obs):
        change_3m = None
        if i > 0:
            prev = obs[i - 1]["value"]
            if prev and prev != 0:
                change_3m = round(((o["value"] - prev) / prev) * 100, 4)
        rows.append({
            "date": o["date"],
            "total_assets": o["value"],
            "change_3m": change_3m,
        })

    logger.info(f"  mmf_assets: {len(rows)} rows prepared")
    return rows


# ===== 米国景気（雇用）フェッチ =====

def fetch_weekly_claims(start: str, end: str) -> List[dict]:
    """失業保険申請 3系列 → weekly_claims 行リスト"""
    logger.info("Fetching weekly_claims...")
    series_map = {
        "initial_claims": FRED_EMPLOYMENT_SERIES["initial_claims"],
        "continued_claims": FRED_EMPLOYMENT_SERIES["continued_claims"],
        "initial_claims_4w_avg": FRED_EMPLOYMENT_SERIES["initial_claims_4w_avg"],
    }

    raw = {}
    for key, sid in series_map.items():
        raw[key] = _fetch_series(sid, start, end)

    merged = _merge_by_date(raw)

    rows = []
    for date in sorted(merged):
        vals = merged[date]
        # 少なくとも initial_claims がある行のみ
        if vals.get("initial_claims") is None:
            continue
        rows.append({
            "week_ending": date,
            "initial_claims": int(vals["initial_claims"]),
            "continued_claims": int(vals["continued_claims"]) if vals.get("continued_claims") is not None else None,
            "initial_claims_4w_avg": int(vals["initial_claims_4w_avg"]) if vals.get("initial_claims_4w_avg") is not None else None,
        })

    logger.info(f"  weekly_claims: {len(rows)} rows prepared")
    return rows


def fetch_employment_indicators(start: str, end: str) -> List[dict]:
    """雇用統計 月次系列 → economic_indicators 行リスト

    NFP 行: PAYEMS, UNRATE, U6RATE, CES0500000003, CIVPART を月ごとに統合
    JOLTS 行: JTSJOL を別行として生成
    """
    logger.info("Fetching employment indicators...")

    # --- NFP 関連 ---
    nfp_series = {
        "nfp": FRED_EMPLOYMENT_SERIES["nfp"],
        "u3_rate": FRED_EMPLOYMENT_SERIES["u3_rate"],
        "u6_rate": FRED_EMPLOYMENT_SERIES["u6_rate"],
        "avg_hourly_earnings": FRED_EMPLOYMENT_SERIES["avg_hourly_earnings"],
        "labor_force_participation": FRED_EMPLOYMENT_SERIES["labor_force_participation"],
    }

    raw = {}
    for key, sid in nfp_series.items():
        raw[key] = _fetch_series(sid, start, end)

    merged = _merge_by_date(raw)

    # nfp_change (前月差分) と wage_mom (前月比%) を計算するためソート
    sorted_dates = sorted(merged.keys())
    prev_nfp: Optional[float] = None
    prev_wage: Optional[float] = None

    nfp_rows: List[dict] = []
    for date in sorted_dates:
        vals = merged[date]
        nfp_val = vals.get("nfp")

        # nfp_change 計算
        nfp_change = None
        if nfp_val is not None and prev_nfp is not None:
            nfp_change = int(nfp_val - prev_nfp)
        if nfp_val is not None:
            prev_nfp = nfp_val

        # wage_mom 計算
        wage = vals.get("avg_hourly_earnings")
        wage_mom = None
        if wage is not None and prev_wage is not None and prev_wage != 0:
            wage_mom = round(((wage - prev_wage) / prev_wage) * 100, 4)
        if wage is not None:
            prev_wage = wage

        # 少なくとも1つの値がある行のみ
        if not any(vals.get(k) is not None for k in nfp_series):
            continue

        nfp_rows.append({
            "indicator": "NFP",
            "reference_period": date,
            "current_value": nfp_val,
            "nfp_change": nfp_change,
            "u3_rate": vals.get("u3_rate"),
            "u6_rate": vals.get("u6_rate"),
            "avg_hourly_earnings": wage,
            "wage_mom": wage_mom,
            "labor_force_participation": vals.get("labor_force_participation"),
        })

    logger.info(f"  NFP indicators: {len(nfp_rows)} months prepared")

    # --- JOLTS ---
    jolts_obs = _fetch_series(FRED_EMPLOYMENT_SERIES["jolts_openings"], start, end)
    jolts_rows = [
        {
            "indicator": "JOLTS",
            "reference_period": o["date"],
            "current_value": o["value"],
        }
        for o in jolts_obs
    ]
    logger.info(f"  JOLTS indicators: {len(jolts_rows)} months prepared")

    all_rows = nfp_rows + jolts_rows
    logger.info(f"  economic_indicators total: {len(all_rows)} rows prepared")
    return all_rows


def fetch_consumer_indicators(start: str, end: str) -> List[dict]:
    """消費者・構造系列 → economic_indicators 行リスト

    各FRED系列を独立した indicator 行として生成:
    - W875RX1  → indicator="W875RX1",  current_value=指数値
    - UMCSENT  → indicator="UMCSENT",  current_value=指数値
    - DRCCLACBS → indicator="DRCCLACBS", current_value=延滞率%
    - UNEMPLOY → indicator="UNEMPLOY", current_value=失業者数(千人)
    """
    logger.info("Fetching consumer/structure indicators...")
    rows: List[dict] = []

    for key, series_id in FRED_CONSUMER_SERIES.items():
        obs = _fetch_series(series_id, start, end)
        for o in obs:
            rows.append({
                "indicator": series_id,
                "reference_period": o["date"],
                "current_value": o["value"],
            })
        logger.info(f"  {series_id}: {len(obs)} observations")

    logger.info(f"  consumer_indicators total: {len(rows)} rows prepared")
    return rows
