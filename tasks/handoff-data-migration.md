# データ移行: Supabase → Docker PostgreSQL

## 背景

VPS Docker移行プロジェクト。Lane A/B/C でコンテナは構築済みだが、Docker の PostgreSQL は空。
Supabase の本番データをエクスポートして Docker PostgreSQL にインポートする。

- スキーマ: `db/init/01_schema.sql`（Docker起動時に自動適用済み、26テーブル）
- エクスポートスクリプト: `scripts/export-supabase.sh`（既存、REST API → INSERT SQL）

---

## 前提条件

### 環境変数

`.env` に以下が必要（Supabase ダッシュボード → Settings → API から取得）:

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...  # service_role key（anon key ではダメ）
```

### Docker が起動していること

```bash
docker compose up -d postgres redis
```

スキーマは `db/init/01_schema.sql` が `docker-entrypoint-initdb.d` 経由で自動適用される。
**初回起動のみ**。既にボリュームがある場合は `docker compose down -v` してから再起動。

---

## Step 1: Supabase からデータエクスポート

```bash
./scripts/export-supabase.sh
```

出力: `db/seed/seed_data.sql`（INSERT 文、ON CONFLICT DO NOTHING 付き）

### エクスポートされるテーブル（28テーブル、FK依存順）

1. `users` — ユーザー（auth_provider_id = Supabase Auth の sub）
2. `user_settings` — 表示名、テーマ等
3. `holdings` — 保有銘柄
4. `trades` — 取引履歴
5. `cash_balances` — 現金残高
6. `user_watchlists` — ウォッチリスト
7. `portfolio_snapshots` — ポートフォリオスナップショット
8. `stock_master` — 銘柄マスター
9. `fed_balance_sheet`, `interest_rates`, `credit_spreads`, `market_indicators`, `bank_sector`, `srf_usage`, `margin_debt`, `mmf_assets` — 市場データ
10. `layer_stress_history`, `market_state_history` — レジーム計算結果
11. `economic_indicators`, `weekly_claims`, `manual_inputs` — 雇用データ
12. `economic_indicator_revisions` — 指標リビジョン
13. `admin_audit_logs`, `admin_mfa`, `admin_mfa_sessions` — 管理者
14. `batch_logs`, `feature_flags`, `data_revisions` — 運用
15. `precomputed_results`, `stock_cache` — キャッシュ（空でも問題なし）

### エクスポートスクリプトの仕組み

- Supabase REST API (`/rest/v1/{table}?select=*`) で全行取得
- 1000行ずつページネーション
- JSON → `INSERT INTO ... VALUES ... ON CONFLICT DO NOTHING;` に変換
- `jq` の `$$` クオートでSQL injection を防止

---

## Step 2: Docker PostgreSQL にインポート

```bash
docker compose exec -T postgres psql -U app open_regime < db/seed/seed_data.sql
```

### エラーが出る場合

1. **`relation "xxx" does not exist`** — スキーマが適用されていない。`docker compose down -v && docker compose up -d postgres` で初期化し直す

2. **`duplicate key value violates unique constraint`** — `ON CONFLICT DO NOTHING` で自動スキップされるはず。もし出たら、テーブルにデータが既に入っている。問題なし

3. **`column "xxx" does not exist`** — Supabase のテーブルとスキーマのカラムが一致しない。`01_schema.sql` と Supabase のテーブル定義を比較して修正

---

## Step 3: SERIAL シーケンスのリセット

INSERT で明示的に `id` を指定すると、SERIAL のシーケンスが進まない。
インポート後に全 SERIAL カラムのシーケンスをリセットする必要がある。

```bash
docker compose exec postgres psql -U app open_regime -c "
SELECT setval(pg_get_serial_sequence(t.table_name, t.column_name),
              (SELECT COALESCE(MAX(id), 0) + 1 FROM only information_schema.tables ist
               WHERE ist.table_name = t.table_name), false)
FROM (
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE 'nextval%'
) t;
"
```

上のSQLが複雑すぎて動かない場合は、手動で:

```sql
-- SERIAL テーブル一覧: admin_mfa, admin_mfa_sessions, batch_logs,
-- data_revisions, economic_indicators, economic_indicator_revisions,
-- feature_flags, layer_stress_history, manual_inputs, market_state_history

