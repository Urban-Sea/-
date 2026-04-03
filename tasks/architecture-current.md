# 現行アーキテクチャ図 (2026-04-03 更新)

## 1. 本番稼働中 (現在ユーザーに提供中)

```
ブラウザ
  │
  ├── open-regime.com ──→ CF Pages (static export)
  │                        Next.js フロントエンド
  │                        認証: Supabase Auth (Google OAuth)
  │
  ├── api.open-regime.com ──→ CF Workers (TypeScript)
  │                            CRUD 66ep + Stripe
  │                            DB: Supabase REST API → PostgreSQL (SaaS)
  │                            Cache: Upstash Redis (REST)
  │
  ├── Cloud Run (Python + FastAPI)
  │    計算API: /signal, /regime, /exit, /stock
  │    DB: Supabase REST API
  │    Cache: Upstash Redis (REST)
  │
  ├── open-regime-admin.pages.dev ──→ CF Pages (static export)
  │    CF Access で保護
  │
  └── GitHub Actions
       バッチ: 日次/週次
       ⚠ Supabase SDK 削除済みのため現在動作しない (後述)
```

### 本番の依存関係
- **Supabase**: PostgreSQL + Auth + REST API
- **Cloudflare**: Pages, Workers, DNS, SSL, Access
- **Upstash**: Redis (REST)
- **Google Cloud Run**: Python API
- **Stripe**: 決済
- **Resend**: メール送信
- **Sentry**: エラー監視

---

## 2. Docker化済み (Lane A/B/B2/C で構築、未デプロイ)

