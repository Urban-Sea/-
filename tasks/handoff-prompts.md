# VPS移行 — チャット引き継ぎプロンプト

各レーンの新しいチャットに、該当セクションの ``` 内をそのままコピペしてください。

---

## レーンA: Step 2 → Step 6 (Python API Docker化 + Batch)

```
VPS Docker移行のStep 2 (Python API Docker化) を実行してください。
完了後、続けて Step 6 (Batch Docker化) も実行してください。

## 全体方針
「動くシステムを維持しながら段階移行」 — Python API を先に Docker 化し、api-go は1エンドポイントずつ移植・動作確認する。本番の Worker/Cloud Run は VPS デプロイ (Step 8) まで一切触らない。

## 依存関係グラフ
Step 1 (基盤: compose + DB + データ) ← 完了済み
  ├──→ Step 2 (Python API Docker化)  ──→ Step 6 (Batch Docker化)  ← このレーン
  ├──→ Step 3 (api-go 骨格 + 認証)   ──→ Step 4 (api-go CRUD 66ep + Stripe)
  └──→ Step 5 (Frontend SSR化)  ← Step 3 の認証完了が必要

## 現在の状態
Step 1 完了済み。ローカルで `DB_PASSWORD=changeme_local_dev docker compose up -d` で PostgreSQL (30テーブル+実データ40k行) + Redis + nginx が動いています。

## 読むべきファイル（必ず最初に全部読んで）
1. `tasks/vps-migration-plan.md` — Step 2, Step 6 セクション（タスク詳細）
2. `tasks/vps-docker-design.md` — Section 5 (api-python 設計)
3. `app/backend/main.py` — 現在のエントリーポイント
4. `app/backend/auth.py` — 認証ロジック
5. `app/backend/redis_cache.py` — Upstash Redis 接続（書き換え対象）
6. `app/backend/requirements.txt` — asyncpg は既にある
7. `app/backend/Dockerfile` — 既存、ポート変更が必要
8. `docker-compose.yml` — api-python サービスを追加する
9. `nginx/conf.d/default.conf` — api-python upstream を有効化する
10. `db/init/01_schema.sql` — 全30テーブルのスキーマ定義

---

## Step 2: Python API Docker化 + DB接続書き換え

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

- [ ] 2-4. Sentry SDK 統合確認
  - 既に導入済み → 環境変数 `SENTRY_DSN` の接続先を確認
  - Docker 環境で動作確認

- [ ] 2-5. Dockerfile 更新
  - ポートを 8081 に変更（api-go が 8080 を使う）

- [ ] 2-6. docker-compose.yml に `api-python` サービス追加

- [ ] 2-7. nginx に upstream 追加
  /api/(signal|regime|exit|stock) → api-python:8081

- [ ] 2-8. 全計算エンドポイント動作確認
  curl http://localhost/api/regime
  curl http://localhost/api/signal/SPY
  curl http://localhost/api/exit/SPY
  curl http://localhost/api/stock/SPY

### DB接続の変更
- 現在: `supabase = create_client(url, key)` → `supabase.table("x").select("*").execute()`
- 変更先: `asyncpg.create_pool(host="postgres", port=5432, database="open_regime", user="app", password=DB_PASSWORD)`
- `requirements.txt` に asyncpg は既にある（未使用だった）

### Redis接続の変更
- 現在: Upstash REST API (redis_cache.py)
- 変更先: redis://redis:6379 直接接続

---

## Step 6: Batch Docker化（Step 2 完了後）

### タスク

- [ ] 6-1. `app/batch/` の DB 接続を psycopg2 直接に変更
  - `supabase = create_client(url, key)` → `psycopg2.connect(host="postgres", ...)`
  - `db.py` の `batch_upsert()` を SQL ベースに書き換え

- [ ] 6-2. `manual_input.py` の DB 接続も psycopg2 に変更
  - ADP_CHANGE, CHALLENGER_CUTS, TRUFLATION の手動入力 CLI が動くこと

