#!/usr/bin/env python3
"""
手動入力データ管理CLI — manual_inputs テーブル (psycopg2)

使用方法:
    python manual_input.py list                           # 入力済みデータ一覧
    python manual_input.py add ADP 2026-01 122            # ADP_CHANGE を千人単位で追加
    python manual_input.py add CHALLENGER 2026-01 38792   # CHALLENGER_CUTS を件数で追加
    python manual_input.py add TRUFLATION 2026-01 3.2     # TRUFLATION を%で追加
    python manual_input.py load-adp                       # ADP CSVから一括投入（水準→月次変化に変換）
"""

import sys
import csv
from datetime import datetime
from pathlib import Path

# プロジェクトルートからconfig読み込み
sys.path.insert(0, str(Path(__file__).parent))
from config import get_conn

REVISION_TOLERANCE = 0.0001

METRICS = {
    "ADP_CHANGE": "ADP雇用変化（千人）",
    "CHALLENGER_CUTS": "Challenger人員削減（件数）",
    "TRUFLATION": "Truflationインフレ率（%）",
}

# エイリアス
ALIASES = {
    "ADP": "ADP_CHANGE",
    "CHALLENGER": "CHALLENGER_CUTS",
}


def list_data():
    """入力済みデータ一覧"""
    conn = get_conn()
    print("=" * 60)
    print("manual_inputs データ一覧")
    print("=" * 60)

    with conn.cursor() as cur:
        for metric, name in METRICS.items():
            cur.execute(
                "SELECT reference_date, value, notes FROM manual_inputs "
                "WHERE metric = %s ORDER BY reference_date DESC LIMIT 6",
                (metric,),
            )
            rows = cur.fetchall()

            print(f"\n【{metric}】{name}")
            if rows:
                for ref_date, value, notes in rows:
                    note = f" ({notes})" if notes else ""
                    print(f"  {ref_date}: {value}{note}")
            else:
                print("  データなし")

        # 総数
        cur.execute("SELECT COUNT(*) FROM manual_inputs")
        total = cur.fetchone()[0]
        print(f"\n合計: {total}件")


def add_metric(args):
    """メトリクスを追加"""
    if len(args) < 3:
        print("使用方法: python manual_input.py add <METRIC> <DATE> <VALUE> [NOTE]")
        print("例: python manual_input.py add ADP 2026-01 122")
        return

    metric_key = ALIASES.get(args[0].upper(), args[0].upper())
    if metric_key not in METRICS:
        print(f"無効なメトリクス: {args[0]}")
        print(f"有効: {', '.join(list(METRICS.keys()) + list(ALIASES.keys()))}")
        return

    date_str = args[1]
    if len(date_str) == 7:
        date_str += "-01"

    try:
        value = float(args[2])
    except ValueError:
        print("値は数値で入力してください")
        return

    note = args[3] if len(args) > 3 else None

    conn = get_conn()

    # 修正検知: 既存データがあれば比較
    with conn.cursor() as cur:
        cur.execute(
            "SELECT value FROM manual_inputs WHERE metric = %s AND reference_date = %s",
            (metric_key, date_str),
        )
        existing = cur.fetchone()

    old_value = None
    if existing:
        old_value = float(existing[0])
        diff = value - old_value
        if abs(diff) > REVISION_TOLERANCE:
            pct = (diff / abs(old_value) * 100) if old_value != 0 else None
            direction = "上方修正" if diff > 0 else "下方修正"
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO data_revisions "
                    "(table_name, record_date, column_name, old_value, new_value, "
                    "change_amount, change_pct, direction, batch_run_id) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    ("manual_inputs", date_str, metric_key,
                     round(old_value, 6), round(value, 6), round(diff, 6),
                     round(pct, 4) if pct is not None else None,
                     direction, f"manual-{datetime.now().strftime('%Y%m%d%H%M%S')}"),
                )
            print(f"📝 {direction}: {old_value} → {value} ({diff:+.1f}, {pct:+.2f}%)" if pct else
                  f"📝 {direction}: {old_value} → {value} ({diff:+.1f})")

    # Upsert
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO manual_inputs (metric, reference_date, value, notes) "
            "VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (metric, reference_date) DO UPDATE SET value = EXCLUDED.value, notes = EXCLUDED.notes",
            (metric_key, date_str, value, note),
        )

    if old_value is not None and abs(value - old_value) <= REVISION_TOLERANCE:
        print(f"✅ {metric_key} {date_str} = {value} (変更なし)")
    elif old_value is not None:
        print(f"✅ {metric_key} {date_str} = {value} (修正記録済み)")
    else:
        print(f"✅ {metric_key} {date_str} = {value} (新規)")


