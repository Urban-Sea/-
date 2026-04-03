# VPS Docker 移行 — 実装計画

> 作成日: 2026-03-24
> 設計書: `tasks/vps-docker-design.md`

---

## 全体方針

**「動くシステムを維持しながら段階移行」** — Python API を先に Docker 化し、api-go は1エンドポイントずつ移植・動作確認する。本番の Worker/Cloud Run は VPS デプロイ (Step 8) まで一切触らない。

---

## 依存関係グラフ

```
Step 1 (基盤: compose + DB + データ)
  ├──→ Step 2 (Python API Docker化)  ──→ Step 6 (Batch Docker化)
  ├──→ Step 3 (api-go 骨格 + 認証)   ──→ Step 4 (api-go CRUD 66ep + Stripe)
  └──→ Step 5 (Frontend SSR化)  ← Step 3 の認証完了が必要
                                           ↓
                                      Step 7 (Loki/Grafana) ※低優先
                                           ↓
                                      Step 8 (VPSデプロイ + Worker廃止 + DNS切替)
```

---

## 並列化戦略（複数チャット）

Step 1 完了後、3レーンを並列実行:

| レーン | 担当 Step | 内容 | 推定重さ |
|--------|----------|------|---------|
| **A: Python系** | Step 2 → Step 6 | api-python DB書き換え + Batch Docker化 | 中 |
| **B: Go API** | Step 3 → Step 4 | api-go 骨格 → CRUD 66ep + Stripe 移植 | 重 |
| **C: Frontend** | Step 5 | SSR化 + 認証フロー書き換え + Dockerfile | 中 |

**Step 1 は最初のチャットで完了させる（全ての土台）。**

---

## Step 1: 基盤（docker-compose + DB + テストデータ）

### 目的
ローカルで `docker compose up` → PostgreSQL + Redis + nginx が動き、本番相当のデータで検証できる状態を作る。

### タスク

- [ ] 1-1. Supabase から正確なスキーマを取得
  ```bash
  pg_dump "postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres" \
    --schema=public --schema-only --no-owner --no-privileges \
    > db/init/01_schema_raw.sql
  ```
  - `auth.users` への FK 参照を除去
  - `handle_new_user` トリガー除去（api-go が OAuth で直接ユーザー作成する）
  - Supabase 固有の extension (pgjwt, pgcrypto 等) を標準 PostgreSQL 互換に調整
  - `update_updated_at()` 関数 + トリガーは維持

- [ ] 1-2. スキーマの整理・レビュー → `db/init/01_schema.sql`
  - 全 26 テーブルのカラム、型、デフォルト値、制約を確認
  - RLS ポリシーは削除（セルフホストでは不要、認証は api-go が担当）
  - 必要なインデックスのみ残す
  - `stock_cache` テーブルは廃止検討（Redis に移行）
  - **`manual_inputs` テーブルの確認**: ADP_CHANGE, CHALLENGER_CUTS, TRUFLATION の3指標用（後述「手動データ対応」参照）

- [ ] 1-3. ディレクトリ構造作成
  ```
  docker-compose.yml
  .env.docker (テンプレ、.gitignore に追加)
  nginx/nginx.conf
  nginx/conf.d/default.conf
  db/init/01_schema.sql
  Makefile
  ```

- [ ] 1-4. `docker-compose.yml` 作成（最小構成）
  - postgres, redis, nginx のみ（api-go/api-python は後の Step）
  - `.env.docker` に DB_PASSWORD, JWT_SECRET 等のテンプレ

- [ ] 1-5. nginx 設定（最小構成）
  - `/health` → 200 返すだけ
  - upstream は api-go/api-python が来たら追加

- [ ] 1-6. Supabase からテストデータエクスポート
  - `scripts/export-supabase.sh` を作成
  ```bash
  pg_dump --data-only --schema=public --no-owner --no-privileges \
    > db/seed/seed_data.sql
  ```
  - `db/seed/` を `.gitignore` に追加（個人データ含む）

- [ ] 1-7. 動作確認
  ```bash
  docker compose up -d
  docker compose exec postgres psql -U app open_regime \
    -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
  # → 26 テーブル
  docker compose exec redis redis-cli ping  # → PONG
  curl http://localhost/health               # → 200
  ```

- [ ] 1-8. Makefile 作成
  ```makefile
  up / down / build / db-shell / db-dump / logs
  ```

