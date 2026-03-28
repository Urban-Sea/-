#!/usr/bin/env python3
"""
Supabase CSV exports → db/init/01_schema.sql を自動生成するスクリプト。

入力:
  - Supabase Snippet List Public Tables.csv   (columns A-H)
  - Supabase Snippet List Public Tables2.csv  (columns A-H, 続き)
  - Supabase Snippet List Public Tables3.csv  (columns A-H, 続き)
  - Supabase Snippet List Public Tables4.csv  (constraints)
  - Supabase Snippet List Public Tables5.csv  (indexes)

出力:
  - db/init/01_schema.sql
"""

import csv
import os
from collections import defaultdict, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── CSV 読み込み ──

def read_csv(filename):
    path = ROOT / filename
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def load_columns():
    """3つの columns CSV を結合し、欠損データを補完して返す。"""
    rows = []
    for name in [
        "Supabase Snippet List Public Tables.csv",
        "Supabase Snippet List Public Tables2.csv",
        "Supabase Snippet List Public Tables3.csv",
    ]:
        rows.extend(read_csv(name))

    # CSV1 が holdings.sector (ordinal_position=8) で切れていたので補完
    # SQL Editor で全17カラムを確認済み
    holdings_extra = [
        {"table_name": "holdings", "column_name": "regime_at_entry", "data_type": "character varying", "udt_name": "varchar", "character_maximum_length": "20", "is_nullable": "YES", "column_default": "null", "ordinal_position": "9"},
        {"table_name": "holdings", "column_name": "rs_at_entry", "data_type": "character varying", "udt_name": "varchar", "character_maximum_length": "20", "is_nullable": "YES", "column_default": "null", "ordinal_position": "10"},
        {"table_name": "holdings", "column_name": "fx_rate", "data_type": "numeric", "udt_name": "numeric", "character_maximum_length": "null", "is_nullable": "YES", "column_default": "150.0", "ordinal_position": "11"},
        {"table_name": "holdings", "column_name": "target_price", "data_type": "numeric", "udt_name": "numeric", "character_maximum_length": "null", "is_nullable": "YES", "column_default": "null", "ordinal_position": "12"},
        {"table_name": "holdings", "column_name": "stop_loss", "data_type": "numeric", "udt_name": "numeric", "character_maximum_length": "null", "is_nullable": "YES", "column_default": "null", "ordinal_position": "13"},
        {"table_name": "holdings", "column_name": "thesis", "data_type": "text", "udt_name": "text", "character_maximum_length": "null", "is_nullable": "YES", "column_default": "null", "ordinal_position": "14"},
        {"table_name": "holdings", "column_name": "notes", "data_type": "text", "udt_name": "text", "character_maximum_length": "null", "is_nullable": "YES", "column_default": "null", "ordinal_position": "15"},
        {"table_name": "holdings", "column_name": "created_at", "data_type": "timestamp with time zone", "udt_name": "timestamptz", "character_maximum_length": "null", "is_nullable": "YES", "column_default": "now()", "ordinal_position": "16"},
        {"table_name": "holdings", "column_name": "updated_at", "data_type": "timestamp with time zone", "udt_name": "timestamptz", "character_maximum_length": "null", "is_nullable": "YES", "column_default": "now()", "ordinal_position": "17"},
    ]
    # Only add if not already present
    existing_holdings = {r["column_name"] for r in rows if r["table_name"] == "holdings"}
    for extra in holdings_extra:
        if extra["column_name"] not in existing_holdings:
            rows.append(extra)

    return rows


def load_constraints():
    return read_csv("Supabase Snippet List Public Tables4.csv")


def load_indexes():
    return read_csv("Supabase Snippet List Public Tables5.csv")


# ── SQL 型変換 ──