def load_adp():
    """ADP CSVから一括投入（水準→月次変化に変換）"""
    csv_path = Path(__file__).parent / "data" / "adp_private_employment.csv"
    if not csv_path.exists():
        print(f"CSVが見つかりません: {csv_path}")
        return

    # CSV読み込み
    rows = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "date": row["date"],
                "level": int(row["private_employment"]),
            })

    # 月次変化を計算（千人単位）
    changes = []
    for i in range(1, len(rows)):
        change = (rows[i]["level"] - rows[i - 1]["level"]) / 1000
        changes.append({
            "metric": "ADP_CHANGE",
            "reference_date": rows[i]["date"],
            "value": round(change, 1),
            "notes": "ADP Private Employment MoM change (auto-calculated from level data)",
        })

    print(f"ADP月次変化: {len(changes)}件 計算完了")
    print(f"  最初: {changes[0]['reference_date']} = {changes[0]['value']}K")
    print(f"  最後: {changes[-1]['reference_date']} = {changes[-1]['value']}K")

    # サンプル表示
    print("\n直近12ヶ月:")
    for c in changes[-12:]:
        print(f"  {c['reference_date']}: {c['value']:+.1f}K")

    conn = get_conn()

    # 修正検知: 既存データを取得
    with conn.cursor() as cur:
        cur.execute(
            "SELECT reference_date, value FROM manual_inputs "
            "WHERE metric = 'ADP_CHANGE' ORDER BY reference_date"
        )
        existing_map = {str(r[0]): float(r[1]) for r in cur.fetchall()}

    # 修正検知して data_revisions に記録
    revisions = []
    batch_run_id = f"manual-load-adp-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    for c in changes:
        old_val = existing_map.get(c["reference_date"])
        if old_val is None:
            continue
        new_val = float(c["value"])
        diff = new_val - old_val
        if abs(diff) <= REVISION_TOLERANCE:
            continue
        pct = (diff / abs(old_val) * 100) if old_val != 0 else None
        revisions.append({
            "table_name": "manual_inputs",
            "record_date": c["reference_date"],
            "column_name": "ADP_CHANGE",
            "old_value": round(old_val, 6),
            "new_value": round(new_val, 6),
            "change_amount": round(diff, 6),
            "change_pct": round(pct, 4) if pct is not None else None,
            "direction": "上方修正" if diff > 0 else "下方修正",
            "batch_run_id": batch_run_id,
        })

    if revisions:
        rev_cols = ["table_name", "record_date", "column_name", "old_value", "new_value",
                    "change_amount", "change_pct", "direction", "batch_run_id"]
        from psycopg2.extras import execute_values
        with conn.cursor() as cur:
            sql = f"INSERT INTO data_revisions ({', '.join(rev_cols)}) VALUES %s"
            values = [tuple(r[c] for c in rev_cols) for r in revisions]
            execute_values(cur, sql, values, page_size=50)
        print(f"\n📝 修正検知: {len(revisions)}件")
        for r in revisions[:5]:
            print(f"  {r['record_date']}: {r['old_value']} → {r['new_value']} ({r['direction']})")
        if len(revisions) > 5:
            print(f"  ... 他 {len(revisions) - 5}件")

    # PostgreSQL に投入
    from psycopg2.extras import execute_values
    total_upserted = 0
    with conn.cursor() as cur:
        sql = ("INSERT INTO manual_inputs (metric, reference_date, value, notes) VALUES %s "
               "ON CONFLICT (metric, reference_date) DO UPDATE SET value = EXCLUDED.value, notes = EXCLUDED.notes")
        values = [(c["metric"], c["reference_date"], c["value"], c["notes"]) for c in changes]
        for i in range(0, len(values), 50):
            batch = values[i:i + 50]
            execute_values(cur, sql, batch, page_size=50)
            total_upserted += len(batch)

    print(f"\n✅ {total_upserted}件を manual_inputs に投入完了")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1]

    if cmd == "list":
        list_data()
    elif cmd == "add":
        add_metric(sys.argv[2:])
    elif cmd == "load-adp":
        load_adp()
    else:
        print(f"不明なコマンド: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
