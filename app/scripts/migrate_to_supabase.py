#!/usr/bin/env python3
"""
Demo SQLite → Supabase マイグレーションスクリプト

使い方:
1. 環境変数を設定:
   export SUPABASE_URL="https://xndbmsrscozqyksstzop.supabase.co"
   export SUPABASE_KEY="sb_secret_..."  # ← secret key を使用！

   ⚠️ 重要: publishable key (sb_publishable_...) ではなく secret key (sb_secret_...) を使ってください

2. 実行:
   python app/scripts/migrate_to_supabase.py

移行対象（11テーブル）:
- 配管タブ: fed_balance_sheet, interest_rates, credit_spreads, market_indicators,
            bank_sector, srf_usage, margin_debt, mmf_assets
- 米国景気警戒タブ: weekly_claims, economic_indicators
- 統合タブ: market_state_history, layer_stress_history

移行対象外（RLS有効・user_id必須）:
- 保有タブ: trades, holdings, user_settings
  → ユーザー登録後に手動で移行または新規入力
"""

import os
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase-py がインストールされていません")
    print("インストール: pip install supabase")
    exit(1)

# ===== 設定 =====
DEMO_MARKET_DB = "demo/data/market_data.db"
DEMO_TRADE_DB = "demo/data/trade_journal.db"

# 移行対象テーブル（直接コピー）
DIRECT_COPY_TABLES = [
    # 配管タブ用
    ("fed_balance_sheet", DEMO_MARKET_DB),
    ("interest_rates", DEMO_MARKET_DB),
    ("credit_spreads", DEMO_MARKET_DB),
    ("market_indicators", DEMO_MARKET_DB),
    ("bank_sector", DEMO_MARKET_DB),
    ("srf_usage", DEMO_MARKET_DB),
    ("margin_debt", DEMO_MARKET_DB),
    ("mmf_assets", DEMO_MARKET_DB),
    # 米国景気警戒タブ用
    ("weekly_claims", DEMO_MARKET_DB),
    # 統合タブ用
    ("market_state_history", DEMO_MARKET_DB),
    ("layer_stress_history", DEMO_MARKET_DB),
    # 注意: 保有タブ用テーブル（trades, holdings, user_settings）は
    # RLS有効 + user_id必須のため、自動移行対象外
    # → ユーザー登録後に手動で移行または新規入力
]

# employment_monthly から economic_indicators へのマッピング
# 新スキーマ: indicator, reference_period, current_value, nfp_change, u3_rate, u6_rate, etc.


def get_supabase_client() -> Client:
    """Supabaseクライアントを取得"""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")

    if not url or not key:
        print("❌ Error: 環境変数が設定されていません")
        print("以下を設定してください:")
        print("  export SUPABASE_URL='https://your-project.supabase.co'")
        print("  export SUPABASE_KEY='your-service-role-key'")
        exit(1)

    # キータイプをチェック
    if key.startswith("sb_publishable_"):
        print("⚠️  警告: publishable key を使用しています")
        print("   RLSが有効なテーブルには書き込めない可能性があります")
        print("   推奨: secret key (sb_secret_...) を使用")
        response = input("続行しますか? (y/N): ")
        if response.lower() != "y":
            exit(0)
    elif key.startswith("sb_secret_"):
        print("✅ secret key を使用")
    # JWT形式のservice_role keyもOK
    elif key.startswith("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"):
        print("✅ JWT形式のservice_role key を使用")

    return create_client(url, key)