SELECT setval('admin_mfa_id_seq', COALESCE((SELECT MAX(id) FROM admin_mfa), 0) + 1, false);
SELECT setval('admin_mfa_sessions_id_seq', COALESCE((SELECT MAX(id) FROM admin_mfa_sessions), 0) + 1, false);
SELECT setval('batch_logs_id_seq', COALESCE((SELECT MAX(id) FROM batch_logs), 0) + 1, false);
SELECT setval('data_revisions_id_seq', COALESCE((SELECT MAX(id) FROM data_revisions), 0) + 1, false);
SELECT setval('economic_indicators_id_seq', COALESCE((SELECT MAX(id) FROM economic_indicators), 0) + 1, false);
SELECT setval('economic_indicator_revisions_id_seq', COALESCE((SELECT MAX(id) FROM economic_indicator_revisions), 0) + 1, false);
SELECT setval('feature_flags_id_seq', COALESCE((SELECT MAX(id) FROM feature_flags), 0) + 1, false);
SELECT setval('layer_stress_history_id_seq', COALESCE((SELECT MAX(id) FROM layer_stress_history), 0) + 1, false);
SELECT setval('manual_inputs_id_seq', COALESCE((SELECT MAX(id) FROM manual_inputs), 0) + 1, false);
SELECT setval('market_state_history_id_seq', COALESCE((SELECT MAX(id) FROM market_state_history), 0) + 1, false);
```

---

## Step 4: データ検証

### 行数確認

```bash
docker compose exec postgres psql -U app open_regime -c "
SELECT schemaname, relname AS table_name, n_live_tup AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;
"
```

### 主要テーブルの期待値

| テーブル | 説明 | 期待行数（概算） |
|---------|------|----------------|
| users | ユーザー | 1〜数人 |
| stock_master | 銘柄マスター | 50〜100+ |
| holdings | 保有銘柄 | 数十件 |
| trades | 取引履歴 | 数十〜数百件 |
| fed_balance_sheet | FRBバランスシート | 1,000+ (週次×20年) |
| interest_rates | 金利データ | 5,000+ (日次) |
| credit_spreads | クレジットスプレッド | 5,000+ |
| market_indicators | 市場指標 | 5,000+ |
| economic_indicators | 雇用データ | 数百件 |
| weekly_claims | 週次失業保険 | 1,000+ |
| layer_stress_history | レジーム計算 | 数千件 |
| market_state_history | 市場状態 | 数百件 |

### API エンドポイントで確認

```bash
# 計算API（認証不要）
curl http://localhost/api/regime           # → regime JSON（市場データ必要）
curl http://localhost/api/signal/SPY       # → signal JSON（yfinance + Redis）
curl http://localhost/api/stock/batch-quotes?tickers=SPY  # → quotes

# Go CRUD API（認証不要のエンドポイント）
curl http://localhost/api/stocks           # → stock_master のデータ
curl http://localhost/api/market-state/latest  # → 最新の市場状態
curl http://localhost/api/fx/usdjpy        # → USD/JPY（Yahoo Finance）
```

---

## Step 5: スクリプト化（任意）

エクスポート〜インポート〜検証を一発で実行するスクリプトを `scripts/import-data.sh` として作成:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. Export from Supabase ==="
./scripts/export-supabase.sh

echo ""
echo "=== 2. Import to Docker PostgreSQL ==="
docker compose exec -T postgres psql -U app open_regime < db/seed/seed_data.sql

echo ""
echo "=== 3. Reset SERIAL sequences ==="
docker compose exec postgres psql -U app open_regime -f - <<'SQL'
SELECT setval('admin_mfa_id_seq', COALESCE((SELECT MAX(id) FROM admin_mfa), 0) + 1, false);
SELECT setval('admin_mfa_sessions_id_seq', COALESCE((SELECT MAX(id) FROM admin_mfa_sessions), 0) + 1, false);
SELECT setval('batch_logs_id_seq', COALESCE((SELECT MAX(id) FROM batch_logs), 0) + 1, false);
SELECT setval('data_revisions_id_seq', COALESCE((SELECT MAX(id) FROM data_revisions), 0) + 1, false);
SELECT setval('economic_indicators_id_seq', COALESCE((SELECT MAX(id) FROM economic_indicators), 0) + 1, false);
SELECT setval('economic_indicator_revisions_id_seq', COALESCE((SELECT MAX(id) FROM economic_indicator_revisions), 0) + 1, false);
SELECT setval('feature_flags_id_seq', COALESCE((SELECT MAX(id) FROM feature_flags), 0) + 1, false);
SELECT setval('layer_stress_history_id_seq', COALESCE((SELECT MAX(id) FROM layer_stress_history), 0) + 1, false);
SELECT setval('manual_inputs_id_seq', COALESCE((SELECT MAX(id) FROM manual_inputs), 0) + 1, false);
SELECT setval('market_state_history_id_seq', COALESCE((SELECT MAX(id) FROM market_state_history), 0) + 1, false);
SQL

echo ""
echo "=== 4. Verify row counts ==="
docker compose exec postgres psql -U app open_regime -c "
SELECT relname AS table_name, n_live_tup AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
"

echo ""
echo "=== Done! ==="
```

---

## 注意事項

### 1. users テーブルの auth_provider_id

Supabase 版の `auth_provider_id` は Supabase Auth の UUID（sub クレーム）。
Docker 版では api-go の Google OAuth が新しい `auth_provider_id`（Google のサブジェクトID）を設定する。

→ 既存ユーザーが Docker 環境で初回ログインすると、**email マッチ**で既存レコードに紐付けられる（auth.py / api-go の auth_service.go がこのフローを実装済み）。`auth_provider_id` が Google のものに更新される。

### 2. stock_cache と precomputed_results は空でもOK

キャッシュテーブルなので、API呼び出し時に自動生成される。エクスポートに含まれていても古いデータは不要。

### 3. admin_mfa は Docker 環境で再セットアップが必要

MFA の `secret_enc` は暗号化されており、暗号鍵（`MFA_ENCRYPTION_KEY`）が異なると復号できない。
Docker 環境で同じ鍵を使うか、MFA を再セットアップする必要がある。

### 4. db/seed/ は .gitignore 済み

`seed_data.sql` にはユーザーのメールアドレス等が含まれるため、コミットされない設計。

### 5. 本番 Supabase には影響なし

REST API で読み取りのみ。書き込みは行わない。