def pg_type(row):
    """information_schema の行から PostgreSQL 型文字列を返す。"""
    data_type = row["data_type"]
    udt_name = row["udt_name"]
    max_len = row["character_maximum_length"]

    if data_type == "ARRAY":
        # _text → TEXT[], _int4 → INTEGER[] etc.
        base = udt_name.lstrip("_")
        type_map = {"text": "TEXT", "int4": "INTEGER", "float8": "DOUBLE PRECISION", "bool": "BOOLEAN"}
        return type_map.get(base, base.upper()) + "[]"

    if data_type == "USER-DEFINED":
        return udt_name.upper()

    # varchar with length
    if data_type == "character varying" and max_len and max_len != "null":
        return f"VARCHAR({max_len})"

    type_map = {
        "integer": "INTEGER",
        "bigint": "BIGINT",
        "smallint": "SMALLINT",
        "numeric": "NUMERIC",
        "double precision": "DOUBLE PRECISION",
        "real": "REAL",
        "boolean": "BOOLEAN",
        "text": "TEXT",
        "character varying": "VARCHAR",
        "date": "DATE",
        "timestamp with time zone": "TIMESTAMPTZ",
        "timestamp without time zone": "TIMESTAMP",
        "jsonb": "JSONB",
        "json": "JSON",
        "uuid": "UUID",
    }
    return type_map.get(data_type, data_type.upper())


def clean_default(default_val, col_type):
    """Supabase のデフォルト値をセルフホスト PostgreSQL 向けに整理。"""
    if not default_val or default_val == "null":
        return None

    # nextval → SERIAL 系で処理するので不要
    if "nextval(" in default_val:
        return None

    # ::character varying → 不要なキャスト除去
    val = default_val
    val = val.replace("::character varying", "")
    val = val.replace("::text", "")

    # Supabase Auth → Google OAuth: デフォルト値変更
    if val == "'cloudflare_access'":
        val = "'google'"

    return val


# ── メイン生成 ──