### init.sql と golang-migrate の関係
- **Step 1 では** `db/init/01_schema.sql` を Docker の `docker-entrypoint-initdb.d` で実行（api-go がまだ存在しないため）
- **Step 3 で** golang-migrate を導入し、`01_schema.sql` の内容を `000001_init.up.sql` にコピー
- **以降の変更は** マイグレーションファイルで管理
- **最終的に** docker-entrypoint の init.sql は空にし、マイグレーションに完全移行

### 成果物
```
docker-compose.yml
.env.docker
nginx/nginx.conf
nginx/conf.d/default.conf
db/init/01_schema.sql
db/seed/                    (.gitignore)
scripts/export-supabase.sh
Makefile
```

---

## Step 2: Python API Docker化 + DB接続書き換え（レーンA）

### 目的
既存の `app/backend/` を Docker 内で動かし、Supabase REST → asyncpg 直接接続に変更。

### タスク

- [ ] 2-1. DB 接続層の作成
  - `app/backend/db.py` 新設: asyncpg プール管理
  - 環境変数: `DB_HOST=postgres, DB_PORT=5432, DB_NAME=open_regime, DB_USER=app`
  - Supabase クライアント呼び出しを asyncpg に置き換え（全ルーター）

- [ ] 2-2. Redis 接続変更
  - Upstash REST API → `redis://redis:6379` 直接接続
  - `redis_cache.py` を修正

- [ ] 2-3. 認証の整理
  - 内部ネットワークからのみアクセスされるので、JWT 検証は簡略化可能
  - ただし `/api/exit/*` 等でユーザー認証が必要なエンドポイントあり
  - nginx が Authorization ヘッダーをそのまま転送 → api-python で検証

- [ ] 2-4. **Sentry SDK 統合確認**
  - 既に導入済み → 環境変数 `SENTRY_DSN` の接続先を確認
  - Docker 環境で動作確認

- [ ] 2-5. Dockerfile 更新
  - ポートを 8081 に変更

- [ ] 2-6. docker-compose.yml に `api-python` サービス追加

- [ ] 2-7. nginx に upstream 追加
  ```
  /api/(signal|regime|exit|stock) → api-python:8081
  ```

- [ ] 2-8. 全計算エンドポイント動作確認
  ```bash
  curl http://localhost/api/regime
  curl http://localhost/api/signal/SPY
  curl http://localhost/api/exit/SPY
  curl http://localhost/api/stock/SPY
  ```

### 引き継ぎ情報（レーンAチャット用）
- 設計書: `tasks/vps-docker-design.md` Section 5
- 対象コード: `app/backend/` 全体
- DB接続の現状: `supabase = create_client(url, key)` → `supabase.table("x").select("*")`
- 変更先: `asyncpg.create_pool(host="postgres", ...)` → `pool.fetch("SELECT * FROM x")`
- Redis の現状: Upstash REST API (`redis_cache.py`)
- 変更先: `redis://redis:6379` 直接接続
- `requirements.txt` に asyncpg は既にある（未使用だった）
- Sentry: 既に導入済み、環境変数のみ確認

---

## Step 3: api-go 骨格 + 認証 + マイグレーション基盤（レーンB）

### 目的
Go プロジェクト初期化、Echo セットアップ、DB接続、JWT認証、Google OAuth、マイグレーションツール導入。

### タスク

- [ ] 3-1. `api-go/` ディレクトリ + Go モジュール初期化
  ```
  api-go/
  ├── cmd/server/main.go
  ├── internal/config/config.go
  ├── internal/middleware/ (auth, cors, ratelimit, security)
  ├── internal/handler/
  ├── internal/model/
  ├── internal/repository/
  ├── internal/service/ (auth_service, mfa_service)
  ├── internal/testutil/    ← テスト用ヘルパー
  ├── migrations/           ← golang-migrate 用
  │   └── 000001_init.up.sql
  │   └── 000001_init.down.sql
  ├── Dockerfile
  └── go.mod
  ```

- [ ] 3-2. **golang-migrate 導入**
  - `db/init/01_schema.sql` の内容を `api-go/migrations/000001_init.up.sql` にコピー
  - `main.go` 起動時に自動マイグレーション実行
  - 以降のスキーマ変更は `000002_xxx.up.sql` で管理
  - docker-compose の postgres entrypoint から init.sql を段階的に外す

- [ ] 3-3. Echo v4 セットアップ + `/health` エンドポイント

- [ ] 3-4. pgx v5 コネクションプール

- [ ] 3-5. JWT 認証ミドルウェア
  - Cookie から JWT 読み取り → HS256 検証 → user_id をコンテキストに