- [ ] 6-3. Batch Dockerfile 作成

- [ ] 6-4. 動作確認
  docker compose run --rm batch python run.py --daily
  docker compose run --rm batch python run.py --weekly
  docker compose run --rm batch python manual_input.py list

- [ ] 6-5. `r2-uploader/` スクリプト作成
  - `pg_dump → gzip → ファイル出力` まで確認
  - R2 実アップロードは VPS 契約後

- [ ] 6-6. r2-uploader Dockerfile 作成

### 注意点
- CRUD ルーターは残す（Step 4 で api-go に段階移行するまで Python 側で動かす）
- 本番の Worker/Cloud Run は一切触らない
```

---

## レーンB: Step 3 → Step 4 (api-go 骨格 + CRUD移植)

```
VPS Docker移行の Step 3 (api-go 骨格 + 認証) を実行し、完了後 Step 4 (CRUD 66ep + Stripe 移植) に進んでください。

## 全体方針
「動くシステムを維持しながら段階移行」 — Python API を先に Docker 化し、api-go は1エンドポイントずつ移植・動作確認する。本番の Worker/Cloud Run は VPS デプロイ (Step 8) まで一切触らない。

## 依存関係グラフ
Step 1 (基盤: compose + DB + データ) ← 完了済み
  ├──→ Step 2 (Python API Docker化)  ──→ Step 6 (Batch Docker化)
  ├──→ Step 3 (api-go 骨格 + 認証)   ──→ Step 4 (api-go CRUD 66ep + Stripe)  ← このレーン
  └──→ Step 5 (Frontend SSR化)  ← Step 3 の認証完了が必要

## 現在の状態
Step 1 完了済み。ローカルで `DB_PASSWORD=changeme_local_dev docker compose up -d` で PostgreSQL (30テーブル+実データ40k行) + Redis + nginx が動いています。

## 読むべきファイル（必ず最初に全部読んで）
1. `tasks/vps-migration-plan.md` — Step 3, Step 4 セクション（タスク詳細）
2. `tasks/vps-docker-design.md` — Section 4 (api-go 設計: ディレクトリ構成、認証フロー、全エンドポイント一覧)
3. `tasks/vps-docker-design.md` — Section 9 (Stripe 連携設計)
4. `app/worker/src/routes/` — 全12ファイル（移植元の TypeScript CRUD ロジック）
5. `app/worker/src/lib/` — DB/認証/キャッシュのユーティリティ
6. `app/backend/auth.py` — JWT 検証ロジック（参考）
7. `db/init/01_schema.sql` — 全30テーブルのスキーマ定義
8. `docker-compose.yml` — api-go サービスを追加する
9. `nginx/conf.d/default.conf` — api-go upstream を有効化する

---

## Step 3: api-go 骨格 + 認証 + マイグレーション基盤

### 目的
Go プロジェクト初期化、Echo セットアップ、DB接続、JWT認証、Google OAuth、マイグレーションツール導入。

### タスク

- [ ] 3-1. `api-go/` ディレクトリ + Go モジュール初期化
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

- [ ] 3-2. golang-migrate 導入
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

- [ ] 3-8. Sentry Go SDK 統合 (5xx のみ即通知 + スタックトレース)

- [ ] 3-9. Dockerfile（multi-stage: build → distroless）

- [ ] 3-10. docker-compose.yml に `api-go` サービス追加

- [ ] 3-11. `/api/me` (GET/PATCH) を最初の CRUD として実装

- [ ] 3-12. テスト基盤の構築
  - `internal/testutil/`: テスト用 DB セットアップ (テスト用 PostgreSQL コンテナ)、テスト用 JWT 生成
  - repository 層: テーブル駆動テスト（実DB接続、テスト後ロールバック）
  - handler 層: httptest でリクエスト/レスポンスの検証
  - `/api/me` のテストを最初のサンプルとして書く

