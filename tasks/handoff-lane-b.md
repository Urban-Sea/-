# レーンB: api-go 骨格 + CRUD移植 (Step 3 + Step 4)

## 背景

VPS Docker 移行の一環として、Cloudflare Worker (TypeScript) の CRUD 66ep + 認証 + Stripe を Go (Echo) に移植する。本番 Worker/Cloud Run は一切触らない。ローカル Docker で動作確認のみ。

Step 1 (基盤) 完了済み。レーンA (api-python Docker化) も並行で進行中 — docker-compose に api-python サービスと nginx upstream が既に追加されている。

- 設計書: `tasks/vps-docker-design.md` Section 4
- 移植元: `app/worker/src/routes/` (TypeScript CRUD ロジック)
- DB スキーマ: `db/init/01_schema.sql`

---

## Step 3: api-go 骨格 + 認証 (13タスク)

### 3-1. Go module + ディレクトリ構成

```
api-go/
├── cmd/server/main.go
├── internal/{config,middleware,handler,model,repository,service,testutil}/
├── migrations/000001_init.{up,down}.sql
├── Dockerfile
└── go.mod
```

依存: Echo v4, pgx v5, go-redis v9, golang-jwt v5, golang.org/x/oauth2, pquerna/otp, go-playground/validator, golang-migrate v4, sentry-go, stripe-go v82

### 3-2. golang-migrate

- `db/init/01_schema.sql` → `api-go/migrations/000001_init.up.sql` にコピー
- `000001_init.down.sql` に DROP TABLE 文
- main.go 起動時に `migrate.Up()` 自動実行。既適用時は no-op、エラー時はログ出力して起動継続
- docker-compose の postgres entrypoint init.sql はそのまま残す（初回ボリューム作成時用）

### 3-3. Config (internal/config/config.go)

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

- Config 読み込み → pgx pool → Redis → Sentry → golang-migrate
- Echo + ミドルウェアチェーン (Recovery → Sentry → Security → CORS → RateLimit)
- `GET /health` → `{"status":"ok"}`

### 3-5. JWT 認証

**AuthService** (`internal/service/auth_service.go`):
- `IssueJWT(userID, email)` → token string — HS256, 24h expiry
- `ValidateJWT(token)` → Claims — 署名検証 + expiry
- `GetUser(ctx, userID)` → User — Redis キャッシュ 5min → DB fallback

**AuthMiddleware** (`internal/middleware/auth.go`):
- Cookie `token` 読み取り → ValidateJWT → GetUser (is_active チェック) → `c.Set("user_id", ...)`

### 3-6. Google OAuth (`internal/handler/auth.go`)

| EP | 処理 |
|---|---|
| `GET /api/auth/google` | CSRF state → Redis 10min → Google 同意画面 302 |
| `GET /api/auth/google/callback` | state 検証 → code 交換 → userinfo → FindOrCreate → JWT Cookie → Frontend redirect |
| `POST /api/auth/refresh` | Cookie JWT → 新 JWT |
| `POST /api/auth/logout` | Cookie 削除 |
| `GET /api/auth/me` | Cookie JWT → user info |

UserRepo.FindOrCreateByOAuth:
1. auth_provider_id で検索 (高速パス)
2. email で検索 (移行パス、provider チェック)
3. 新規 INSERT

### 3-7. ミドルウェア

- **CORS**: 開発 `localhost:3000`, 本番 `open-regime.com`
- **Security Headers**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- **Rate Limit**: 120 req/min/IP、Redis INCR+EXPIRE、インメモリ fallback

### 3-8. Sentry

`sentry.Init()` + `sentryecho.New()` ミドルウェア。5xx のみ通知。

### 3-9. Dockerfile

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=builder /server /server
COPY --from=builder /app/migrations /migrations
EXPOSE 8080
ENTRYPOINT ["/server"]
```

### 3-10. docker-compose + nginx

```yaml
api-go:
  build: ./api-go
  environment:
    - DB_HOST=postgres
    - DB_PORT=5432
    - DB_NAME=open_regime
    - DB_USER=app
    - DB_PASSWORD=${DB_PASSWORD}
    - REDIS_URL=redis://redis:6379
    - JWT_SECRET=${JWT_SECRET}
    - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
    - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
    - FRONTEND_URL=http://localhost
    - ADMIN_EMAILS=${ADMIN_EMAILS:-}
    - MFA_ENCRYPTION_KEY=${MFA_ENCRYPTION_KEY:-}
    - SENTRY_DSN=${SENTRY_DSN:-}
    - ENVIRONMENT=development
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
  mem_limit: 128m
  cpus: 0.5
  restart: unless-stopped