- [ ] 3-6. Google OAuth 実装
  - `GET /api/auth/google` → OAuth 同意画面リダイレクト
  - `GET /api/auth/google/callback` → トークン交換 + ユーザー作成/取得 + JWT 発行
  - `POST /api/auth/refresh` → JWT リフレッシュ
  - `GET /api/auth/me` → ユーザー情報
  - Google Cloud Console で `localhost:8080` を redirect URI に追加

- [ ] 3-7. CORS + セキュリティヘッダー + レート制限ミドルウェア

- [ ] 3-8. **Sentry Go SDK 統合** (5xx のみ即通知 + スタックトレース)

- [ ] 3-9. Dockerfile（multi-stage: build → distroless）

- [ ] 3-10. docker-compose.yml に `api-go` サービス追加

- [ ] 3-11. `/api/me` (GET/PATCH) を最初の CRUD として実装

- [ ] 3-12. **テスト基盤の構築**
  - `internal/testutil/`: テスト用 DB セットアップ (テスト用 PostgreSQL コンテナ)、テスト用 JWT 生成
  - repository 層: テーブル駆動テスト（実DB接続、テスト後ロールバック）
  - handler 層: httptest でリクエスト/レスポンスの検証
  - `/api/me` のテストを最初のサンプルとして書く

### 確認基準
```bash
# Google OAuth でログイン → JWT Cookie 取得 → /api/me が返る
# go test ./... が全て PASS
```

### 引き継ぎ情報（レーンBチャット用）
- 設計書: `tasks/vps-docker-design.md` Section 4 (api-go 設計全体)
- 移植元: `app/worker/src/routes/` (TypeScript CRUD ロジック)
- 認証参考: `app/backend/auth.py` (JWT 検証ロジック)
- DB スキーマ: `db/init/01_schema.sql`
- エンドポイント一覧: 設計書 Section 4 の 66ep + Stripe 4ep
- golang-migrate: `api-go/migrations/` で管理、起動時に自動実行

---

## Step 4: api-go CRUD 移植 + Stripe（レーンB、最重量）

### 目的
Worker の CRUD ロジックを Go に移植。本番 Worker は触らない（VPS デプロイ時にまとめて廃止）。

### 移植順序（小 → 大）
1. `/api/me` (2ep) — Step 3 で完了
2. `/api/fx/usdjpy` (1ep)
3. `/api/stocks` (3ep)
4. `/api/market-state/*` (3ep)
5. `/api/watchlist/*` (6ep)
6. `/api/trades/*` (6ep)
7. `/api/holdings/*` (15ep) — 最大
8. `/api/liquidity/*` (12ep) — DB SELECT のみ
9. `/api/employment/*` (5ep) — DB SELECT のみ
10. `/api/admin/*` (8ep) + `/api/admin/mfa/*` (5ep)
11. **`/api/billing/*` (4ep) — Stripe 連携**（設計書 Section 9）
    - `POST /api/billing/create-checkout`
    - `POST /api/billing/webhook`（Stripe 署名検証、認証不要）
    - `GET /api/billing/portal`（Stripe Customer Portal）
    - `POST /api/billing/cancel`

### 各エンドポイントの移植手順（繰り返し）
1. Worker (`app/worker/src/routes/`) のロジックを読む
2. Go の model → repository → handler を書く
3. **テーブル駆動テストを書く**（handler + repository）
4. `docker compose restart api-go`
5. curl + テストで動作確認
6. nginx ルーティングに追加（該当パスを api-go に向ける）

### テスト方針
- 各 handler にテーブル駆動テスト (Table-Driven Test) を必ず書く
- repository 層は実 DB (テスト用 PostgreSQL) に接続してテスト
- handler 層は httptest + テスト DB
- `go test ./...` が CI で全 PASS することを確認基準に

### 重要
- **本番 Worker からルートを削除しない**。ローカル Docker で Go 版が動くことの確認のみ
- Worker の廃止は Step 8 (VPS デプロイ + DNS 切替) でまとめて行う

### 確認基準
- 全 70 エンドポイント（66 + Stripe 4）が api-go 経由で動作
- `go test ./...` が全 PASS
- ローカルで Stripe webhook テスト済み（stripe CLI の listen モード）

---

## Step 5: Frontend SSR化（レーンC）

### 目的
static export → SSR に変更、認証フローを Cookie JWT に切り替え、Dockerfile 作成。

### タスク（細かく分解）