```
                    Cloudflare (DNS / SSL / CDN)
                         │
                         ▼ :80
┌──────────────────────────────────────────────────────────┐
│  VPS (予定: Sakura 4vCPU/8GB)                            │
│                                                          │
│  ┌─────────┐                                             │
│  │  nginx   │ :80  リバースプロキシ                        │
│  └────┬─────┘                                             │
│       │                                                   │
│       ├── /api/(signal|regime|exit|stock) ──→ api-python :8081
│       │   Python + FastAPI                                │
│       │   DB: asyncpg → PostgreSQL (TCP直接)              │
│       │   Cache: redis pkg → Redis (TCP直接)              │
│       │   デュアルパス: DB_HOST有→asyncpg / 無→Supabase SDK│
│       │                                                   │
│       ├── /api/* ──→ api-go :8080                         │
│       │   Go + Echo v4 (55ファイル, 13,166行)             │
│       │   CRUD 75ep + Auth + Stripe + MFA                 │
│       │   DB: pgx → PostgreSQL (TCP直接)                  │
│       │   Cache: go-redis → Redis (TCP直接)               │
│       │   認証: Google OAuth → JWT (HttpOnly Cookie)      │
│       │   マイグレーション: golang-migrate (起動時自動)     │
│       │                                                   │
│       ├── /admin/* ──→ admin-frontend :3002                │
│       │   Next.js 15 SSR (standalone, basePath: /admin)   │
│       │   Cookie JWT 認証 + MFA トークン                  │
│       │                                                   │
│       └── / ──→ frontend :3000                            │
│           Next.js 15 SSR (standalone)                     │
│           Cookie JWT 認証 (Supabase Auth 完全除去済み)     │
│                                                          │
│  ┌──────────────┐  ┌───────────┐                         │
│  │ PostgreSQL 16 │  │  Redis 7   │                        │
│  │  :5432        │  │  :6379     │                        │
│  │  DB: open_regime│ │  100MB LRU │                       │
│  │  User: app    │  │            │                        │
│  └──────────────┘  └───────────┘                         │
│                                                          │
│  batch (profiles: [tools], オンデマンド実行)               │
│    DB: psycopg2 → PostgreSQL (TCP直接)                    │
│    Supabase SDK 完全削除済み → Docker専用                  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 各レーンの完了状況

### Lane A: Python API + Batch Docker化 ✅ 完了
| 項目 | 状態 | 備考 |
|------|------|------|
| api-python Dockerfile | ✅ | ポート 8081 |
| asyncpg 直接接続 | ✅ | デュアルパス (Cloud Run互換) |
| redis 直接接続 | ✅ | Upstash フォールバック付き |
| batch psycopg2 化 | ✅ | Supabase SDK 完全削除 |
| batch Dockerfile | ✅ | context=リポジトリルート |

### Lane B: Go CRUD API 構築 ✅ 完了
| 項目 | 状態 | 備考 |
|------|------|------|
| Echo v4 骨格 | ✅ | 55ファイル, 13,166行 |
| CRUD 75ep 移植 | ✅ | CF Workers から移植 |
| Google OAuth + JWT | ✅ | HttpOnly Cookie |
| Stripe 統合 | ✅ | Webhook含む |
| Admin MFA (TOTP) | ✅ | AES-256-GCM |
| golang-migrate | ✅ | 起動時自動、init SQL と同一内容で衝突なし |
| 計算ロジック移植 | ✅ | 精度検証済み (±0.01 以内)、pgtype.Numeric バグ修正済み |
| テストカバレッジ | ⚠️ | 最小限 (3ファイル) |

### Lane B Phase 2: フロントエンド認証書き換え ✅ 完了 (2026-04-03)
| 項目 | 状態 | 備考 |
|------|------|------|
| api-go ValidateJWTForRefresh | ✅ | iat ベース 7日間 refresh |
| メインFE Supabase 除去 | ✅ | `grep -r "supabase"` 残留ゼロ |
| メインFE Cookie JWT 化 | ✅ | fetchAPI + SWR + UserProvider |
| Admin FE Cookie JWT 化 | ✅ | X-User-Email 廃止、Cookie + MFA トークン |
| 不要ページ削除 | ✅ | register, reset-password, update-password, auth/verify |
| @supabase/supabase-js | ✅ | 両 FE から完全削除 |

### Lane C: Frontend SSR化 ✅ 完了
| 項目 | 状態 | 備考 |
|------|------|------|
| standalone ビルド | ✅ | frontend + admin |
| Dockerfile | ✅ | multi-stage, 非root |
| API URL 相対パス化 | ✅ | CORS不要 (同一オリジン) |
| SEO (sitemap, robots) | ✅ | |
| GA4 コード埋め込み | ✅ | プロパティ未作成 |
| admin nginx routing | ✅ | `/admin/` → admin-frontend:3002 |
| admin basePath | ✅ | `basePath: '/admin'` 設定済み |

### データ移行 ✅ 準備完了
| 項目 | 状態 | 備考 |
|------|------|------|
| export-supabase.sh | ✅ | 30テーブル、FK順序、ページネーション対応 |
| seed_data.sql | ✅ | 9.2MB, 40,784行 (2026-03-26 エクスポート) |
| handoff-data-migration.md | ✅ | 手順書完備 |
| db/init/01_schema.sql | ✅ | 26テーブル、Docker初回起動で自動適用 |
| seed 自動インポート | ❌ | 手動 `psql < seed_data.sql` が必要 |

---

## 4. 残っている問題

### 要対応

1. **本番環境変数の設定** (VPS デプロイ時に対応)
   - `.env` の `JWT_SECRET` と `DB_PASSWORD` がプレースホルダー値
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 未設定 (OAuth 動作しない)
   - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` 未設定

### 解消済み (2026-04-04)

| 旧問題 | 解消内容 |
|--------|---------|
| GH Actions batch が壊れている | schedule 無効化 (workflow_dispatch のみ)、VPS cron に切り替え予定。env を DB_HOST 系に更新済み |
| Go 計算ロジック精度未検証 | 精度検証合格 (±0.01 以内)。pgtype.Numeric 型変換バグを修正。詳細: `tasks/go-python-precision-results.md` |

### 解消済み (旧ドキュメントでの「致命的問題」)