```

nginx: `api_go` upstream + `/api/` location を有効化。Python の `^/api/(signal|regime|exit|stock)` が先にマッチするので順序は現状のままでOK。

### 3-11. /api/me

- `GET /api/me` — users SELECT + ADMIN_EMAILS チェックで is_admin フラグ
- `PATCH /api/me` — display_name のみ更新 (max 50 chars)

ファイル: `internal/model/user.go`, `internal/repository/user_repo.go`, `internal/handler/users.go`

### 3-12. テスト基盤

- `internal/testutil/db.go` — テスト用 pgx pool、TX ロールバック
- `internal/testutil/jwt.go` — テスト用 JWT 生成
- `/api/me` のテーブル駆動テスト

### 3-13. 確認

```bash
docker compose up -d --build
curl http://localhost/health                      # → 200
curl http://localhost/api/auth/google             # → 302 Google
curl http://localhost/api/me --cookie "token=..." # → user JSON
cd api-go && go test ./...                         # → ALL PASS
```

---

## Step 4: CRUD 66ep + Stripe 移植 (12グループ)

各グループ共通パターン: Worker のロジック読む → model → repository → handler → テスト → nginx

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
| 8 | /api/liquidity | 12 | mixed | fed_balance_sheet 等 | ★★★ |
| 9 | /api/employment | 5+ | mixed | economic_indicators 等 | ★★★ |
| 10 | /api/admin | 8 | admin+MFA | users, audit_logs 等 | ★★ |
| 11 | /api/admin/mfa | 6 | admin | admin_mfa, sessions | ★★★ |
| 12 | /api/billing | 4 | mixed | users | ★★ (Stripe) |

### 4-1. /api/fx/usdjpy (1ep, ★)

- `GET /api/fx/usdjpy` — Yahoo Finance HTTP fetch + Redis キャッシュ 5min
- DB アクセスなし。`net/http` + `encoding/json` のみ
- 移植元: `app/worker/src/routes/fx.ts`

### 4-2. /api/stocks (3ep, ★)

- `GET /api/stocks` — stock_master SELECT + フィルタ (category, watchlist, active_only)
- `GET /api/stocks/:ticker` — 単一 SELECT
- `GET /api/stocks/categories/list` — DISTINCT price_category, watchlist_category
- Auth 不要
- 移植元: `app/worker/src/routes/stocks.ts`

### 4-3. /api/market-state (3ep, ★★)

- `GET /api/market-state` — market_state_history SELECT + pagination
- `GET /api/market-state/latest` — 最新1件
- `POST /api/market-state` — INSERT (auth required)
- **注意**: Worker は spy_regime, qqq_regime 等を INSERT するが、実 DB は state, layer1_stress, layer2a_stress, layer2b_stress, credit_pressure, comment。Go は実 DB スキーマに合わせる
- 移植元: `app/worker/src/routes/market-state.ts`

### 4-4. /api/watchlist (6ep, ★★)

- CRUD + add-ticker/remove-ticker
- tickers は TEXT[] — pgx は `[]string` で自動ハンドル
- ticker バリデーション: `[A-Z0-9.\-]{1,10}`, max 50 per watchlist
- Default watchlist 自動作成ロジック
- 移植元: `app/worker/src/routes/watchlist.ts`

### 4-5. /api/trades (6ep, ★★★)

- CRUD + stats + sell-from-holding
- sell-from-holding: `pool.BeginTx()` で原子性保証
  - holding 読み取り → P&L 計算 → trade INSERT → holding UPDATE/DELETE
  - P&L = `((price - avg_price) * shares - fees)`
  - holding_days = `trade_date - entry_date`
- stats: buy/sell count, win rate, profit factor (全件読み込み + インメモリ集計)
- 移植元: `app/worker/src/routes/trades.ts`

### 4-6. /api/holdings (15ep, ★★★★ 最大)

- CRUD (5) + init/portfolio-history/add-shares (3) + cash CRUD (4) + holdings/:ticker (1) + holdings/:id (2)
- init: `errgroup` で 3 並列クエリ (holdings + cash + market_indicators.usdjpy)
- add-shares: `new_avg = (old_shares*old_price + new_shares*new_price) / (old_shares + new_shares)`
- portfolio-history: portfolio_snapshots SELECT + date range
- **ルート順序注意**: `/init`, `/cash`, `/portfolio-history` を `/:id`, `/:ticker` より先に登録
- 移植元: `app/worker/src/routes/holdings.ts`

### 4-7. /api/liquidity (12ep, ★★★)

**Worker からの移植 (5ep DB読み):**
- fed-balance-sheet, interest-rates, credit-spreads, market-indicators — `SELECT * FROM {table} ORDER BY date DESC LIMIT $1`
- POST margin-debt — UPSERT + 2年変化率計算

**Python からの移植 (7ep 計算ロジック含む):**
- `GET /api/liquidity/overview` — 4テーブル SELECT + ストレスレベル判定
- `GET /api/liquidity/plumbing-summary` — 9並列クエリ + Layer1/2A/2B ストレス計算 + market state 判定
- `GET /api/liquidity/events` — 4並列クエリ + 6種イベント検出 (FUNDING_STRESS等)
- `GET /api/liquidity/policy-regime` — 4並列クエリ + 政策レジーム判定 + Fed余力分析
- `GET /api/liquidity/history-charts` — 7並列クエリ (純粋DB読み)
- `GET /api/liquidity/backtest-states` — 7並列クエリ + 月次集計 + forward return

計算ロジック移植元: `app/backend/analysis/liquidity_score.py`
- `calculate_layer1_stress()` — Net Liquidity Z-score → ストレス変換
- `calculate_layer2a_stress()` — 5コンポーネント加重スコア (reserves, KRE, SRF, IG spread)
- `calculate_layer2b_stress()` — margin debt 2y変化 + MMF change
- `determine_market_state()` — 3層ストレス → 8状態判定
- `detect_market_events()` — 6イベント × 3 severity
- `detect_policy_regime()` — 6レジーム + Fed 余力分析

**確認済み: Python版は numpy/pandas 非依存。純粋な Python (`statistics.mean()`, `statistics.stdev()`, `math.exp()`) のみ使用。Go への移植は標準ライブラリで可能。**

**検証: 同じ seed データで Python版と Go版の出力を比較。plumbing-summary の各 stress 値、market state、event detection が ±0.01 以内であることを確認。**

### 4-8. /api/employment (5+ep, ★★★)

**Worker からの移植 (5ep):**
- overview, indicators, weekly-claims, revisions/:id — DB読み + alert scoring
- POST indicators — UPSERT + revision tracking

**Python からの移植 (2ep 計算ロジック含む):**
- `GET /api/employment/risk-score` — 100点 3カテゴリスコアリング
  - 雇用 (50点): NFPトレンド(25) + Sahm Rule(15) + Claims(2) + 乖離(8)
  - 消費 (25点): 実質所得 + 消費者信頼感 + クレカ延滞 + インフレ乖離
  - 構造 (25点): 求人倍率 + U6-U3 + 労働参加率 + K-Shape
- `GET /api/employment/risk-history` — 過去120ヶ月のリスクスコア月次再計算

計算ロジック移植元: `app/backend/routers/employment.py`

**確認済み: Python版は numpy/pandas 非依存。`statistics` モジュール + `math.exp()` のみ。**

**検証: 同じ seed データで Python版と Go版の出力を比較。各カテゴリスコア (employment/consumer/structural) と total score が ±0.01 以内であることを確認。**

### 4-9. /api/admin (8ep, ★★)

- users CRUD + stats + audit-logs + batch-logs + feature-flags CRUD
- Admin middleware: ADMIN_EMAILS チェック
- AdminMFA middleware: X-MFA-Token ヘッダー → admin_mfa_sessions 検証
- `auditLog()` ヘルパー: fire-and-forget で admin_audit_logs INSERT
- 移植元: `app/worker/src/routes/admin.ts`, `app/worker/src/middleware/admin-auth.ts`

### 4-10. /api/admin/mfa (6ep, ★★★)

- TOTP セットアップ + 検証 + セッション管理
- `pquerna/otp` で TOTP 生成・検証 (±30s window)
- AES-256-GCM 暗号化: `nonce_hex:ciphertext_hex` 形式 (Worker 互換)
- セッション: 32 bytes random → SHA-256 → DB、1h expiry
- Rate limit: 5 attempts/15min (Redis)
- Replay protection: 使用済みコード 90s TTL (Redis)
- 移植元: `app/worker/src/routes/admin-mfa.ts`, `app/worker/src/lib/crypto.ts`, `app/worker/src/lib/totp.ts`

### 4-11. /api/billing (4ep, ★★ Stripe)

- `POST /api/billing/create-checkout` — Stripe Checkout Session 作成
- `POST /api/billing/webhook` — Stripe 署名検証 + plan 更新 (**auth 不要**)
- `GET /api/billing/portal` — Stripe Customer Portal URL
- `POST /api/billing/cancel` — Stripe subscription cancel + plan → free
- 設計元: `tasks/vps-docker-design.md` Section 9

---

## エラーレスポンス形式

全エンドポイントで統一: `{ "detail": "エラーメッセージ" }` (FastAPI 互換)

```go
func errorJSON(c echo.Context, code int, msg string) error {
    return c.JSON(code, map[string]string{"detail": msg})
}
```

---

## ルート登録

```go
// Public
e.GET("/health", ...)
e.GET("/api/auth/google", ...)
e.GET("/api/auth/google/callback", ...)
e.POST("/api/auth/refresh", ...)
e.POST("/api/auth/logout", ...)
e.GET("/api/fx/usdjpy", ...)
e.GET("/api/stocks", ...)
e.GET("/api/stocks/categories/list", ...)
e.GET("/api/stocks/:ticker", ...)
e.GET("/api/market-state", ...)
e.GET("/api/market-state/latest", ...)
e.GET("/api/liquidity/*", ...)       // GET のみ public
e.GET("/api/employment/*", ...)      // GET のみ public
e.POST("/api/billing/webhook", ...)  // Stripe 署名検証、auth 不要

