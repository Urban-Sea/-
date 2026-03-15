"""
Supabase 書き込みヘルパー

全テーブル共通の upsert ロジックを提供。
500行ずつバッチ upsert し、conflict カラムで ON CONFLICT UPDATE する。
upsert 前に既存データと比較し、値が変わっていたら data_revisions に記録。
"""

import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Set

from .config import get_supabase

logger = logging.getLogger("batch.db")

BATCH_SIZE = 500
PAGE_SIZE = 1000

# 修正検知の対象テーブルと監視カラム
REVISION_WATCH: Dict[str, List[str]] = {
    "fed_balance_sheet": ["soma_assets", "rrp", "tga", "reserves"],
    "interest_rates": ["fed_funds", "treasury_2y", "treasury_10y"],
    "credit_spreads": ["hy_spread", "ig_spread"],
    "mmf_assets": ["total_assets"],
    "weekly_claims": ["initial_claims", "continued_claims"],
    "economic_indicators": ["current_value", "u3_rate", "u6_rate", "nfp_change"],
}

# 修正検知で日付カラムが "date" でないテーブル
REVISION_DATE_COL: Dict[str, str] = {
    "weekly_claims": "week_ending",
    "economic_indicators": "reference_period",
}

# 複合キーテーブル: 日付カラムだけではユニークにならないテーブル
# キーは (date_col, extra_key_col) で既存データを一意に特定する
REVISION_COMPOSITE_KEY: Dict[str, str] = {
    "economic_indicators": "indicator",
}

# 許容誤差（浮動小数点の丸め差異を無視）
REVISION_TOLERANCE = 0.0001


def _fetch_existing(
    table: str, dates: List[str], select: str,
    date_col: str = "date", extra_key_col: Optional[str] = None,
) -> Dict[str, dict]:
    """既存データをキーで取得。ページネーション対応。

    extra_key_col が指定された場合、辞書キーは "date_col|extra_key_col" の複合キーになる。
    """
    if not dates:
        return {}

    sb = get_supabase()
    existing: Dict[str, dict] = {}

    # extra_key_col がある場合は select に含める
    actual_select = select
    if extra_key_col and extra_key_col not in select:
        actual_select = extra_key_col + "," + select

    # Supabase の in_() は最大数百件程度なのでバッチ分割
    for i in range(0, len(dates), 200):
        chunk = dates[i : i + 200]
        r = sb.table(table).select(actual_select) \
            .in_(date_col, chunk) \
            .execute()
        for row in (r.data or []):
            if extra_key_col:
                key = f"{row[date_col]}|{row[extra_key_col]}"
            else:
                key = row[date_col]
            existing[key] = row

    return existing


def _detect_revisions(
    table: str,
    new_rows: List[dict],
    batch_run_id: str,
) -> List[dict]:
    """新旧データを比較し、値が変わった箇所を data_revisions 行として返す。"""
    watch_cols = REVISION_WATCH.get(table)
    if not watch_cols:
        return []

    date_col = REVISION_DATE_COL.get(table, "date")
    extra_key_col = REVISION_COMPOSITE_KEY.get(table)
    dates = [r[date_col] for r in new_rows if r.get(date_col)]
    select_cols = date_col + "," + ",".join(watch_cols)
    existing = _fetch_existing(table, dates, select_cols, date_col=date_col, extra_key_col=extra_key_col)

    if not existing:
        return []

    revisions: List[dict] = []
    for row in new_rows:
        d = row.get(date_col)
        if extra_key_col:
            lookup_key = f"{d}|{row.get(extra_key_col)}"
        else:
            lookup_key = d
        old = existing.get(lookup_key)
        if not old:
            continue

        for col in watch_cols:
            old_val = old.get(col)
            new_val = row.get(col)

            if old_val is None or new_val is None:
                continue

            try:
                old_f = float(old_val)
                new_f = float(new_val)
            except (ValueError, TypeError):
                continue

            diff = new_f - old_f
            if abs(diff) <= REVISION_TOLERANCE:
                continue

            pct = (diff / abs(old_f) * 100) if old_f != 0 else None
            direction = "上方修正" if diff > 0 else "下方修正"

            # column_name に indicator を含めて区別可能にする
            col_label = col
            if extra_key_col:
                col_label = f"{row.get(extra_key_col)}:{col}"

            revisions.append({
                "table_name": table,
                "record_date": d,
                "column_name": col_label,
                "old_value": round(old_f, 6),
                "new_value": round(new_f, 6),
                "change_amount": round(diff, 6),
                "change_pct": round(pct, 4) if pct is not None else None,
                "direction": direction,
                "batch_run_id": batch_run_id,
            })

    return revisions