| 旧問題 | 解消タイミング | 備考 |
|--------|-------------|------|
| 認証フローが繋がっていない | B2 (2026-04-03) | Cookie JWT 完全移行 |
| DB にデータがない | データ移行準備完了 | seed_data.sql 9.2MB |
| admin nginx routing 未設定 | B2 (2026-04-03) | `/admin/` location 追加 |
| golang-migrate vs init SQL 衝突 | 確認の結果問題なし | 両ファイル同一内容 |
| E2E employment/overview 500 | 2026-04-04 | DateOnly 型に修正 |
| auth_provider_id 移行問題 | 2026-04-04 | ログイン時に自動更新するよう修正 |
| golang-migrate vs init SQL 衝突 | 確認の結果問題なし | 両ファイル同一内容 |

---

## 5. 本番 vs Docker の対応表

| 機能 | 本番 (稼働中) | Docker (構築済み) | ギャップ |
|------|-------------|-----------------|---------|
| フロントエンド | CF Pages (static) | Next.js SSR (standalone) | ✅ 認証含め完成 |
| CRUD API | CF Workers (TS) | api-go (Go, 75ep) | ✅ 精度検証済み |
| 計算 API | Cloud Run (Python) | api-python (Python) | ✅ デュアルパスOK |
| 認証 | Supabase Auth | Google OAuth + JWT Cookie | ✅ FE 書き換え完了 |
| DB | Supabase PostgreSQL | セルフホスト PostgreSQL | ✅ seed 準備済み |
| Cache | Upstash Redis (REST) | セルフホスト Redis (TCP) | ✅ |
| バッチ | GitHub Actions + Supabase | Docker batch + psycopg2 | ✅ GH Actions schedule 無効化、VPS cron に切り替え予定 |
| メール | Resend | (未実装) | — |
| 監視 | Sentry | Sentry (設定のみ) | DSN 未設定 |
| Admin | CF Pages + CF Access | Next.js SSR + nginx /admin/ | ✅ アクセス制限は未設定 |

---

## 6. Docker で動かすための手順

### 最短パス (認証なし、データ表示のみ)

```bash
# 1. 起動 (スキーマ自動適用)
docker compose up -d

# 2. データインポート
docker compose exec -T postgres psql -U app open_regime < db/seed/seed_data.sql

# 3. 確認 (認証不要のエンドポイント)
curl http://localhost/health                        # → ok
curl http://localhost/api/regime                    # → regime JSON
curl http://localhost/api/signal/SPY                # → signal JSON
curl http://localhost/api/stocks                    # → stocks JSON
curl http://localhost/api/liquidity/overview        # → liquidity JSON
curl http://localhost/api/employment/risk-score     # → risk score JSON
```

### フル動作 (OAuth ログイン含む)

```bash
# 1. .env に Google OAuth 設定
GOOGLE_CLIENT_ID=<実際の値>
GOOGLE_CLIENT_SECRET=<実際の値>
JWT_SECRET=<32文字以上のランダム文字列>
DB_PASSWORD=<強いパスワード>

# 2. 起動 + データインポート
docker compose up -d
docker compose exec -T postgres psql -U app open_regime < db/seed/seed_data.sql

# 3. ブラウザで確認
open http://localhost/           # → フロントエンド
open http://localhost/login/     # → Google ログイン
open http://localhost/admin/     # → 管理画面
```

### バッチ実行

```bash
docker compose run --rm batch python -m app.batch.run --daily
docker compose run --rm batch python -m app.batch.run --weekly
docker compose run --rm batch python -m app.batch.manual_input list
```

---

## 7. nginx ルーティング詳細

```
/api/(signal|regime|exit|stock)(/|$)  → api-python:8081  (Python 計算 API)
/api/                                  → api-go:8080      (Go CRUD API)
/admin/                                → admin-frontend:3002 (Next.js admin)
/                                      → frontend:3000    (Next.js メイン)
```

**注意**: `/api/stock/` は Python 側にマッチ (正規表現)。Go 側の `/api/stocks` (複数形) は Go 側に正しくルーティングされる。

---

## 8. VPS デプロイチェックリスト (Step 8)

### 8-0. VPS 初期設定
- [ ] Sakura VPS 契約 (4vCPU/8GB, Ubuntu 22.04)
- [ ] SSH 鍵認証設定 + パスワード認証無効化
- [ ] `ufw allow 22,80,443/tcp` + `ufw enable`
- [ ] swap 2GB 追加 (`fallocate -l 2G /swapfile` — Docker ビルド用)
- [ ] Docker + Docker Compose インストール