def get_sqlite_data(db_path: str, table_name: str) -> tuple[list[str], list[tuple]]:
    """SQLiteテーブルからデータを取得"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # カラム名を取得
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [col[1] for col in cursor.fetchall()]

    # データを取得
    cursor.execute(f"SELECT * FROM {table_name}")
    rows = cursor.fetchall()

    conn.close()
    return columns, rows


# 新スキーマに存在しないカラム（スキップする）
SKIP_COLUMNS = {
    "market_state_history": ["margin_debt_2y", "sp500_return_6m", "events", "alerts"],
}


def transform_row_to_dict(columns: list[str], row: tuple, skip_id: bool = True, table_name: str = None) -> dict:
    """行をdictに変換（自動インクリメントIDはスキップ可能）"""
    skip_cols = SKIP_COLUMNS.get(table_name, [])
    result = {}
    for i, col in enumerate(columns):
        # 自動インクリメントIDはスキップ
        if skip_id and col == "id":
            continue
        # 新スキーマにないカラムはスキップ
        if col in skip_cols:
            continue
        value = row[i]
        # NoneやNaNの処理
        if value is None:
            result[col] = None
        elif isinstance(value, float) and str(value) == "nan":
            result[col] = None
        else:
            result[col] = value
    return result


def migrate_direct_copy_table(supabase: Client, table_name: str, db_path: str) -> int:
    """テーブルを直接コピー"""
    print(f"\n📦 {table_name} を移行中...")

    columns, rows = get_sqlite_data(db_path, table_name)
    if not rows:
        print(f"  → データなし、スキップ")
        return 0

    # 既存データをクリア（upsertを使用する場合は不要）
    try:
        supabase.table(table_name).delete().neq("id", -1).execute()
    except Exception:
        # Primary keyがidでないテーブルの場合
        try:
            # dateがPKの場合
            supabase.table(table_name).delete().neq("date", "1900-01-01").execute()
        except Exception:
            pass

    # データを変換
    skip_id = table_name in ["layer_stress_history", "market_state_history"]
    data = [transform_row_to_dict(columns, row, skip_id=skip_id, table_name=table_name) for row in rows]

    # バッチサイズで分割して挿入
    batch_size = 500
    inserted = 0

    for i in range(0, len(data), batch_size):
        batch = data[i:i + batch_size]
        try:
            result = supabase.table(table_name).insert(batch).execute()
            inserted += len(batch)
            print(f"  → {inserted}/{len(data)} 件挿入完了")
        except Exception as e:
            print(f"  ❌ エラー: {e}")
            # 1件ずつ挿入を試みる
            for record in batch:
                try:
                    supabase.table(table_name).insert(record).execute()
                    inserted += 1
                except Exception as e2:
                    print(f"    スキップ: {record.get('date', record)} - {e2}")

    print(f"  ✅ {inserted} 件移行完了")
    return inserted


def migrate_employment_to_economic_indicators(supabase: Client) -> int:
    """employment_monthly → economic_indicators に変換（新スキーマ対応）"""
    print(f"\n📦 employment_monthly → economic_indicators に変換中...")

    columns, rows = get_sqlite_data(DEMO_MARKET_DB, "employment_monthly")
    if not rows:
        print(f"  → データなし、スキップ")
        return 0

    # 既存データをクリア
    try:
        supabase.table("economic_indicators").delete().neq("id", -1).execute()
    except Exception:
        pass

    inserted = 0

    for row in rows:
        row_dict = dict(zip(columns, row))
        date = row_dict.get("date")

        if not date:
            continue

        # NFPレコードを作成（新スキーマに合わせる）
        nfp_value = row_dict.get("nfp")
        if nfp_value is not None:
            record = {
                "indicator": "NFP",
                "reference_period": date,
                "current_value": float(nfp_value) if nfp_value else None,
                "revision_count": 0,
                "nfp_change": row_dict.get("nfp_change"),
                "u3_rate": row_dict.get("u3_rate"),
                "u6_rate": row_dict.get("u6_rate"),
                "avg_hourly_earnings": row_dict.get("avg_hourly_earnings"),
                "wage_mom": row_dict.get("wage_mom"),
                "labor_force_participation": row_dict.get("labor_force_participation"),
                "updated_at": row_dict.get("updated_at") or datetime.now().isoformat(),
            }

            try:
                supabase.table("economic_indicators").insert(record).execute()
                inserted += 1
            except Exception as e:
                print(f"    スキップ: {date}/NFP - {e}")

        # JOLTS求人を別レコードとして作成
        jolts_value = row_dict.get("jolts_openings")
        if jolts_value is not None:
            record = {
                "indicator": "JOLTS",
                "reference_period": date,
                "current_value": float(jolts_value) if jolts_value else None,
                "revision_count": 0,
                "updated_at": row_dict.get("updated_at") or datetime.now().isoformat(),
            }

            try:
                supabase.table("economic_indicators").insert(record).execute()
                inserted += 1
            except Exception as e:
                print(f"    スキップ: {date}/JOLTS - {e}")

        # ADP雇用統計
        adp_value = row_dict.get("adp_employment")
        if adp_value is not None:
            record = {
                "indicator": "ADP",
                "reference_period": date,
                "current_value": float(adp_value) if adp_value else None,
                "revision_count": 0,
                "updated_at": row_dict.get("updated_at") or datetime.now().isoformat(),
            }

            try:
                supabase.table("economic_indicators").insert(record).execute()
                inserted += 1
            except Exception as e:
                print(f"    スキップ: {date}/ADP - {e}")

    print(f"  ✅ {inserted} 件のレコードを economic_indicators に挿入")
    return inserted


def verify_migration(supabase: Client) -> None:
    """移行結果を検証"""
    print("\n" + "=" * 50)
    print("📊 移行結果サマリー")
    print("=" * 50)

    tables = [t[0] for t in DIRECT_COPY_TABLES] + ["economic_indicators"]

    for table in tables:
        try:
            result = supabase.table(table).select("*", count="exact").limit(0).execute()
            count = result.count if result.count else 0
            print(f"  {table}: {count} 件")
        except Exception as e:
            print(f"  {table}: エラー - {e}")

    print("\n⚠️  保有タブ用テーブル（trades, holdings, user_settings）は")
    print("   RLS + user_id必須のため、ユーザー登録後に手動で設定してください")


def main():
    print("=" * 50)
    print("Demo SQLite → Supabase マイグレーション")
    print("=" * 50)

    # クライアント初期化
    supabase = get_supabase_client()
    print("✅ Supabase接続成功")

    # DBファイル存在確認
    for db_path in [DEMO_MARKET_DB, DEMO_TRADE_DB]:
        if not os.path.exists(db_path):
            print(f"❌ DBファイルが見つかりません: {db_path}")
            exit(1)
    print("✅ ソースDBファイル確認完了")

    # 直接コピーテーブルの移行
    total_migrated = 0
    for table_name, db_path in DIRECT_COPY_TABLES:
        count = migrate_direct_copy_table(supabase, table_name, db_path)
        total_migrated += count

    # employment_monthly の変換・移行
    count = migrate_employment_to_economic_indicators(supabase)
    total_migrated += count

    # 検証
    verify_migration(supabase)

    print("\n" + "=" * 50)
    print(f"✅ 移行完了！ 合計 {total_migrated} 件のレコードを移行しました")
    print("=" * 50)


if __name__ == "__main__":
    main()