#### Phase A: SSR化（api-go の認証不要、先行着手可能）
- [ ] 5-1. `next.config.ts` から `output: 'export'` 削除
- [ ] 5-2. `images.unoptimized: true` 削除（Image Optimization 有効化）
- [ ] 5-3. API URL を相対パス (`/api/...`) に変更
  - 現状: `NEXT_PUBLIC_API_URL=https://api.open-regime.com` + fetch
  - 確認必要: データフェッチが既に `/api/...` 形式なら URL 変数を空にするだけ
- [ ] 5-4. SEO: metadata, sitemap.ts, robots.ts
- [ ] 5-5. GA4 統合
- [ ] 5-6. **Sentry JS SDK 確認** — 既に導入済み → Docker 環境で動作確認
- [ ] 5-7. Dockerfile（multi-stage: deps → build → runner）
- [ ] 5-8. docker-compose.yml に `frontend` サービス追加

#### Phase B: 認証フロー書き換え（Step 3 の認証完了後）
- [ ] 5-9. Supabase Auth SDK (`@supabase/supabase-js`) の認証依存を除去
  - ログイン: `supabase.auth.signInWithOAuth()` → `window.location = '/api/auth/google'`
  - セッション: `supabase.auth.getSession()` → Cookie 自動送信（変更不要）
  - ログアウト: `supabase.auth.signOut()` → `POST /api/auth/logout`（Cookie 削除）
  - コールバック: `/auth/callback` ページの書き換え
- [ ] 5-10. SWR の fetcher を修正
  - Authorization ヘッダー手動付与 → Cookie 自動送信（fetch の credentials: 'include'）
  - Supabase JS SDK のデータフェッチ (`supabase.from()`) を使っている箇所があれば fetch に置換
- [ ] 5-11. 認証状態管理の書き換え
  - Supabase の `onAuthStateChange` → `/api/auth/me` ポーリング or Cookie 有無チェック

#### Phase C: admin-frontend
- [ ] 5-12. admin-frontend も同様に SSR化 + Dockerfile
- [ ] 5-13. docker-compose.yml に `admin-frontend` サービス追加

### 確認基準
```bash
curl http://localhost/
# → SSR された HTML（<meta> タグ、OGP 含む）
# Google OAuth ログイン → ダッシュボード表示 → データ取得
```

### 引き継ぎ情報（レーンCチャット用）
- 対象コード: `app/frontend/`, `app/admin-frontend/`
- 現状の認証: Supabase JS SDK (`@supabase/supabase-js`)
- 変更先: Cookie ベース JWT（api-go が発行）
- 現状のデータフェッチ: 要確認（SWR + fetch? or supabase.from()? ）
- next.config.ts の変更点: output 削除、images 変更
- nginx ルーティング: `/*` → frontend:3000, admin は admin-frontend:3002
- Sentry: 既に導入済み

---

## Step 6: Batch Docker化（レーンA）

### タスク

- [ ] 6-1. `app/batch/` の DB 接続を psycopg2 直接に変更
  - `supabase = create_client(url, key)` → `psycopg2.connect(host="postgres", ...)`
  - `db.py` の `batch_upsert()` を SQL ベースに書き換え

- [ ] 6-2. `manual_input.py` の DB 接続も psycopg2 に変更
  - ADP_CHANGE, CHALLENGER_CUTS, TRUFLATION の手動入力 CLI が動くこと

- [ ] 6-3. Batch Dockerfile 作成

- [ ] 6-4. 動作確認
  ```bash
  docker compose run --rm batch python run.py --daily
  docker compose run --rm batch python run.py --weekly
  docker compose run --rm batch python manual_input.py list
  ```

- [ ] 6-5. `r2-uploader/` スクリプト作成
  - `pg_dump → gzip → ファイル出力` まで確認
  - R2 実アップロードは VPS 契約後

- [ ] 6-6. r2-uploader Dockerfile 作成

---

## Step 7: Loki + Grafana（低優先）

- [ ] 7-1. Loki コンテナ + config
- [ ] 7-2. Promtail コンテナ + config
- [ ] 7-3. Grafana コンテナ + Loki datasource 自動設定
- [ ] 7-4. nginx に grafana upstream 追加

---

## Step 8: VPS デプロイ + DNS 切替（最後）

### タスク

- [ ] 8-1. ConoHa VPS 契約 (4GB)
- [ ] 8-2. Docker + Docker Compose インストール
- [ ] 8-3. ufw + SSH 鍵認証設定
- [ ] 8-4. リポジトリ clone + `.env` 配置
- [ ] 8-5. Supabase → セルフホスト PostgreSQL データ移行
  ```bash
  pg_dump --data-only --schema=public ... > migration_data.sql
  docker compose exec -T postgres psql -U app open_regime < migration_data.sql
  ```