// Auth required
auth := e.Group("", authMiddleware)
auth.GET("/api/auth/me", ...)
auth.GET("/api/me", ...)
auth.PATCH("/api/me", ...)
auth.POST("/api/market-state", ...)
auth.POST("/api/liquidity/margin-debt", ...)    // ← auth required
auth.POST("/api/employment/indicators", ...)    // ← auth required
auth.* // holdings, trades, watchlist, billing (webhook以外)

// Admin + MFA
admin := e.Group("/api/admin", adminMfaMiddleware)
// Admin (MFA setup — no MFA required)
adminNoMfa := e.Group("/api/admin/mfa", adminMiddleware)
```

---

## 実装順序

Step 3 → Step 4 を厳密に順序実行:

1. **Step 3** (骨格): 3-1 → 3-2 → 3-3 → 3-4 → 3-5 → 3-6 → 3-7 → 3-8 → 3-9 → 3-10 → 3-11 → 3-12 → 3-13
2. **Step 4** (CRUD): 4-1 → 4-2 → 4-3 → 4-4 → 4-5 → 4-6 → 4-7 → 4-8 → 4-9 → 4-10 → 4-11

---

## 注意事項

- **market_state_history**: Worker と DB スキーマの列名不一致 → 実 DB に合わせる
- **sell-from-holding**: TX で原子性保証
- **MFA 暗号化**: `nonce_hex:ciphertext_hex` 形式互換
- **TEXT[]**: pgx は `[]string` で自動ハンドル
- **NUMERIC**: `pgtype.Numeric` 使用、float64 は精度ロス
- **エラー形式**: `{ "detail": "..." }` (FastAPI 互換)
- **liquidity/employment の POST**: auth required（GET は public）

---

## 主要ファイル

### 移植元 (読むだけ)

- `app/worker/src/routes/*.ts` — 12 ファイル (CRUD ロジック)
- `app/worker/src/middleware/*.ts` — auth, admin-auth, cors, rate-limit, security
- `app/worker/src/lib/*.ts` — crypto, totp, validation, supabase, redis, response
- `app/backend/analysis/liquidity_score.py` — 流動性ストレス計算
- `app/backend/routers/liquidity.py` — 流動性 API
- `app/backend/routers/employment.py` — 雇用 API

### 作成するファイル

- `api-go/cmd/server/main.go`
- `api-go/internal/config/config.go`
- `api-go/internal/middleware/{auth,admin,cors,ratelimit,security}.go`
- `api-go/internal/handler/{auth,users,fx,stocks,market_state,watchlist,trades,holdings,liquidity,employment,admin,admin_mfa,billing}.go`
- `api-go/internal/model/{user,stock,holding,trade,watchlist,...}.go`
- `api-go/internal/repository/{user,stock,holding,trade,watchlist,...}_repo.go`
- `api-go/internal/service/{auth_service,mfa_service}.go`
- `api-go/internal/testutil/{db,jwt}.go`
- `api-go/migrations/000001_init.{up,down}.sql`
- `api-go/Dockerfile`

### 変更するファイル

- `docker-compose.yml` — api-go サービス追加
- `nginx/conf.d/default.conf` — api_go upstream + `/api/` location 有効化

---

## 検証

```bash
# Step 3 確認
docker compose up -d --build
curl http://localhost/health                         # → 200
curl http://localhost/api/auth/google                # → 302
curl http://localhost/api/me -b "token=..."          # → user JSON
cd api-go && go test ./...                            # → ALL PASS

# Step 4 確認 (各グループ完了ごと)
curl http://localhost/api/fx/usdjpy                  # → { rate, cached }
curl http://localhost/api/stocks                     # → { stocks[], total }
curl http://localhost/api/holdings -b "token=..."    # → { holdings[], total }

# liquidity/employment 計算検証
# Python版と Go版の出力比較 (同一 seed データ)
# plumbing-summary: 各 stress 値 ±0.01 以内
# risk-score: 各カテゴリスコア ±0.01 以内

# 最終確認
go test ./... -count=1                                # → ALL PASS
```
