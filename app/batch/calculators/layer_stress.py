"""
Layer Stress / Market State バッチ計算

PostgreSQL の生データテーブルから月次の Layer Stress と Market State を計算し、
layer_stress_history / market_state_history に upsert する。

backtest-states エンドポイント（liquidity.py）と同じロジック。
"""

import json
import logging
import sys
from bisect import bisect_right
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

# backend の analysis モジュールをインポート
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "backend"))
from analysis.liquidity_score import (
    calculate_layer1_stress,
    calculate_layer2a_stress,
    calculate_layer2b_stress,
    calculate_credit_pressure,
    determine_market_state,
    detect_market_events,
    events_to_dict,
)

from ..config import get_conn
from ..db import upsert_layer_stress_history, upsert_market_state_history

logger = logging.getLogger("batch.calculators.layer_stress")


def _fetch_all(table: str, select: str, order_col: str = "date") -> List[dict]:
    """PostgreSQL から全行取得。date カラムは文字列に変換。"""
    import datetime as dt_mod
    from decimal import Decimal

    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute(f"SELECT {select} FROM {table} ORDER BY {order_col}")
        col_names = [desc[0] for desc in cur.description]
        rows = []
        for row_tuple in cur.fetchall():
            row = {}
            for name, val in zip(col_names, row_tuple):
                if isinstance(val, (dt_mod.date, dt_mod.datetime)):
                    val = val.strftime("%Y-%m-%d")
                elif isinstance(val, Decimal):
                    val = float(val)
                row[name] = val
            rows.append(row)
        return rows


def _get_monthly_dates(start: str, end: str) -> List[str]:
    """start〜end の月末日リストを返す。"""
    import calendar

    dates = []
    dt = datetime.strptime(start, "%Y-%m-%d").replace(day=1)
    end_dt = datetime.strptime(end, "%Y-%m-%d")

    while dt <= end_dt:
        last_day = calendar.monthrange(dt.year, dt.month)[1]
        month_end = dt.replace(day=last_day)
        if month_end <= end_dt:
            dates.append(month_end.strftime("%Y-%m-%d"))
        dt = (dt.replace(day=28) + timedelta(days=4)).replace(day=1)

    return dates


def _to_month_map(rows: List[dict], key_fields: List[str]) -> Dict[str, dict]:
    """各月の最終レコードをマップ化（YYYY-MM → {fields}）。"""
    m: Dict[str, dict] = {}
    for row in (rows or []):
        d = row.get("date", "")
        month_key = d[:7]  # YYYY-MM
        m[month_key] = {k: row.get(k) for k in key_fields}
        m[month_key]["date"] = d
    return m


def _lookup_le(sorted_dates: List[str], date_vals: Dict[str, float], target: str) -> Optional[float]:
    """sorted_dates から target 以前の最新値を bisect で引く。"""
    idx = bisect_right(sorted_dates, target)
    while idx > 0:
        idx -= 1
        val = date_vals.get(sorted_dates[idx])
        if val is not None:
            return val
    return None