- [ ] 8-6. `docker compose up -d` → 全コンテナ起動確認
- [ ] 8-7. CF DNS 設定 (A レコード → VPS IP, Proxy mode)
- [ ] 8-8. CF Access 設定 (admin, grafana)
- [ ] 8-9. Google OAuth redirect URI を VPS ドメインに変更
- [ ] 8-10. Stripe webhook URL を VPS ドメインに変更
- [ ] 8-11. GitHub Actions デプロイ workflow 設定
- [ ] 8-12. crontab 設定 (batch, r2-uploader)
- [ ] 8-13. 本番稼働確認（全機能 E2E チェック）
- [ ] 8-14. **Worker を無効化（DNS 切替後 72 時間は維持、問題時に即復帰可能な状態にしておく）**
- [ ] 8-15. **Cloud Run サービスを停止（同様に 72 時間の猶予期間を設ける）**
- [ ] 8-16. 72 時間後、問題なければ Worker / Cloud Run / Supabase を完全廃止

### ロールバック計画
DNS 切替後に問題が発生した場合:
1. **即時**: CF DNS の A レコードを元に戻す（Worker/Cloud Run に復帰）→ 数分で反映
2. **Worker は 72 時間は無効化のみ**（削除しない）→ 再有効化で即復帰
3. **Cloud Run も 72 時間は停止のみ**（削除しない）→ 再デプロイで即復帰
4. **Supabase DB は VPS 移行後もしばらく読み取り可能な状態を維持**
5. 完全廃止は本番稼働が安定したことを確認してから（最低 1 週間後）

---

## 手動データ対応 (将来 TODO)

### 現状
`manual_inputs` テーブルに CLI (`manual_input.py`) で手動入力している3指標:

| 指標 | 理由 | 用途 |
|------|------|------|
| **ADP_CHANGE** | FRED の ADPWNUSNERSA は更新遅延あり | 雇用乖離スコア (weight 0.6) |
| **CHALLENGER_CUTS** | 公開 API なし | 雇用乖離スコア (weight 0.8) |
| **TRUFLATION** | API 有料 | インフレ乖離スコア (5pts) |

### 今後の改善案（移行完了後に検討）
- [ ] ADP: FRED の遅延が許容できるなら自動取得に切り替え (`ADPWNUSNERSA`)
- [ ] Challenger: スクレイピング or RSS で半自動化を検討
- [ ] Truflation: 無料 API が出たら自動化、なければ現状維持
- [ ] Admin 画面に手動入力 UI を作る（CLI → Web UI 化）
  - `admin-frontend` に `/admin/manual-inputs` ページ追加
  - api-go に `POST /api/admin/manual-inputs` エンドポイント追加

---

## DB 設計メモ

### 現状の問題点
- **〜19 テーブルに CREATE TABLE 文がない**（Supabase Dashboard で作成）
- カラムの正確な型・デフォルト値はコードからの推測のみ
- `auth.users` への FK 依存がある（holdings, trades は既に TEXT 型に変更済み）

### Step 1-1 で `pg_dump --schema-only` が最重要
Supabase から正確なスキーマを取得することで:
- 型の不一致を防ぐ
- 見落としたカラムを発見
- インデックスと制約を正確に再現

### テーブル一覧 (26テーブル)

| カテゴリ | テーブル | 主な操作 |
|---------|---------|---------|
| **ユーザー・認証** | users, admin_mfa, admin_mfa_sessions | CRUD |
| **ポートフォリオ** | holdings, trades, cash_balances, user_watchlists, portfolio_snapshots | CRUD |
| **株マスタ** | stock_master | SELECT |
| **流動性マクロ** | fed_balance_sheet, interest_rates, credit_spreads, market_indicators, bank_sector, srf_usage, margin_debt, mmf_assets | SELECT + UPSERT(batch) |
| **市場状態** | market_state_history, layer_stress_history | SELECT + INSERT |
| **雇用統計** | economic_indicators, economic_indicator_revisions, weekly_claims, manual_inputs | SELECT + UPSERT(batch) |
| **管理・ログ** | admin_audit_logs, batch_logs, feature_flags, data_revisions | SELECT + INSERT |
| **キャッシュ** | precomputed_results, stock_cache(廃止候補) | UPSERT + DELETE |

### セルフホストで不要になるもの
- RLS ポリシー全て（認証は api-go のミドルウェアで制御）
- `auth.users` テーブルと `handle_new_user` トリガー
- Supabase 固有の extension (pgjwt 等)