def generate_sql():
    columns = load_columns()
    constraints_raw = load_constraints()
    indexes_raw = load_indexes()

    # テーブルごとにカラムを整理 (重複除去)
    tables = OrderedDict()
    seen_columns = set()  # (table_name, column_name)
    for row in columns:
        tname = row["table_name"]
        cname = row["column_name"]
        key = (tname, cname)
        if key in seen_columns:
            continue
        seen_columns.add(key)
        if tname not in tables:
            tables[tname] = []
        tables[tname].append(row)

    # PK カラムを取得
    pk_columns = defaultdict(list)  # table -> [col1, col2]
    unique_constraints = defaultdict(dict)  # table -> {constraint_name: [cols]}
    fk_constraints = []

    for row in constraints_raw:
        tname = row["table_name"]
        ctype = row["constraint_type"]
        cname = row["constraint_name"]
        col = row["column_name"]

        if ctype == "PRIMARY KEY":
            if col not in pk_columns[tname]:
                pk_columns[tname].append(col)
        elif ctype == "UNIQUE":
            if cname not in unique_constraints[tname]:
                unique_constraints[tname][cname] = []
            if col not in unique_constraints[tname][cname]:
                unique_constraints[tname][cname].append(col)
        elif ctype == "FOREIGN KEY":
            fk_constraints.append({
                "table": tname,
                "column": col,
                "constraint_name": cname,
                "foreign_table": row["foreign_table_name"],
                "foreign_column": row["foreign_column_name"],
            })

    # インデックス (PK/UNIQUE 以外のもの)
    extra_indexes = []
    pk_and_unique_names = set()
    for tname in pk_columns:
        pk_and_unique_names.add(f"{tname}_pkey")
    for tname, ucs in unique_constraints.items():
        for cname in ucs:
            pk_and_unique_names.add(cname)

    for row in indexes_raw:
        iname = row["indexname"]
        if iname not in pk_and_unique_names:
            extra_indexes.append(row)

    # ── SQL 出力 ──
    lines = []
    lines.append("-- ============================================================")
    lines.append("-- Open Regime: Database Schema")
    lines.append("-- Generated from Supabase export CSVs")
    lines.append("-- ============================================================")
    lines.append("")
    lines.append("-- NOTE: RLS policies are NOT included.")
    lines.append("-- Authentication/authorization is handled by api-go middleware.")
    lines.append("")

    # update_updated_at 関数
    lines.append("-- ── Helper function ──")
    lines.append("")
    lines.append("CREATE OR REPLACE FUNCTION update_updated_at()")
    lines.append("RETURNS TRIGGER")
    lines.append("LANGUAGE plpgsql")
    lines.append("SET search_path = ''")
    lines.append("AS $$")
    lines.append("BEGIN")
    lines.append("    NEW.updated_at = NOW();")
    lines.append("    RETURN NEW;")
    lines.append("END;")
    lines.append("$$;")
    lines.append("")

    # テーブル定義の順序 (FK 依存考慮)
    # users が先、holdings が trades より先
    ordered_tables = []
    # FK 依存グラフを構築
    fk_deps = defaultdict(set)  # table -> set of tables it depends on
    for fk in fk_constraints:
        if fk["table"] != fk["foreign_table"]:
            fk_deps[fk["table"]].add(fk["foreign_table"])

    # トポロジカルソート (簡易版)
    remaining = set(tables.keys())
    while remaining:
        # 依存先が全て処理済みのテーブルを追加
        batch = []
        for t in sorted(remaining):
            deps = fk_deps.get(t, set())
            if deps.issubset(set(ordered_tables)):
                batch.append(t)
        if not batch:
            # 循環参照がある場合は残りを全部追加
            batch = sorted(remaining)
        ordered_tables.extend(batch)
        remaining -= set(batch)

    # テーブル作成
    for tname in ordered_tables:
        cols = tables[tname]
        pks = pk_columns.get(tname, [])

        lines.append(f"-- ── {tname} ──")
        lines.append("")
        lines.append(f"CREATE TABLE {tname} (")

        col_defs = []
        for col in cols:
            cname = col["column_name"]
            ctype = pg_type(col)
            nullable = col["is_nullable"]
            default = clean_default(col["column_default"], ctype)

            # SERIAL detection: integer + nextval
            raw_default = col["column_default"] or ""
            if "nextval(" in raw_default and ctype == "INTEGER":
                ctype = "SERIAL"
            elif "nextval(" in raw_default and ctype == "BIGINT":
                ctype = "BIGSERIAL"

            parts = [f"    {cname}"]
            parts.append(ctype)

            # PK inline (single column PK)
            if len(pks) == 1 and cname == pks[0] and ctype not in ("SERIAL", "BIGSERIAL"):
                parts.append("PRIMARY KEY")
            elif ctype in ("SERIAL", "BIGSERIAL"):
                parts.append("PRIMARY KEY")

            if nullable == "NO" and ctype not in ("SERIAL", "BIGSERIAL") and not (len(pks) == 1 and cname == pks[0]):
                parts.append("NOT NULL")

            if default:
                parts.append(f"DEFAULT {default}")

            col_defs.append(" ".join(parts))

        # Composite PK
        if len(pks) > 1:
            col_defs.append(f"    PRIMARY KEY ({', '.join(pks)})")

        # UNIQUE constraints (inline)
        for cname, ucols in unique_constraints.get(tname, {}).items():
            col_defs.append(f"    UNIQUE ({', '.join(ucols)})")

        lines.append(",\n".join(col_defs))
        lines.append(");")
        lines.append("")

    # FK constraints (ALTER TABLE で後付け)
    if fk_constraints:
        lines.append("-- ── Foreign Keys ──")
        lines.append("")
        seen = set()
        for fk in fk_constraints:
            key = fk["constraint_name"]
            if key in seen:
                continue
            seen.add(key)
            lines.append(
                f"ALTER TABLE {fk['table']} "
                f"ADD CONSTRAINT {fk['constraint_name']} "
                f"FOREIGN KEY ({fk['column']}) REFERENCES {fk['foreign_table']}({fk['foreign_column']});"
            )
        lines.append("")

    # Extra indexes
    if extra_indexes:
        lines.append("-- ── Indexes ──")
        lines.append("")
        for idx in extra_indexes:
            # Remove public. schema prefix from index definitions
            indexdef = idx["indexdef"].replace(" public.", " ")
            lines.append(f"{indexdef};")
        lines.append("")

    # updated_at triggers
    lines.append("-- ── updated_at triggers ──")
    lines.append("")
    tables_with_updated_at = []
    for tname, cols in tables.items():
        for col in cols:
            if col["column_name"] == "updated_at":
                tables_with_updated_at.append(tname)
                break

    for tname in tables_with_updated_at:
        lines.append(f"CREATE TRIGGER set_updated_at_{tname}")
        lines.append(f"    BEFORE UPDATE ON {tname}")
        lines.append(f"    FOR EACH ROW EXECUTE FUNCTION update_updated_at();")
        lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    sql = generate_sql()
    out_path = ROOT / "db" / "init" / "01_schema.sql"
    out_path.write_text(sql, encoding="utf-8")
    print(f"Generated: {out_path}")
    print(f"Tables: {len(set(r['table_name'] for r in load_columns()))}")