def _save_revisions(revisions: List[dict]):
    """data_revisions テーブルに記録。"""
    if not revisions:
        return

    sb = get_supabase()
    for i in range(0, len(revisions), BATCH_SIZE):
        batch = revisions[i : i + BATCH_SIZE]
        sb.table("data_revisions").insert(batch).execute()

    # ログ出力
    up = sum(1 for r in revisions if r["direction"] == "上方修正")
    down = sum(1 for r in revisions if r["direction"] == "下方修正")
    logger.warning(
        f"修正検知: {len(revisions)}件 (上方修正={up}, 下方修正={down})"
    )
    for r in revisions[:10]:  # 最初の10件をログ
        logger.warning(
            f"  {r['table_name']}.{r['column_name']} [{r['record_date']}]: "
            f"{r['old_value']} → {r['new_value']} ({r['direction']} {r.get('change_pct', '?')}%)"
        )
    if len(revisions) > 10:
        logger.warning(f"  ... 他 {len(revisions) - 10}件")


# バッチ実行IDを生成（同一バッチ内の修正をグループ化）
_current_batch_run_id: Optional[str] = None


def get_batch_run_id() -> str:
    global _current_batch_run_id
    if _current_batch_run_id is None:
        _current_batch_run_id = datetime.now().strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:8]
    return _current_batch_run_id


def _upsert_batch(
    table: str,
    rows: List[dict],
    conflict_col: str = "date",
) -> int:
    """汎用バッチ upsert。修正検知付き。返値は upsert 行数。"""
    if not rows:
        return 0

    # 修正検知（対象テーブルのみ）
    if table in REVISION_WATCH:
        revisions = _detect_revisions(table, rows, get_batch_run_id())
        _save_revisions(revisions)

    sb = get_supabase()
    total = 0

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        sb.table(table).upsert(batch, on_conflict=conflict_col).execute()
        total += len(batch)
        logger.debug(f"  {table}: {total}/{len(rows)}")

    logger.info(f"{table}: {total} rows upserted")
    return total


def _add_updated_at(rows: List[dict]) -> List[dict]:
    now = datetime.now().isoformat()
    for r in rows:
        r["updated_at"] = now
    return rows


# ===== テーブル別ラッパー =====

def upsert_fed_balance_sheet(rows: List[dict]) -> int:
    return _upsert_batch("fed_balance_sheet", _add_updated_at(rows))


def upsert_interest_rates(rows: List[dict]) -> int:
    for r in rows:
        t2 = r.get("treasury_2y")
        t10 = r.get("treasury_10y")
        if t2 is not None and t10 is not None:
            r["treasury_spread"] = round(t10 - t2, 4)
    return _upsert_batch("interest_rates", _add_updated_at(rows))


def upsert_credit_spreads(rows: List[dict]) -> int:
    return _upsert_batch("credit_spreads", _add_updated_at(rows))


def upsert_market_indicators(rows: List[dict]) -> int:
    return _upsert_batch("market_indicators", _add_updated_at(rows))


def upsert_bank_sector(rows: List[dict]) -> int:
    return _upsert_batch("bank_sector", _add_updated_at(rows))


def upsert_srf_usage(rows: List[dict]) -> int:
    return _upsert_batch("srf_usage", _add_updated_at(rows))


def upsert_mmf_assets(rows: List[dict]) -> int:
    return _upsert_batch("mmf_assets", _add_updated_at(rows))


def upsert_layer_stress_history(rows: List[dict]) -> int:
    return _upsert_batch("layer_stress_history", rows, conflict_col="date,layer")


def upsert_market_state_history(rows: List[dict]) -> int:
    return _upsert_batch("market_state_history", rows, conflict_col="date")


# ===== 米国景気テーブル =====

def upsert_weekly_claims(rows: List[dict]) -> int:
    return _upsert_batch("weekly_claims", _add_updated_at(rows), conflict_col="week_ending")


def upsert_economic_indicators(rows: List[dict]) -> int:
    return _upsert_batch("economic_indicators", _add_updated_at(rows), conflict_col="indicator,reference_period")


# ===== ポートフォリオスナップショット =====

def upsert_portfolio_snapshots(rows: List[dict]) -> int:
    return _upsert_batch("portfolio_snapshots", rows, conflict_col="user_id,snapshot_date")