### init.sql と golang-migrate の関係
- Step 1 では `db/init/01_schema.sql` を Docker の `docker-entrypoint-initdb.d` で実行（api-go がまだ存在しないため）
- Step 3 で golang-migrate を導入し、`01_schema.sql` の内容を `000001_init.up.sql` にコピー
- 以降の変更はマイグレーションファイルで管理
- 最終的に docker-entrypoint の init.sql は空にし、マイグレーションに完全移行

### 確認基準
Google OAuth でログイン → JWT Cookie 取得 → /api/me が返る
go test ./... が全て PASS

---

## Step 4: api-go CRUD 移植 + Stripe（最重量）

### 目的
Worker の CRUD ロジックを Go に移植。本番 Worker は触らない（VPS デプロイ時にまとめて廃止）。

### 移植順序（小 → 大）
1. /api/me (2ep) — Step 3 で完了
2. /api/fx/usdjpy (1ep)
3. /api/stocks (3ep)
4. /api/market-state/* (3ep)
5. /api/watchlist/* (6ep)
6. /api/trades/* (6ep)
7. /api/holdings/* (15ep) — 最大
8. /api/liquidity/* (12ep) — DB SELECT のみ
9. /api/employment/* (5ep) — DB SELECT のみ
10. /api/admin/* (8ep) + /api/admin/mfa/* (5ep)
11. /api/billing/* (4ep) — Stripe 連携（設計書 Section 9）
    - POST /api/billing/create-checkout
    - POST /api/billing/webhook（Stripe 署名検証、認証不要）
    - GET /api/billing/portal（Stripe Customer Portal）
    - POST /api/billing/cancel

### 各エンドポイントの移植手順（繰り返し）
1. Worker (`app/worker/src/routes/`) のロジックを読む
2. Go の model → repository → handler を書く
3. テーブル駆動テストを書く（handler + repository）
4. `docker compose restart api-go`
5. curl + テストで動作確認
6. nginx ルーティングに追加（該当パスを api-go に向ける）

### テスト方針
- 各 handler にテーブル駆動テスト (Table-Driven Test) を必ず書く
- repository 層は実 DB (テスト用 PostgreSQL) に接続してテスト
- handler 層は httptest + テスト DB
- `go test ./...` が CI で全 PASS することを確認基準に

### 重要
- 本番 Worker からルートを削除しない。ローカル Docker で Go 版が動くことの確認のみ
- Worker の廃止は Step 8 (VPS デプロイ + DNS 切替) でまとめて行う

### DB テーブル一覧 (30テーブル、参考)
| カテゴリ | テーブル | 主な操作 |
|---------|---------|---------|
| ユーザー・認証 | users, user_settings, admin_mfa, admin_mfa_sessions | CRUD |
| ポートフォリオ | holdings, trades, cash_balances, user_watchlists, portfolio_snapshots | CRUD |
| 株マスタ | stock_master | SELECT |
| 流動性マクロ | fed_balance_sheet, interest_rates, credit_spreads, market_indicators, bank_sector, srf_usage, margin_debt, mmf_assets | SELECT + UPSERT(batch) |
| 市場状態 | market_state_history, layer_stress_history | SELECT + INSERT |
| 雇用統計 | economic_indicators, economic_indicator_revisions, weekly_claims, manual_inputs | SELECT + UPSERT(batch) |
| 管理・ログ | admin_audit_logs, batch_logs, feature_flags, data_revisions | SELECT + INSERT |
| キャッシュ | precomputed_results, stock_cache | UPSERT + DELETE |

### 確認基準
- 全 70 エンドポイント（66 + Stripe 4）が api-go 経由で動作
- `go test ./...` が全 PASS
- ローカルで Stripe webhook テスト済み（stripe CLI の listen モード）
```

---

## レーンC: Step 5 (Frontend SSR化)

```
VPS Docker移行の Step 5 (Frontend SSR化) を実行してください。
Phase A は先行着手可能。Phase B は Step 3 (api-go の認証) の完了を待ってから進めてください。

## 全体方針
「動くシステムを維持しながら段階移行」 — Python API を先に Docker 化し、api-go は1エンドポイントずつ移植・動作確認する。本番の Worker/Cloud Run は VPS デプロイ (Step 8) まで一切触らない。

## 依存関係グラフ
Step 1 (基盤: compose + DB + データ) ← 完了済み
  ├──→ Step 2 (Python API Docker化)  ──→ Step 6 (Batch Docker化)
  ├──→ Step 3 (api-go 骨格 + 認証)   ──→ Step 4 (api-go CRUD 66ep + Stripe)
  └──→ Step 5 (Frontend SSR化)  ← このレーン（Phase B は Step 3 の認証完了が必要）

## 現在の状態
Step 1 完了済み。ローカルで `DB_PASSWORD=changeme_local_dev docker compose up -d` で PostgreSQL (30テーブル+実データ40k行) + Redis + nginx が動いています。

## 読むべきファイル（必ず最初に全部読んで）
1. `tasks/vps-migration-plan.md` — Step 5 セクション（タスク詳細、Phase A/B/C 分解）
2. `tasks/vps-docker-design.md` — Section 8 (Frontend 設計変更: SSR, API URL, SEO, GA4)
3. `app/frontend/next.config.ts` — output: 'export' を削除する
4. `app/frontend/package.json` — 依存関係確認
5. `app/frontend/src/` — ページ構成、認証フロー、データフェッチ方法を確認
6. `app/frontend/.env.local` — NEXT_PUBLIC_API_URL の変更
7. `app/admin-frontend/` — 同様の構成
8. `docker-compose.yml` — frontend, admin-frontend サービスを追加する
9. `nginx/conf.d/default.conf` — frontend upstream を有効化する

---

## Step 5: Frontend SSR化

### 目的
static export → SSR に変更、認証フローを Cookie JWT に切り替え、Dockerfile 作成。

### Phase A: SSR化（api-go の認証不要、先行着手可能）

- [ ] 5-1. `next.config.ts` から `output: 'export'` 削除
- [ ] 5-2. `images.unoptimized: true` 削除（Image Optimization 有効化）
- [ ] 5-3. API URL を相対パス (`/api/...`) に変更
  - 現状: `NEXT_PUBLIC_API_URL=https://api.open-regime.com` + fetch
  - 確認必要: データフェッチが既に `/api/...` 形式なら URL 変数を空にするだけ
- [ ] 5-4. SEO: metadata, sitemap.ts, robots.ts
- [ ] 5-5. GA4 統合
- [ ] 5-6. Sentry JS SDK 確認 — 既に導入済み → Docker 環境で動作確認
- [ ] 5-7. Dockerfile（multi-stage: deps → build → runner）
- [ ] 5-8. docker-compose.yml に `frontend` サービス追加

### Phase B: 認証フロー書き換え（Step 3 の認証完了後）

⚠️ これが最も重い作業。まずコードを読んで、Supabase SDK がどこでどう使われているか把握してから着手すること。

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

### Phase C: admin-frontend

- [ ] 5-12. admin-frontend も同様に SSR化 + Dockerfile
- [ ] 5-13. docker-compose.yml に `admin-frontend` サービス追加

### nginx ルーティング
- `/*` → frontend:3000
- admin は admin-frontend:3002

### 現状の認証（書き換え対象）
- Supabase JS SDK (`@supabase/supabase-js`) で認証
- 変更先: Cookie ベース JWT（api-go が発行）
- データフェッチ: 要確認（SWR + fetch? or supabase.from()? ）

### 確認基準
curl http://localhost/
→ SSR された HTML（<meta> タグ、OGP 含む）

Phase B 完了後:
Google OAuth ログイン → ダッシュボード表示 → データ取得
```