### 8-1. リポジトリ + 環境変数
- [ ] `git clone` + `.env` 作成 (以下の全項目を本番値に設定)

```bash
# 必須 (生成コマンド付き)
DB_PASSWORD=$(openssl rand -base64 24)
JWT_SECRET=$(openssl rand -base64 48)
GOOGLE_CLIENT_ID=<Google Cloud Console から取得>
GOOGLE_CLIENT_SECRET=<同上>
FRED_API_KEY=<FRED サイトから取得>
MFA_ENCRYPTION_KEY=$(openssl rand -hex 32)
ADMIN_EMAILS=ryu3ta.ke.mo100307@gmail.com

# Stripe (決済が必要な場合)
STRIPE_SECRET_KEY=<Stripe Dashboard>
STRIPE_WEBHOOK_SECRET=<Stripe CLI or Dashboard>
STRIPE_PRICE_ID=<Stripe Dashboard>

# 監視・分析
SENTRY_DSN=<Sentry プロジェクト>
GA_ID=<Google Analytics 測定 ID>
```

### 8-2. データ移行 (ダウンタイム最小化)
- [ ] Supabase から最新データをエクスポート (切替直前に実行)
  ```bash
  # ローカルで実行
  scripts/export-supabase.sh
  scp db/seed/seed_data.sql vps:/path/to/repo/db/seed/
  ```
- [ ] VPS で Docker 起動 + データインポート
  ```bash
  docker compose up -d
  docker compose exec -T postgres psql -U app open_regime < db/seed/seed_data.sql
  ```
- [ ] **注意**: seed_data.sql は 2026-03-26 時点。本番切替時は最新エクスポートが必要

### 8-3. Frontend 再ビルド (本番 env 反映)
- [ ] `NEXT_PUBLIC_*` 変数はビルド時に焼き込まれる → VPS でビルド
  ```bash
  docker compose build frontend admin-frontend
  docker compose up -d frontend admin-frontend
  ```

### 8-4. 動作確認 (DNS 切替前)
- [ ] `curl http://VPS_IP/health` → ok
- [ ] `curl http://VPS_IP/api/regime` → regime JSON
- [ ] `curl http://VPS_IP/api/stocks` → stocks JSON
- [ ] `curl http://VPS_IP/api/employment/risk-score` → risk score JSON
- [ ] ブラウザで `http://VPS_IP/` → フロントエンド表示

### 8-5. DNS 切替 + 外部サービス更新
- [ ] Cloudflare DNS: A record → VPS IP (Proxy mode ON)
- [ ] Google Cloud Console: OAuth redirect URI を `https://open-regime.com/api/auth/google/callback` に更新
- [ ] Stripe Dashboard: webhook URL を `https://open-regime.com/api/billing/webhook` に更新
- [ ] **SSL は Cloudflare Proxy が処理** — VPS は HTTP (80) のみ

### 8-6. DNS 切替後の確認
- [ ] `https://open-regime.com/` → フロントエンド
- [ ] Google OAuth ログイン → ダッシュボード
- [ ] Holdings/Signals/Regime 表示
- [ ] `/admin/` → 管理画面

### 8-7. crontab 設定
```crontab
# 日次 batch: JST 7:30 = UTC 22:30
30 22 * * * cd /path/to/repo && docker compose run --rm batch python -m app.batch.run --daily >> /var/log/batch-daily.log 2>&1

# 週次 batch: 金曜 JST 8:00 = UTC 23:00
0 23 * * 5 cd /path/to/repo && docker compose run --rm batch python -m app.batch.run --weekly >> /var/log/batch-weekly.log 2>&1
```

### 8-8. 旧サービス廃止 (72h 保持)
- [ ] CF Workers: `wrangler deployments rollback` で即復帰可能な状態で停止
- [ ] Cloud Run: サービス停止 (削除しない)
- [ ] 72h 経過後、問題なければ完全削除
- [ ] Supabase: VPS 安定後に解約 (最低1週間は保持)
