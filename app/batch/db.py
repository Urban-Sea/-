"""
PostgreSQL 書き込みヘルパー (psycopg2)

全テーブル共通の upsert ロジックを提供。
execute_values でバッチ upsert し、ON CONFLICT DO UPDATE する。
upsert 前に既存データと比較し、値が変わっていたら data_revisions に記録。
"""

import logging
import uuid
from datetime import date as _date_type, datetime
from typing import Dict, List, Optional, Set

from psycopg2.extras import execute_values

from .config import get_conn


def _coerce_dates(values: List) -> List:
    """文字列の日付を datetime.date オブジェクトに変換。
    psycopg2 が text[] として送信するのを防ぎ、Postgres 側で
    `date = text` 比較エラーになるのを回避する。

    対応形式:
      "2026-02-01"
      "2026-02-01T00:00:00Z"
      "2026-02-01 00:00:00"
      datetime.date / datetime.datetime オブジェクト (素通し)
    """
    out = []
    for v in values:
        if v is None:
            continue
        if isinstance(v, _date_type):
            out.append(v)
            continue
        if not isinstance(v, str):
            continue
        # ISO 形式の先頭 10 文字 (YYYY-MM-DD) を date として解釈
        try:
            d = _date_type.fromisoformat(v[:10])
            out.append(d)
        except (ValueError, TypeError):
            continue
    return out

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
REVISION_COMPOSITE_KEY: Dict[str, str] = {
    "economic_indicators": "indicator",
}

# 許容誤差（浮動小数点の丸め差異を無視）
REVISION_TOLERANCE = 0.0001


def _fetch_existing(
    table: str, dates: List[str], columns: List[str],
    date_col: str = "date", extra_key_col: Optional[str] = None,
) -> Dict[str, dict]:
    """既存データをキーで取得。

    extra_key_col が指定された場合、辞書キーは "date_col|extra_key_col" の複合キーになる。
    """
    if not dates:
        return {}

    # 文字列日付を date オブジェクトに変換 (psycopg2 が date[] として送信するため)
    coerced = _coerce_dates(dates)
    if not coerced:
        return {}

    conn = get_conn()
    existing: Dict[str, dict] = {}

    # SELECT カラムを構築
    select_cols = list(columns)
    if date_col not in select_cols:
        select_cols.insert(0, date_col)
    if extra_key_col and extra_key_col not in select_cols:
        select_cols.insert(1, extra_key_col)

    col_str = ", ".join(select_cols)

    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {col_str} FROM {table} WHERE {date_col} = ANY(%s)",
            (coerced,),
        )
        col_names = [desc[0] for desc in cur.description]
        for row_tuple in cur.fetchall():
            row = dict(zip(col_names, row_tuple))
            d = str(row[date_col])
            if extra_key_col:
                key = f"{d}|{row[extra_key_col]}"
            else:
                key = d
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
    existing = _fetch_existing(table, dates, watch_cols, date_col=date_col, extra_key_col=extra_key_col)

    if not existing:
        return []

    revisions: List[dict] = []
    for row in new_rows:
        d = row.get(date_col)
        if extra_key_col:
            lookup_key = f"{d}|{row.get(extra_key_col)}"
        else:
            lookup_key = d
        old = existing.get(str(lookup_key))
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

    conn = get_conn()
    cols = ["table_name", "record_date", "column_name", "old_value", "new_value",
            "change_amount", "change_pct", "direction", "batch_run_id"]
    sql = f"INSERT INTO data_revisions ({', '.join(cols)}) VALUES %s"
    values = [tuple(r.get(c) for c in cols) for r in revisions]

    with conn.cursor() as cur:
        execute_values(cur, sql, values, page_size=BATCH_SIZE)

    # ログ出力
    up = sum(1 for r in revisions if r["direction"] == "上方修正")
    down = sum(1 for r in revisions if r["direction"] == "下方修正")
    logger.warning(
        f"修正検知: {len(revisions)}件 (上方修正={up}, 下方修正={down})"
    )
    for r in revisions[:10]:
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

    conn = get_conn()

    # カラム名を最初の行から取得
    columns = list(rows[0].keys())
    col_str = ", ".join(columns)
    conflict_cols = conflict_col  # "date" or "date,layer" etc.

    # ON CONFLICT DO UPDATE SET — conflict カラム以外を更新
    conflict_set = set(c.strip() for c in conflict_cols.split(","))
    update_cols = [c for c in columns if c not in conflict_set]
    update_str = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)

    sql = f"INSERT INTO {table} ({col_str}) VALUES %s"
    if update_str:
        sql += f" ON CONFLICT ({conflict_cols}) DO UPDATE SET {update_str}"
    else:
        sql += f" ON CONFLICT ({conflict_cols}) DO NOTHING"

    total = 0
    with conn.cursor() as cur:
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i : i + BATCH_SIZE]
            values = [tuple(r.get(c) for c in columns) for r in batch]
            execute_values(cur, sql, values, page_size=BATCH_SIZE)
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