def calculate_monthly_states(start_date: str = "2010-01-01", end_date: Optional[str] = None):
    """
    月次 Layer Stress + Market State を計算し PostgreSQL に upsert。

    1. 全8テーブルから一括 prefetch
    2. 月末日ごとにループ計算
    3. layer_stress_history + market_state_history に書き込み
    """
    if end_date is None:
        end_date = datetime.now().strftime("%Y-%m-%d")

    logger.info(f"Calculating monthly states: {start_date} → {end_date}")

    # ============================================================
    # 1. Prefetch 全データ（日付昇順）
    # ============================================================
    logger.info("Prefetching data from PostgreSQL...")

    fed_data = _fetch_all("fed_balance_sheet", "date,soma_assets,rrp,tga,reserves")
    margin_data = _fetch_all("margin_debt", "date,debit_balance,change_2y")
    bank_data = _fetch_all("bank_sector", "date,kre_52w_change")
    spreads_data = _fetch_all("credit_spreads", "date,hy_spread,ig_spread")
    rates_data = _fetch_all("interest_rates", "date,treasury_spread")
    indicators_data = _fetch_all("market_indicators", "date,vix,sp500,dxy")
    srf_data = _fetch_all("srf_usage", "date,amount")
    mmf_data = _fetch_all("mmf_assets", "date,change_3m")

    logger.info(f"Prefetch complete: fed={len(fed_data)}, mkt={len(indicators_data)}, "
                f"bank={len(bank_data)}, spreads={len(spreads_data)}")

    # ============================================================
    # 2. 月次マップ構築
    # ============================================================
    fed_map = _to_month_map(fed_data, ["soma_assets", "rrp", "tga", "reserves"])
    margin_map = _to_month_map(margin_data, ["debit_balance", "change_2y"])
    bank_map = _to_month_map(bank_data, ["kre_52w_change"])
    spreads_map = _to_month_map(spreads_data, ["hy_spread", "ig_spread"])
    rates_map = _to_month_map(rates_data, ["treasury_spread"])
    indicators_map = _to_month_map(indicators_data, ["vix", "sp500", "dxy"])
    mmf_map = _to_month_map(mmf_data, ["change_3m"])

    # SRF 月次集計
    srf_monthly: Dict[str, dict] = {}
    for row in srf_data:
        d = row.get("date", "")
        mk = d[:7]
        amount = row.get("amount", 0) or 0
        if mk not in srf_monthly:
            srf_monthly[mk] = {"usage": 0, "days": 0}
        srf_monthly[mk]["usage"] += amount
        if amount > 0:
            srf_monthly[mk]["days"] += 1

    # Net Liquidity 履歴（Z-score 計算用）
    nl_history: List[float] = []
    for row in fed_data:
        s = row.get("soma_assets")
        r = row.get("rrp")
        t = row.get("tga")
        if s is not None and r is not None and t is not None:
            nl_history.append(s - r - t)

    # SP500 月次マップ（6ヶ月後リターン用）
    sp500_months_sorted = sorted(indicators_map.keys())

    # FRBデータがある月を基準に対象月を決定
    all_months = sorted(fed_map.keys())
    target_months = [m for m in all_months if m >= start_date[:7] and m <= end_date[:7]]

    logger.info(f"Computing {len(target_months)} months...")

    # ============================================================
    # 3. 月次ループ
    # ============================================================
    layer_rows: List[dict] = []
    state_rows: List[dict] = []

    for mk in target_months:
        fed_row = fed_map.get(mk, {})
        soma = fed_row.get("soma_assets")
        rrp_ = fed_row.get("rrp")
        tga_ = fed_row.get("tga")
        reserves = fed_row.get("reserves")
        row_date = fed_row.get("date", mk + "-28")

        # --- Layer 1 ---
        l1_score = 50
        l1_components = {}
        if soma is not None and rrp_ is not None and tga_ is not None and nl_history:
            current_nl = soma - rrp_ - tga_
            l1 = calculate_layer1_stress(current_nl, nl_history)
            l1_score = l1["stress_score"]
            l1_components = {
                "z_score": l1.get("z_score"),
                "net_liquidity": current_nl,
            }

        # --- Layer 2A ---
        spread_row = spreads_map.get(mk, {})
        bank_row = bank_map.get(mk, {})
        srf_row = srf_monthly.get(mk, {"usage": 0, "days": 0})

        # 準備預金前月比
        reserves_mom = None
        prev_months = [m for m in all_months if m < mk]
        if prev_months and reserves is not None:
            prev_fed = fed_map.get(prev_months[-1], {})
            prev_res = prev_fed.get("reserves")
            if prev_res and prev_res != 0:
                reserves_mom = ((reserves - prev_res) / prev_res) * 100

        l2a = calculate_layer2a_stress(
            reserves_change_mom=reserves_mom,
            kre_52w_change=bank_row.get("kre_52w_change"),
            srf_usage=srf_row["usage"],
            ig_spread=spread_row.get("ig_spread"),
            srf_consecutive_days=srf_row["days"],
            srf_days_90d=srf_row["days"],
        )
        l2a_score = l2a["stress_score"]

        # --- Layer 2B ---
        margin_row = margin_map.get(mk, {})
        change_2y = margin_row.get("change_2y")
        mmf_row = mmf_map.get(mk, {})
        sp500_row = indicators_map.get(mk, {})

        l2b_score = 40
        l2b_components = {}
        if change_2y is not None:
            l2b = calculate_layer2b_stress(
                margin_debt_2y=change_2y,
                margin_debt_1y=None,
                mmf_change=mmf_row.get("change_3m"),
                vix=sp500_row.get("vix"),
            )
            l2b_score = l2b["stress_score"]
            l2b_components = l2b.get("components", {})

        # --- Market State ---
        ms = determine_market_state(
            l1_score, l2a_score, l2b_score,
            l2a.get("interpretation_type"),
        )

        # --- Credit Pressure ---
        rates_row = rates_map.get(mk, {})
        credit = calculate_credit_pressure(
            hy_spread=spread_row.get("hy_spread"),
            ig_spread=spread_row.get("ig_spread"),
            yield_curve=rates_row.get("treasury_spread"),
            dxy=sp500_row.get("dxy"),
        )
        credit_level = {"Low": 0, "Medium": 50, "High": 100}.get(credit.get("level", "Low"), 0)

        # --- SP500 6ヶ月後リターン ---
        return_6m = None
        sp500_now = sp500_row.get("sp500")
        if sp500_now:
            target_month_num = int(mk[5:7]) + 6
            if target_month_num <= 12:
                target_ym = f"{mk[:5]}{str(target_month_num).zfill(2)}"
            else:
                target_ym = f"{int(mk[:4]) + 1}-{str(target_month_num - 12).zfill(2)}"
            future_candidates = [m for m in sp500_months_sorted if m >= target_ym]
            if future_candidates:
                future_row = indicators_map.get(future_candidates[0], {})
                sp500_future = future_row.get("sp500")
                if sp500_future and sp500_now > 0:
                    return_6m = round(((sp500_future - sp500_now) / sp500_now) * 100, 2)

        # --- layer_stress_history 行 ---
        layer_rows.append({"date": row_date, "layer": "layer1", "stress_score": l1_score,
                           "components": json.dumps(l1_components, ensure_ascii=False)})
        layer_rows.append({"date": row_date, "layer": "layer2a", "stress_score": l2a_score,
                           "components": json.dumps(l2a.get("components", {}), ensure_ascii=False)})
        layer_rows.append({"date": row_date, "layer": "layer2b", "stress_score": l2b_score,
                           "components": json.dumps(l2b_components, ensure_ascii=False)})

        # --- market_state_history 行 ---
        # スキーマ: date, state, layer1_stress, layer2a_stress,
        #   layer2b_stress, credit_pressure, comment
        state_rows.append({
            "date": row_date,
            "state": ms["code"],
            "layer1_stress": l1_score,
            "layer2a_stress": l2a_score,
            "layer2b_stress": l2b_score,
            "credit_pressure": credit.get("level", "Low"),
            "comment": ms.get("comment", ""),
        })

    # ============================================================
    # 4. Upsert
    # ============================================================
    logger.info(f"Upserting {len(layer_rows)} layer_stress rows + {len(state_rows)} market_state rows...")
    upsert_layer_stress_history(layer_rows)
    upsert_market_state_history(state_rows)
    logger.info("Monthly state calculation complete.")
