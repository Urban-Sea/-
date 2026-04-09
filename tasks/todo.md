# Redis TTL チューニング (2026-04-09)

> **方針**: signal / stock quote / fx 以外は **24h 固定**
> **背景**: 今後やること.md の Day 2 午後前半「Redis 実機チェック」で発覚した設計と実装のギャップを埋める。日足ベースの計算 (regime, exit, history, ema) や週次/月次 FRED 系統 (liquidity, employment, market_state) は同一営業日中に再計算する意味が無い。
> **設計参照**: `tasks/今後やること.md:72-87` / 調査結果は当セッションログ参照

## TTL 変更マトリクス

| # | エンドポイント | ファイル | 現状 | → 変更後 | 種別 |
|---|---|---|---|---|---|
| 1 | `/api/regime` | [routers/regime.py:21](../app/backend/routers/regime.py#L21) | 300s + adaptive_ttl | **86400s 固定** | 既存定数変更 |
| 2 | `/api/stock/{ticker}` (info), `/quote` | [routers/stock.py:44](../app/backend/routers/stock.py#L44) | 300s 共用 | **300s 維持** (quote/info) | 定数分離のみ |
| 3 | `/api/stock/{ticker}/history` | [routers/stock.py:329-365](../app/backend/routers/stock.py#L329-L365) | 300s + adaptive_ttl | **86400s 固定** | 定数分離 + adaptive 削除 |
| 4 | `/api/stock/{ticker}/ema` | [routers/stock.py:374-423](../app/backend/routers/stock.py#L374-L423) | **キャッシュなし** | **86400s 新規** | 新規追加 |
| 5 | `/api/signal/*` | [routers/signal.py:46](../app/backend/routers/signal.py#L46) | 300s + adaptive_ttl | **変更なし** (5分維持) | — |
| 6 | `/api/fx/usdjpy` | [routers/fx.py:15](../app/backend/routers/fx.py#L15) | 300s | **変更なし** | — |
| 7 | `/api/liquidity/plumbing-summary` | [routers/liquidity.py:35](../app/backend/routers/liquidity.py#L35) | 21600s | **86400s** | 定数変更 |
| 8 | `/api/liquidity/events` | [routers/liquidity.py:36](../app/backend/routers/liquidity.py#L36) | 21600s | **86400s** | 定数変更 |
| 9 | `/api/liquidity/policy-regime` | [routers/liquidity.py:37](../app/backend/routers/liquidity.py#L37) | 21600s | **86400s** | 定数変更 |
| 10 | `/api/liquidity/backtest-states` | [routers/liquidity.py:38](../app/backend/routers/liquidity.py#L38) | 21600s | **86400s** | 定数変更 |
| 11 | `/api/employment/risk-score` | [routers/employment.py:24](../app/backend/routers/employment.py#L24) | 21600s | **86400s** | 定数変更 |
| 12 | `/api/employment/risk-history` | [routers/employment.py:25](../app/backend/routers/employment.py#L25) | 21600s | **86400s** | 定数変更 |
| 13 | `/api/stocks` (一覧) | [routers/stocks.py](../app/backend/routers/stocks.py) | **キャッシュなし** | **86400s 新規** | 新規追加 |
| 14 | `/api/market-state/latest` | [routers/market_state.py:88-130](../app/backend/routers/market_state.py#L88-L130) | **キャッシュなし** | **86400s 新規** | 新規追加 |
| 15 | `/api/market-state` (履歴) | [routers/market_state.py:48-85](../app/backend/routers/market_state.py#L48-L85) | **キャッシュなし** | **86400s 新規** | 新規追加 |
| 16 | `/api/exit/{ticker}` | [routers/exit.py:118-345](../app/backend/routers/exit.py#L118-L345) | **キャッシュなし** | **86400s 新規** | 新規追加 |
| 17 | `/api/exit/{ticker}/quick` | [routers/exit.py:348-391](../app/backend/routers/exit.py#L348-L391) | **キャッシュなし** | **86400s 新規** | 新規追加 |

## 設計上の判断メモ

- **adaptive_ttl の削除**: 24h 固定にする項目 (regime, history) は `adaptive_ttl()` をやめて定数を直接渡す。signal / stock quote のみ adaptive_ttl 継続。
- **キャッシュキー prefix bump 不要**: TTL 値だけの変更なので、SET し直された時に新 TTL に上書きされる。古いキーは旧 TTL で expire するだけ。
- **graceful degradation 既存通り**: redis_cache の L1+L2 + None フォールバック ([redis_cache.py:87-109](../app/backend/redis_cache.py#L87-L109)) は触らない。
- **batch warmup との整合**: [app/batch/run.py:124-137](../app/batch/run.py#L124-L137) の WARMUP_ENDPOINTS が日次/週次 cron 後に `cache_set` で全部上書きしてくれる。24h TTL でも batch のたびにリフレッシュされる。
- **新規キャッシュのキー命名**:
  - `stocks:master:{category}:{watchlist}:{active_only}` (フィルタごとに分ける)
  - `market_state:latest`
  - `market_state:history:{limit}:{offset}`
  - `exit:{ticker}:{entry_price}:{entry_date}:{bos_grade}:{structure_stop_pct}`
  - `exit:quick:{ticker}:{entry_price}`
  - `stock:history:v2:{ticker}:{period}:{interval}` (既存)
  - `stock:ema:{ticker}:{periods}` (新規)

## チェックリスト

### コード変更
- [ ] regime.py: `_REGIME_TTL = 300` → `86400`、`adaptive_ttl(_REGIME_TTL)` → `_REGIME_TTL`
- [ ] stock.py: `_CACHE_TTL = 300` を 3 つに分離 (`_QUOTE_TTL=300`, `_HISTORY_TTL=86400`, `_EMA_TTL=86400`)
- [ ] stock.py: history は `_HISTORY_TTL` 固定 (adaptive 削除)、quote/info は `_QUOTE_TTL` (adaptive 維持)
- [ ] stock.py: ema エンドポイントに新規キャッシュ追加
- [ ] liquidity.py: 4 定数を 21600 → 86400 (replace_all)
- [ ] employment.py: 2 定数を 21600 → 86400 (replace_all)
- [ ] stocks.py: redis_cache import + キャッシュ追加 (24h)
- [ ] market_state.py: redis_cache import + 履歴/latest にキャッシュ追加 (24h)
- [ ] exit.py: redis_cache import + analyze_exit / quick_exit_check にキャッシュ追加 (24h)

### 検証
- [ ] `python -m py_compile` で構文チェック (修正 9 ファイル)
- [ ] 既存テストが落ちないか (`pytest app/backend/tests/` がある場合)

### デプロイ後の実機チェック (本人 on VPS)
今後やること.md Day 2 午後前半の手順をそのまま:
- [ ] `/api/regime` を 1 回叩く → 2 回目のレイテンシ差を計測
- [ ] `docker compose exec redis redis-cli KEYS '*'`
- [ ] `docker compose exec redis redis-cli TTL regime:v2:us` → 86400 前後を確認
- [ ] `docker compose exec redis redis-cli INFO memory` → 48MB 以内
- [ ] Redis を一時停止して API が graceful degradation するか確認

---

# Cloud Run 移行 TODO (Step 2)

## Phase 0: GCP セットアップ ✅ 完了

- [x] GCP プロジェクト: `open-regime` (Number: 1073412395842)
- [x] API 有効化: Cloud Run Admin, Artifact Registry, IAM Credentials
- [x] Artifact Registry リポジトリ作成 (us-east1, Docker, `open-regime`)
- [x] Workload Identity Federation 設定
- [x] GitHub Secrets 登録: `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`

## Phase 1: コード変更 ✅ 完了

- [x] Dockerfile — Cloud Run PORT 対応
- [x] .dockerignore 新規作成
- [x] auth.py — レガシー X-User-Email パス削除
- [x] main.py — CORS allow_headers から X-User-Email 削除
- [x] proxy.ts — X-User-Email 転送削除
- [x] cors.ts — Allow-Headers から X-User-Email 削除
- [x] railway.json 削除
- [x] deploy.yml — Backend デプロイジョブ追加 (WIF, --update-env-vars)

## Phase 2: 初回デプロイ & 切り替え ✅ 完了

- [x] CI が Cloud Run にデプロイ (Docker ビルド & プッシュ成功)
- [x] Cloud Run 環境変数を手動設定 (PROXY_SECRET, SUPABASE_*, ADMIN_EMAILS, MFA_ENCRYPTION_KEY)
- [x] Cloud Run 直接テスト: `curl /health` → `{"status":"healthy","supabase":"connected"}`
- [x] wrangler.jsonc の ORIGIN を Cloud Run URL に変更 → プッシュ
- [x] スモークテスト — フロントエンドから動作確認済み
- [ ] 1 週間問題なければ Railway 廃止

## Phase 3: クリーンアップ（1 週間後）

- [ ] CRUD ルーター削除（holdings, trades, watchlist, users, admin, admin_mfa）
- [ ] main.py から該当 include_router 行を削除
- [ ] requirements.txt から pyotp, qrcode[pil] 削除
- [ ] Railway プロジェクト廃止

---

# Upstash Redis 導入 TODO (Step 3)

## Phase 3A: Worker rate-limit Redis 化 ✅ 完了

- [x] `@upstash/redis` 追加 (package.json)
- [x] `app/worker/src/lib/redis.ts` 新規作成 (Redis クライアントファクトリ)
- [x] `app/worker/src/env.ts` に `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 追加
- [x] `rate-limit.ts` を Redis INCR+EXPIRE に変更 (in-memory フォールバック付き)
- [x] `index.ts` の checkRateLimit を async 化 + env 渡し

## Phase 3B: Cloud Run キャッシュ Redis L2 化 ✅ 完了

- [x] `upstash-redis` 追加 (requirements.txt)
- [x] `app/backend/redis_cache.py` 新規作成 (L1 インメモリ + L2 Redis)
- [x] `routers/signal.py` — 4 dict キャッシュ → redis_cache 移行
- [x] `routers/stock.py` — get_cached/set_cache → redis_cache 移行
- [x] `cache_utils.py` — Supabase stock_cache → Redis L2 移行
- [x] `routers/regime.py` — redis_cache 移行
- [x] `routers/liquidity.py` — 4 キャッシュ → redis_cache 移行
- [x] `routers/employment.py` — 2 キャッシュ → redis_cache 移行
- [x] `routers/fx.py` — redis_cache 移行

## Phase 3C: プリコンピュート + CI/CD ✅ 完了

- [x] `app/batch/calculators/precompute.py` — Supabase upsert 後に Redis SET 追加
- [x] `app/backend/precomputed.py` — Redis → Supabase の順で読み取り
- [x] `.github/workflows/deploy.yml` — Redis env vars 追加
- [x] `.github/workflows/batch-daily.yml` — Redis env vars 追加

## シークレット登録 ✅ 完了

- [x] Worker: `wrangler secret put UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- [x] GitHub Secrets: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
- [x] Cloud Run: deploy.yml 経由で次回デプロイ時に自動設定

## 検証 ✅ 完了

- [x] Python Redis 接続テスト成功
- [x] redis_cache.py L1+L2 動作テスト成功 (L1 ヒット, L2 バックフィル)
- [x] Worker TypeScript 型チェック成功

## Redis キー命名規則

| キーパターン | 用途 | TTL |
|------------|------|-----|
| `rl:ip:{ip}` | Worker レートリミット | 60s |
| `signal:{ticker}:{mode}` | シグナルキャッシュ | 300s |
| `signal_hist:{ticker}:{period}:{mode}` | シグナル履歴 | 300s |
| `markers:{ticker}:{period}` | チャートマーカー | 300s |
| `regime:us` | レジームデータ | 300s |
| `stock:{key}` | 株価クオート/詳細 | 300s |
| `ohlcv:{ticker}:{period}` | OHLCV データ | 300s |
| `fx:usdjpy` | 為替レート | 300s |
| `plumbing:summary` | 流動性サマリー | 21600s (6h) |
| `liquidity:events` | 流動性イベント | 21600s (6h) |
| `liquidity:policy` | 政策データ | 21600s (6h) |
| `liquidity:backtest:{limit}` | バックテスト | 21600s (6h) |
| `employment:risk_score` | 雇用リスクスコア | 21600s (6h) |
| `employment:risk_history:{months}` | 雇用リスク履歴 | 21600s (6h) |
| `precomputed:{key}` | バッチ計算結果 | 86400s |

---

## Cloud Run 情報

| 項目 | 値 |
|------|-----|
| Service URL | `https://open-regime-backend-1073412395842.us-east1.run.app` |
| Project ID | `open-regime` |
| Region | `us-east1` |
| Service Name | `open-regime-backend` |

## 残りのセキュリティ TODO

- [ ] Supabase Auth: Leaked Password Protection 有効化（Dashboard → Auth → Settings）

---

# Step 4.5: Resend SMTP 導入 ✅ 完了

- [x] Resend アカウント作成 + API Key 生成
- [x] Supabase Custom SMTP 設定（`noreply@open-regime.com`）
- [x] テストメール送信・動作確認

---

# Step 4.6: カスタムドメイン導入 ✅ 完了

> 目的: 独自ドメインでフロントエンド・API・メールを統一
> ドメイン: `open-regime.com`（Cloudflare Registrar, $10.46/年）

## 完了した作業

- [x] Cloudflare Registrar でドメイン取得（`open-regime.com`）
- [x] CF Pages カスタムドメイン設定（`open-regime.com`）
- [x] CF Worker カスタムドメイン設定（`api.open-regime.com`）
- [x] Resend ドメイン追加 + DNS 認証（SPF/DKIM）
- [x] DMARC レコード追加
- [x] Supabase SMTP Sender email を `noreply@open-regime.com` に変更
- [x] Supabase Auth Site URL / Redirect URL 更新
- [x] `wrangler.jsonc` ALLOWED_ORIGIN に `https://open-regime.com` 追加
- [x] `.env.local` API URL を `https://api.open-regime.com` に変更
- [x] `api.ts` フォールバック URL 更新
- [x] ドキュメント更新（システム設計_詳細2.md）
- [x] CF Access に `open-regime.com` 追加（公開前のアクセス制限）

## ドメインマッピング

| ドメイン | サービス | 用途 |
|---------|---------|------|
| `open-regime.com` | CF Pages | フロントエンド |
| `api.open-regime.com` | CF Worker | API プロキシ |
| `noreply@open-regime.com` | Resend SMTP | メール送信元 |

## CF Access 設定（公開前）

| ドメイン | CF Access | 備考 |
|---------|-----------|------|
| `open-regime.com` | あり | 公開時に外す |
| `*.open-regime.pages.dev` | あり | プレビュー保護 |
| `open-regime.pages.dev` | あり | 旧 URL 保護 |
| `open-regime-admin.pages.dev` | あり（別アプリ） | 永続的に保護 |

---

# VPS移行 レーンB: api-go 骨格 + CRUD移植

> 作成: 2026-03-28
> ステータス: 実装中

## 全体像

Worker (TypeScript/Cloudflare) の CRUD 66ep + 認証 + Stripe を Go (Echo) に移植。
本番 Worker/Cloud Run は一切触らない。ローカル Docker で動作確認のみ。

---

## Part 1: Step 3 — api-go 骨格 + 認証

### 3-1. Go module + ディレクトリ構成 ← ✅

```
api-go/
├── cmd/server/main.go           # エントリーポイント
├── internal/
│   ├── config/config.go         # 環境変数読み込み
│   ├── middleware/
│   │   ├── auth.go              # JWT Cookie 検証
│   │   ├── admin.go             # Admin + MFA 検証
│   │   ├── cors.go              # CORS
│   │   ├── ratelimit.go         # Redis ベースレート制限
│   │   └── security.go          # セキュリティヘッダー
│   ├── handler/
│   │   ├── auth.go              # Google OAuth (4ep)
│   │   ├── users.go             # /api/me (2ep)
│   │   └── ...                  # Step 4 で追加
│   ├── model/user.go            # 構造体定義
│   ├── repository/user_repo.go  # DB 操作
│   ├── service/
│   │   ├── auth_service.go      # JWT 発行/検証
│   │   └── mfa_service.go       # TOTP + AES
│   └── testutil/                # テスト用ヘルパー
├── migrations/
│   └── 000001_init.up.sql       # db/init/01_schema.sql のコピー
├── Dockerfile                   # multi-stage → distroless
├── go.mod
└── go.sum
```

**依存ライブラリ:**
- Echo v4 (HTTP)、pgx v5 (DB)、go-redis v9 (Redis)
- golang-jwt v5 (JWT)、golang.org/x/oauth2 (Google OAuth)
- pquerna/otp (TOTP)、go-playground/validator (バリデーション)
- golang-migrate v4 (DB マイグレーション)
- sentry-go (エラー監視)、stripe-go v82 (決済)

### 3-2. golang-migrate

- `db/init/01_schema.sql` の内容を `api-go/migrations/000001_init.up.sql` にコピー
- **main.go の起動時に `migrate.Up()` を自動実行**。失敗時はログ出力して起動継続（既に適用済みの場合は no-op）
- 以降のスキーマ変更は `000002_xxx.up.sql` で管理
- docker-compose の postgres entrypoint から init.sql を段階的に外す

### 3-3. Config

| 環境変数 | 説明 | デフォルト |
|---------|------|-----------|
| DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD | PostgreSQL | postgres, 5432, open_regime, app, — |
| REDIS_URL | Redis 接続先 | redis://redis:6379 |
| JWT_SECRET | 自前 JWT の HS256 秘密鍵 | — (必須) |
| GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | Google OAuth | — |
| GOOGLE_REDIRECT_URL | OAuth コールバック URL | http://localhost/api/auth/google/callback |
| FRONTEND_URL | Frontend リダイレクト先 | http://localhost |
| STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID | Stripe | — |
| ADMIN_EMAILS | カンマ区切りの管理者メール | — |
| MFA_ENCRYPTION_KEY | AES-256-GCM 用 64文字 hex | — |
| SENTRY_DSN | Sentry エラー監視 | — (空=無効) |
| ENVIRONMENT | development / production | development |

### 3-4. Echo + /health

- Recovery, Sentry, CORS, Security Headers, Rate Limit のミドルウェアチェーン
- `GET /health` → `200 {"status":"ok"}`

### 3-5. JWT 認証

**現在 (Worker):** Authorization: Bearer → Supabase Auth JWKS/HMAC 検証
**移行後 (Go):** HttpOnly Cookie `token` → 自前 HS256 JWT 検証

```
Claims: { user_id: UUID, email: string, iat, exp (24h) }
```

ミドルウェア:
1. Cookie `token` 読み取り
2. HS256 署名検証 + expiry チェック
3. Redis キャッシュ (5min) でユーザー存在・is_active 確認
4. `c.Set("user_id", ...)` でコンテキストに格納

### 3-6. Google OAuth

| エンドポイント | 処理 |
|---------------|------|
| `GET /api/auth/google` | CSRF state → Redis (10min), Google 同意画面リダイレクト |
| `GET /api/auth/google/callback` | state 検証 → トークン交換 → userinfo → DB upsert → JWT Cookie → Frontend リダイレクト |
| `POST /api/auth/refresh` | Cookie JWT 検証 → 新 JWT 発行 |
| `POST /api/auth/logout` | Cookie 削除 (MaxAge=-1) |
| `GET /api/auth/me` | Cookie JWT → ユーザー情報返却 |

### 3-7. ミドルウェア

- **CORS**: 開発 `http://localhost:3000`、本番 `https://open-regime.com`
- **Security Headers**: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy
- **Rate Limit**: 120 req/min/IP、Redis INCR + EXPIRE、フォールバックはインメモリ

### 3-8. Sentry

5xx のみ通知 + スタックトレース、sentryecho ミドルウェア

### 3-9〜3-10. Dockerfile + docker-compose + nginx

- Multi-stage → distroless (~20MB)
- docker-compose に api-go サービス追加
- nginx `/api/` → api-go:8080

### 3-11. /api/me (最初の CRUD)

- `GET /api/me` → users テーブル SELECT + is_admin フラグ
- `PATCH /api/me` → display_name のみ更新 (max 50 chars)

### 3-12. テスト基盤 + テスト

- testutil: テスト DB、TX ロールバック、JWT 生成
- /api/me のテーブル駆動テスト

### 3-13. 確認基準

```bash
docker compose up -d
curl http://localhost/health                      # → 200
curl http://localhost/api/auth/google             # → 302 Google
curl http://localhost/api/me --cookie "token=..." # → user JSON
go test ./...                                      # → ALL PASS
```

---

## Part 2: Step 4 — CRUD 66ep + Stripe 移植

### 移植順序 (小 → 大)

| # | グループ | EP数 | Auth | DB テーブル | 難易度 |
|---|---------|------|------|------------|--------|
| 1 | /api/me | 2 | user | users | ★ (Step 3 完了) |
| 2 | /api/fx/usdjpy | 1 | なし | — (HTTP) | ★ |
| 3 | /api/stocks | 3 | なし | stock_master | ★ |
| 4 | /api/market-state | 3 | mixed | market_state_history | ★★ |
| 5 | /api/watchlist | 6 | user | user_watchlists | ★★ |
| 6 | /api/trades | 6 | user | trades, holdings | ★★★ |
| 7 | /api/holdings | 15 | user | holdings, cash, snapshots, indicators | ★★★★ |
| 8 | /api/liquidity | 12 | mixed | fed_balance_sheet 等 | ★★ |
| 9 | /api/employment | 5 | mixed | economic_indicators 等 | ★★★ |
| 10 | /api/admin | 8 | admin+MFA | users, audit_logs 等 | ★★ |
| 11 | /api/admin/mfa | 6 | admin | admin_mfa, sessions | ★★★ |
| 12 | /api/billing | 4 | mixed | users | ★★ (Stripe) |

### 各エンドポイントの移植手順

1. Worker (`app/worker/src/routes/`) のロジックを読む
2. model → repository → handler を書く
3. テーブル駆動テストを書く
4. `docker compose restart api-go`
5. curl + go test で動作確認
6. nginx ルーティングに追加

### 注意事項

- **market_state_history**: Worker と DB スキーマの列名不一致 → 実 DB に合わせる
- **sell-from-holding**: TX で原子性保証
- **MFA 暗号化**: `nonce_hex:ciphertext_hex` 形式互換
- **TEXT[]**: pgx は `[]string` で自動ハンドル
- **NUMERIC**: `pgtype.Numeric` 使用、float64 は精度ロス
- **エラー形式**: `{ "detail": "..." }` (FastAPI 互換)

### 確認基準

- 全 70ep が api-go 経由で動作
- `go test ./...` 全 PASS
- Stripe webhook テスト済み

