#!/usr/bin/env python3
"""
手動入力データ管理CLI — Supabase manual_inputs テーブル

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
from config import get_supabase

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
    supabase = get_supabase()
    print("=" * 60)
    print("manual_inputs データ一覧")
    print("=" * 60)

    for metric, name in METRICS.items():
        result = supabase.table("manual_inputs") \
            .select("reference_date,value,notes") \
            .eq("metric", metric) \
            .order("reference_date", desc=True).limit(6).execute()

        print(f"\n【{metric}】{name}")
        if result.data:
            for row in result.data:
                note = f" ({row['notes']})" if row.get("notes") else ""
                print(f"  {row['reference_date']}: {row['value']}{note}")
        else:
            print("  データなし")

    # 総数
    total = supabase.table("manual_inputs").select("id", count="exact").execute()
    print(f"\n合計: {total.count}件")


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

    supabase = get_supabase()

    # 修正検知: 既存データがあれば比較
    existing = supabase.table("manual_inputs") \
        .select("value") \
        .eq("metric", metric_key) \
        .eq("reference_date", date_str) \
        .execute()

    old_value = None
    if existing.data:
        old_value = float(existing.data[0]["value"])
        diff = value - old_value
        if abs(diff) > REVISION_TOLERANCE:
            pct = (diff / abs(old_value) * 100) if old_value != 0 else None
            direction = "上方修正" if diff > 0 else "下方修正"
            revision = {
                "table_name": "manual_inputs",
                "record_date": date_str,
                "column_name": metric_key,
                "old_value": round(old_value, 6),
                "new_value": round(value, 6),
                "change_amount": round(diff, 6),
                "change_pct": round(pct, 4) if pct is not None else None,
                "direction": direction,
                "batch_run_id": f"manual-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            }
            supabase.table("data_revisions").insert(revision).execute()
            print(f"📝 {direction}: {old_value} → {value} ({diff:+.1f}, {pct:+.2f}%)" if pct else
                  f"📝 {direction}: {old_value} → {value} ({diff:+.1f})")

    row = {
        "metric": metric_key,
        "reference_date": date_str,
        "value": value,
    }
    if note:
        row["notes"] = note

    supabase.table("manual_inputs").upsert(
        row, on_conflict="metric,reference_date"
    ).execute()

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
            "notes": f"ADP Private Employment MoM change (auto-calculated from level data)",
        })

    print(f"ADP月次変化: {len(changes)}件 計算完了")
    print(f"  最初: {changes[0]['reference_date']} = {changes[0]['value']}K")
    print(f"  最後: {changes[-1]['reference_date']} = {changes[-1]['value']}K")

    # サンプル表示
    print("\n直近12ヶ月:")
    for c in changes[-12:]:
        print(f"  {c['reference_date']}: {c['value']:+.1f}K")

    # 修正検知: 既存データを取得
    supabase = get_supabase()
    existing_rows = supabase.table("manual_inputs") \
        .select("reference_date,value") \
        .eq("metric", "ADP_CHANGE") \
        .order("reference_date").execute()
    existing_map = {r["reference_date"]: float(r["value"]) for r in (existing_rows.data or [])}

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
        for i in range(0, len(revisions), 50):
            supabase.table("data_revisions").insert(revisions[i:i + 50]).execute()
        print(f"\n📝 修正検知: {len(revisions)}件")
        for r in revisions[:5]:
            print(f"  {r['record_date']}: {r['old_value']} → {r['new_value']} ({r['direction']})")
        if len(revisions) > 5:
            print(f"  ... 他 {len(revisions) - 5}件")

    # Supabaseに投入
    batch_size = 50
    total_upserted = 0
    for i in range(0, len(changes), batch_size):
        batch = changes[i:i + batch_size]
        supabase.table("manual_inputs").upsert(
            batch, on_conflict="metric,reference_date"
        ).execute()
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
