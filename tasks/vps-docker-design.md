# VPS Docker 移行設計書

> 決定日: 2026-03-24
> ステータス: 設計中
> 目的: SaaS 依存脱却、インフラ自前管理、インターン向けポートフォリオ

---

## 1. 現状 → 移行先サマリ

| 現状 | 移行先 | 理由 |
|------|--------|------|
| CF Workers (API Gateway + CRUD) | **Go API コンテナ** | CRUD 49ep を Go で高速化。Workers 廃止 |
| Cloud Run (Python 全API) | **Python Compute コンテナ** | yfinance 依存の35ep のみ残す |
| CF Pages (Frontend) | **Next.js コンテナ + CF CDN** | SSR 対応、VPS で動かしつつ CF でキャッシュ |
| Supabase PostgreSQL | **セルフホスト PostgreSQL** | DB 自前管理 |
| Upstash Redis | **セルフホスト Redis** | コンテナで完結 |
| GitHub Actions Batch | **Batch コンテナ (cron)** | VPS 内で完結 |
| Supabase Auth | **Google OAuth 自前実装 (Go)** | Supabase 依存ゼロ。OAuth フロー理解のアピール |
| Resend (メール) | **Resend API 維持（外部）** | コンテナ不要、API 呼び出しのみ |

---

## 2. コンテナ構成

```
Cloudflare (CDN / DNS / SSL / R2)
  │
  │  *.open-regime.com → VPS IP (Proxy mode, SSL 終端は CF)
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  VPS (東京リージョン, 4vCPU / 8GB RAM — ConoHa)           │
│                                                                  │
│  常駐コンテナ (docker compose up -d):                            │
│  ├── nginx          :80    (CF からの HTTP を受ける)              │
│  ├── frontend       :3000  (Next.js 15 SSR — メインサイト)       │
│  ├── admin-frontend :3002  (Next.js 15 SSR — 管理画面)           │
│  ├── api-go         :8080  (Go — CRUD 66ep + 認証 + Stripe)     │
│  ├── api-python     :8081  (Python — 計算 18ep + yfinance)      │
│  ├── redis          :6379  (キャッシュ / レート制限)              │
│  ├── postgres       :5432  (メイン DB)                           │
│  ├── loki           :3100  (ログ収集・保存・検索)                 │
│  └── grafana        :3001  (ダッシュボード・ログ検索 UI)          │
│                                                                  │
│  一時起動コンテナ (ホスト OS の cron で docker compose run --rm): │
│  ├── batch          (daily/weekly) データ取得 → DB               │
│  └── r2-uploader    (daily) pg_dump → R2 バックアップ            │
│                                                                  │
│  内部ネットワーク: open-regime-net (bridge)                      │
│  外部公開ポート: 80 のみ (nginx)                                 │
│  ボリューム:                                                     │
│  ├── pg_data:/var/lib/postgresql/data                            │
│  ├── redis_data:/data                                            │
│  ├── loki_data:/loki                                             │
│  └── grafana_data:/var/lib/grafana                               │
└─────────────────────────────────────────────────────────────────┘
```

### コンテナ一覧

#### 常駐 10 コンテナ

| # | コンテナ | 言語 | ベースイメージ | メモリ目安 | 責務 |
|---|---------|------|---------------|-----------|------|
| 1 | **nginx** | — | `nginx:alpine` (~8MB) | 10MB | リバースプロキシ、サブドメイン振り分け、アクセスログ |
| 2 | **frontend** | TypeScript | `node:20-alpine` → multi-stage (~50MB) | 150MB | Next.js SSR、メインサイト UI |
| 3 | **admin-frontend** | TypeScript | `node:20-alpine` → multi-stage (~50MB) | 150MB | Next.js SSR、管理画面 UI、MFA ゲート |
| 4 | **api-go** | Go | `golang:1.22` → distroless (~20MB) | 30MB | CRUD 66ep、Google OAuth、JWT、Stripe、Admin API |
| 5 | **api-python** | Python | `python:3.11-slim` (~200MB) | 300MB | 計算 18ep、yfinance、pandas/numpy |
| 6 | **redis** | — | `redis:7-alpine` (~13MB) | 50MB | キャッシュ、レート制限 |
| 7 | **postgres** | — | `postgres:16-alpine` (~80MB) | 200MB | 全テーブル、WAL |
| 8 | **loki** | — | `grafana/loki:2.9.0` (~60MB) | 256MB | ログ収集・保存・検索 |
| 9 | **grafana** | — | `grafana/grafana:10.0.0` (~100MB) | 128MB | ダッシュボード・ログ検索 UI |
| 10 | **promtail** | — | `grafana/promtail:2.9.0` (~50MB) | 64MB | Docker コンテナログ → Loki 転送 |

#### 一時起動 2コンテナ (ホスト OS cron、profiles: [tools])

| # | コンテナ | 言語 | 責務 | 起動タイミング |
|---|---------|------|------|-------------|
| 9 | **batch** | Python | FRED/Yahoo データ取得 → DB | 毎日 22:30 UTC / 毎週金 23:00 UTC |
| 10 | **r2-uploader** | Shell | pg_dump → gzip → R2 バックアップ | 毎日 18:00 UTC |

**常駐メモリ合計: ~1,338MB** (4GB VPS で余裕あり)
一時起動コンテナは実行中のみメモリ消費、終了後 0。

#### 監視・エラー通知の役割分担

| ツール | 役割 | 常駐 |
|--------|------|------|
| **Sentry** | エラー発生時に即通知 + スタックトレース | 外部 SaaS (無料枠) |
| **Loki** | 全ログを保存・検索可能にする | コンテナ常駐 |
| **Grafana** | ログ検索 UI + ダッシュボード | コンテナ常駐 |

**重要: api-python と batch は独立したコンテナ。**
- **api-python**: HTTP リクエストに応答する常駐サービス（signal, regime, exit, stock）
- **batch**: cron で一時起動するジョブ。HTTP サーバーなし。データ取得 → DB 書き込み
- 両方 Python だが、コードベースも依存関係も別。共有するのは DB と Redis のみ

---

## 3. nginx 設計

```nginx
# /etc/nginx/conf.d/default.conf

upstream frontend {
    server frontend:3000;
}
upstream api_go {
    server api-go:8080;
}
upstream api_python {
    server api-python:8081;
}

# ─── メインサイト: open-regime.com ───
server {
    listen 80;
    server_name open-regime.com;

    location /health {
        access_log off;
        return 200 'ok';
    }

    # 計算 API → Python
    location ~ ^/api/(signal|regime|exit|stock)(/|$) {
        proxy_pass http://api_python;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }

    # CRUD API → Go
    location /api/ {
        proxy_pass http://api_go;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 10s;
    }

    # Frontend → Next.js
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    access_log /var/log/nginx/access.log json_combined;
}

# ─── Admin: admin.open-regime.com (CF Access で保護) ───
server {
    listen 80;
    server_name admin.open-regime.com;

    # Admin API → api-go (admin/* エンドポイント)
    location /api/ {
        proxy_pass http://api_go;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Admin Frontend → admin-frontend コンテナ (独立)
    location / {
        proxy_pass http://admin-frontend:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    access_log /var/log/nginx/admin-access.log json_combined;
}

# ─── Grafana: grafana.open-regime.com (CF Access で保護) ───
server {
    listen 80;
    server_name grafana.open-regime.com;

    location / {
        proxy_pass http://grafana:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    access_log /var/log/nginx/grafana-access.log json_combined;
}
```

### ルーティングルール

#### open-regime.com (メインサイト)

| パス | 転送先 | 理由 |
|------|--------|------|
| `/api/signal/*` | api-python | yfinance + 分析ロジック |
| `/api/regime` | api-python | yfinance + RegimeDetector |
| `/api/exit/*` | api-python | yfinance + エグジット分析 |
| `/api/stock/*` | api-python | yfinance + 株価データ |
| `/api/liquidity/*` | api-go | DB 読み取りのみ (yfinance 不要) |
| `/api/employment/*` | api-go | DB 読み取りのみ |
| `/api/holdings/*` | api-go | ユーザー CRUD |
| `/api/trades/*` | api-go | ユーザー CRUD |
| `/api/watchlist/*` | api-go | ユーザー CRUD |
| `/api/me` | api-go | ユーザープロフィール |
| `/api/stocks` | api-go | 銘柄マスター |
| `/api/market-state/*` | api-go | 市場状態 CRUD |
| `/api/fx/*` | api-go | 為替 (HTTP 直接、yfinance 不要) |
| `/api/auth/*` | api-go | Google OAuth + JWT |
| `/*` | frontend | Next.js SSR |

#### admin.open-regime.com (管理画面 — CF Access 保護)

| パス | 転送先 | 理由 |
|------|--------|------|
| `/api/admin/*` | api-go | ユーザー管理、統計、機能フラグ |
| `/api/admin/mfa/*` | api-go | TOTP MFA (セットアップ・検証) |
| `/*` | admin-frontend:3002 | Admin UI (Next.js SSR、独立コンテナ) |

#### grafana.open-regime.com (ログ閲覧 — CF Access 保護)

| パス | 転送先 | 理由 |
|------|--------|------|
| `/*` | grafana:3000 | ダッシュボード・ログ検索 |

### サブドメイン DNS 設定 (Cloudflare)

| レコード | タイプ | 値 | Proxy |
|----------|--------|-----|-------|
| `open-regime.com` | A | VPS IP | ON (CF Proxy) |
| `admin.open-regime.com` | A | VPS IP | ON (CF Proxy) |
| `grafana.open-regime.com` | A | VPS IP | ON (CF Proxy) |

**CF Access 保護**: `admin.open-regime.com` と `grafana.open-regime.com` に CF Access ポリシーを設定。自分のメールアドレスのみアクセス許可。

### Admin セキュリティ (3 層)

| 層 | 仕組み | 実装場所 |
|----|--------|----------|
| 1. **CF Access** | サイトへのアクセス自体をブロック | Cloudflare Dashboard |
| 2. **ADMIN_EMAILS** | メール検証 (環境変数のリストと照合) | api-go middleware |
| 3. **TOTP MFA** | 二要素認証 (6 桁コード + セッショントークン) | api-go handler |

既存の Python 実装 (admin.py, admin_mfa.py) を Go に移植する。ロジックは同じ。

**注意**: `/api/liquidity/*` と `/api/employment/*` は現在 Python だが yfinance を使っていない。DB からの SELECT + 集計のみなので Go に移行可能。

---

## 4. api-go 設計 (CRUD + 認証)

### 技術スタック

| 項目 | 選定 | 理由 |
|------|------|------|
| フレームワーク | **Echo v4** or **Chi** | 軽量、ミドルウェアチェーン、標準的 |
| DB ドライバ | **pgx v5** | PostgreSQL ネイティブ、コネクションプール内蔵 |
| JWT | **golang-jwt/jwt/v5** | 標準的な JWT ライブラリ |
| TOTP (MFA) | **pquerna/otp** | TOTP 生成・検証 |
| Redis | **redis/go-redis/v9** | Go 標準 Redis クライアント |
| 暗号化 | **crypto/aes** (stdlib) | MFA シークレット暗号化 |
| バリデーション | **go-playground/validator** | 構造体バリデーション |
| ログ | **slog** (stdlib) | Go 1.21+ 標準構造化ログ |

### ディレクトリ構成

```
api-go/
├── cmd/
│   └── server/
│       └── main.go              # エントリーポイント
├── internal/
│   ├── config/
│   │   └── config.go            # 環境変数読み込み
│   ├── middleware/
│   │   ├── auth.go              # JWT 検証 + ユーザー解決
│   │   ├── cors.go              # CORS
│   │   ├── ratelimit.go         # Redis ベースレート制限
│   │   └── security.go          # セキュリティヘッダー
│   ├── handler/
│   │   ├── holdings.go          # 15 endpoints
│   │   ├── trades.go            # 6 endpoints
│   │   ├── watchlist.go         # 6 endpoints
│   │   ├── stocks.go            # 3 endpoints
│   │   ├── market_state.go      # 3 endpoints
│   │   ├── users.go             # 2 endpoints
│   │   ├── fx.go                # 1 endpoint
│   │   ├── liquidity.go         # 12 endpoints (DB読みのみ)
│   │   ├── employment.go        # 5 endpoints (DB読みのみ)
│   │   ├── admin.go             # 8 endpoints
│   │   └── admin_mfa.go         # 5 endpoints
│   ├── model/
│   │   ├── user.go
│   │   ├── holding.go
│   │   ├── trade.go
│   │   └── ...                  # 各テーブルの構造体
│   ├── repository/
│   │   ├── user_repo.go         # users テーブル操作
│   │   ├── holding_repo.go
│   │   ├── trade_repo.go
│   │   └── ...                  # 各テーブルの DB 操作
│   └── service/
│       ├── auth_service.go      # JWT 検証、ユーザー解決ロジック
│       └── mfa_service.go       # TOTP + AES 暗号化
├── Dockerfile
├── go.mod
└── go.sum
```

### JWT 認証フロー (Python auth.py → Go 移植)

### Google OAuth 自前実装 (Supabase Auth 廃止)

```
フロー:
  ユーザー → Frontend「Googleでログイン」ボタン
    → /api/auth/google (api-go)
    → Google OAuth 同意画面にリダイレクト
    → Google がコールバック: /api/auth/google/callback
    → api-go: Google トークン検証 → ユーザー作成/取得 → 自前 JWT 発行
    → Frontend にリダイレクト (JWT をクエリパラメータ or cookie で渡す)
```

```go
// internal/handler/auth.go

// GET /api/auth/google → Google OAuth 同意画面にリダイレクト
func (h *AuthHandler) GoogleLogin(c echo.Context) error {
    state := generateCSRFState()
    h.redis.Set(ctx, "oauth_state:"+state, "1", 10*time.Minute)
    url := h.googleOAuth.AuthCodeURL(state)
    return c.Redirect(302, url)
}

// GET /api/auth/google/callback → トークン交換 + JWT 発行
func (h *AuthHandler) GoogleCallback(c echo.Context) error {
    // 1. CSRF state 検証
    state := c.QueryParam("state")
    if !h.redis.Exists(ctx, "oauth_state:"+state) {
        return echo.NewHTTPError(400, "invalid state")
    }

    // 2. Google にトークン交換
    code := c.QueryParam("code")
    token, _ := h.googleOAuth.Exchange(ctx, code)

    // 3. Google からユーザー情報取得
    userInfo, _ := h.getGoogleUserInfo(token.AccessToken)

    // 4. DB にユーザー作成 or 取得
    user, _ := h.userRepo.FindOrCreateByOAuth(ctx, userInfo.Email, "google", userInfo.Sub)

    // 5. 自前 JWT 発行 (HS256, 24h 有効)
    jwt, _ := h.authSvc.IssueJWT(user.ID, user.Email)

    // 6. JWT を HttpOnly Cookie にセットして Frontend にリダイレクト
    c.SetCookie(&http.Cookie{
        Name:     "token",
        Value:    jwt,
        Path:     "/",
        HttpOnly: true,
        Secure:   true,           // HTTPS のみ (CF Proxy 経由)
        SameSite: http.SameSiteLaxMode,
        MaxAge:   86400,          // 24h
    })
    return c.Redirect(302, h.cfg.FrontendURL+"/auth/callback")
}

// POST /api/auth/refresh → JWT リフレッシュ (Cookie から読み取り → 新 Cookie 発行)
func (h *AuthHandler) RefreshToken(c echo.Context) error {
    cookie, err := c.Cookie("token")
    if err != nil {
        return echo.NewHTTPError(401, "no token cookie")
    }
    claims, _ := h.authSvc.ValidateJWT(cookie.Value)
    newJWT, _ := h.authSvc.IssueJWT(claims.UserID, claims.Email)
    c.SetCookie(&http.Cookie{
        Name:     "token",
        Value:    newJWT,
        Path:     "/",
        HttpOnly: true,
        Secure:   true,
        SameSite: http.SameSiteLaxMode,
        MaxAge:   86400,
    })
    return c.JSON(200, map[string]string{"status": "refreshed"})
}
```

### JWT 認証ミドルウェア (自前 JWT 検証)

```go
// internal/middleware/auth.go

func AuthMiddleware(authSvc *service.AuthService) echo.MiddlewareFunc {
    return func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c echo.Context) error {
            // 1. HttpOnly Cookie からトークン取得
            cookie, err := c.Cookie("token")
            if err != nil || cookie.Value == "" {
                return echo.NewHTTPError(401, "missing token")
            }

            // 2. 自前 JWT 検証 (HS256, 自前の JWT_SECRET)
            claims, err := authSvc.ValidateJWT(cookie.Value)
            if err != nil {
                return echo.NewHTTPError(401, "invalid token")
            }

            // 3. ユーザー存在確認 (Redis キャッシュ TTL 5分)
            user, err := authSvc.GetUser(c.Request().Context(), claims.UserID)
            if err != nil || !user.IsActive {
                return echo.NewHTTPError(401, "user not found")
            }

            // 4. コンテキストにセット
            c.Set("user_id", user.ID)
            c.Set("email", user.Email)
            return next(c)
        }
    }
}
```

### DB アクセスパターン (Supabase REST → pgx 直接)

```go
// 現在 (Python + Supabase REST)
// supabase.table("holdings").select("*").eq("user_id", uid).execute()

// 移行後 (Go + pgx)
func (r *HoldingRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]model.Holding, error) {
    rows, err := r.pool.Query(ctx,
        `SELECT id, user_id, ticker, quantity, avg_cost, account, created_at, updated_at
         FROM holdings
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        userID,
    )
    if err != nil {
        return nil, err
    }
    return pgx.CollectRows(rows, pgx.RowToStructByName[model.Holding])
}
```

### エンドポイント一覧 (66 endpoints)

#### ユーザー CRUD (39 endpoints)
```
GET    /api/holdings              → ListHoldings
POST   /api/holdings              → CreateHolding
PUT    /api/holdings/:id          → UpdateHolding
DELETE /api/holdings/:id          → DeleteHolding
GET    /api/holdings/stats        → HoldingStats
GET    /api/holdings/init         → InitHoldings (holdings + cash + fx)
GET    /api/holdings/portfolio-history → PortfolioHistory
GET    /api/holdings/cash         → ListCash
POST   /api/holdings/cash         → CreateCash
PUT    /api/holdings/cash/:id     → UpdateCash
DELETE /api/holdings/cash/:id     → DeleteCash
POST   /api/holdings/rebalance    → Rebalance (if exists)
...残りの holdings endpoints

GET    /api/trades                → ListTrades
POST   /api/trades                → CreateTrade
PATCH  /api/trades/:id            → UpdateTrade
DELETE /api/trades/:id            → DeleteTrade
GET    /api/trades/stats          → TradeStats
POST   /api/trades/sell-from-holding → SellFromHolding

GET    /api/watchlist             → ListWatchlists
POST   /api/watchlist             → CreateWatchlist
PUT    /api/watchlist/:id         → UpdateWatchlist
DELETE /api/watchlist/:id         → DeleteWatchlist
POST   /api/watchlist/add-ticker  → AddTicker
POST   /api/watchlist/remove-ticker → RemoveTicker

GET    /api/me                    → GetProfile
PATCH  /api/me                    → UpdateProfile

GET    /api/stocks                → ListStocks
GET    /api/stocks/:ticker        → GetStock
GET    /api/stocks/categories/list → ListCategories

GET    /api/market-state          → ListMarketState
GET    /api/market-state/latest   → LatestMarketState
POST   /api/market-state          → RecordMarketState

GET    /api/fx/usdjpy             → GetUSDJPY (Yahoo HTTP直接、yfinance不要)
```

#### データ読み取り (17 endpoints, DB SELECT のみ)
```
GET    /api/liquidity/plumbing         → PlumbingData
GET    /api/liquidity/market-state     → LiquidityMarketState
GET    /api/liquidity/events           → MarketEvents
GET    /api/liquidity/policy-regime    → PolicyRegime
GET    /api/liquidity/overview         → LiquidityOverview
GET    /api/liquidity/plumbing-summary → PlumbingSummary
GET    /api/liquidity/fed-balance-sheet → FedBalanceSheet
GET    /api/liquidity/interest-rates   → InterestRates
GET    /api/liquidity/credit-spreads   → CreditSpreads
GET    /api/liquidity/market-indicators → MarketIndicators
GET    /api/liquidity/history-charts   → HistoryCharts
GET    /api/liquidity/backtest-states  → BacktestStates

GET    /api/employment/overview        → EmploymentOverview
GET    /api/employment/indicators      → EconomicIndicators
GET    /api/employment/weekly-claims   → WeeklyClaims
GET    /api/employment/risk-score      → RiskScore
GET    /api/employment/risk-history    → RiskHistory
```

#### 認証 (4 endpoints, Google OAuth 自前)
```
GET    /api/auth/google              → GoogleLogin (OAuth 同意画面へリダイレクト)
GET    /api/auth/google/callback     → GoogleCallback (トークン交換 + JWT 発行)
POST   /api/auth/refresh             → RefreshToken (JWT リフレッシュ)
GET    /api/auth/me                  → AuthMe (トークン検証 + ユーザー情報)
```

#### Admin (10 endpoints)
```
GET    /api/admin/users                → ListUsers
PATCH  /api/admin/users/:id            → UpdateUser
GET    /api/admin/audit-logs           → AuditLogs

GET    /api/admin/mfa/status           → MFAStatus
POST   /api/admin/mfa/setup            → MFASetup (TOTP secret + QR)
POST   /api/admin/mfa/setup/verify     → MFAVerifySetup
POST   /api/admin/mfa/verify           → MFAVerify
GET    /api/admin/mfa/session          → MFASessionCheck
```

---

## 5. api-python 設計 (計算のみ)

### 変更点

現在の `app/backend/` をベースに **CRUD ルーターを全削除**、計算ルーターのみ残す。

```python
# main.py (大幅に簡略化)
app = FastAPI(title="Open Regime Compute API")

# ルーター: 計算のみ
app.include_router(signal_router, prefix="/api")      # 6 endpoints
app.include_router(regime_router, prefix="/api")       # 2 endpoints
app.include_router(exit_router, prefix="/api")         # 2 endpoints
app.include_router(stock_router, prefix="/api")        # 8 endpoints

# 削除するルーター:
# holdings, trades, watchlist, users, stocks, market_state,
# fx, admin, admin_mfa, liquidity, employment
# → 全て api-go に移行
```

### 認証の簡略化

```python
# CRUD の認証は api-go が担当
# api-python は nginx 経由のリクエストのみ受ける
# → 内部ネットワークからのアクセスのみ許可

# シンプルな内部認証:
# 1. nginx が X-Internal-Secret ヘッダーを付与
# 2. api-python はそのヘッダーを検証するだけ
# 3. ユーザー認証が必要なエンドポイント (exit) は
#    Authorization ヘッダーを nginx がそのまま転送
```

### DB 接続

```python
# Supabase REST → PostgreSQL 直接接続 (asyncpg)
# asyncpg は requirements.txt に既にある (未使用だった)

import asyncpg

pool = await asyncpg.create_pool(
    host="postgres",        # Docker 内部ネットワーク
    port=5432,
    database="open_regime",
    user="app",
    password=os.environ["DB_PASSWORD"],
    min_size=2,
    max_size=10,
)
```

---

## 6. PostgreSQL 設計

### Supabase → セルフホスト移行

```sql
-- 初期化スクリプト: init.sql
-- Supabase のスキーマをそのまま再現

-- ユーザー
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    plan TEXT DEFAULT 'free',
    auth_provider TEXT DEFAULT 'google',
    auth_provider_id TEXT UNIQUE,
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ポートフォリオ
CREATE TABLE holdings (...);
CREATE TABLE trades (...);
CREATE TABLE cash_balances (...);
CREATE TABLE user_watchlists (...);

-- マーケットデータ
CREATE TABLE stock_master (...);
CREATE TABLE market_state_history (...);
CREATE TABLE fed_balance_sheet (...);
CREATE TABLE interest_rates (...);
CREATE TABLE credit_spreads (...);
CREATE TABLE market_indicators (...);
CREATE TABLE bank_sector (...);
CREATE TABLE srf_usage (...);
CREATE TABLE margin_debt (...);
CREATE TABLE mmf_assets (...);

-- 雇用統計
CREATE TABLE economic_indicators (...);
CREATE TABLE weekly_claims (...);

-- 計算済み
CREATE TABLE layer_stress_history (...);
CREATE TABLE precomputed_results (...);

-- Admin
CREATE TABLE admin_mfa (...);
CREATE TABLE admin_mfa_sessions (...);
CREATE TABLE admin_audit_logs (...);

-- バッチ
CREATE TABLE batch_logs (...);
CREATE TABLE data_revisions (...);

-- インデックス (既存のものを全て移行)
CREATE INDEX idx_holdings_user ON holdings(user_id);
CREATE INDEX idx_trades_user ON trades(user_id);
...
```

### 認証フロー (Google OAuth 自前実装、Supabase Auth 廃止)

```
ユーザー
  │
  │ 「Google でログイン」ボタン
  │
  ▼
Frontend
  │
  │ GET /api/auth/google
  │
  ▼
api-go
  │
  │ → Google OAuth 同意画面にリダイレクト
  │ ← Google がコールバック (/api/auth/google/callback)
  │ → Google API でユーザー情報取得 (email, sub)
  │ → PostgreSQL users テーブルに作成 or 取得
  │ → 自前 JWT 発行 (HS256, JWT_SECRET, 24h 有効)
  │ → Frontend にリダイレクト (?token=xxx)
  │
  ▼
Frontend
  │ JWT は HttpOnly Cookie に自動保存 (Set-Cookie ヘッダー)
  │ 以降のリクエストでブラウザが Cookie を自動送信
  │ (XSS で JWT を盗めない)
  │
  ▼
api-go / api-python
  │ Cookie から JWT を読み取り → 署名検証 (自前 JWT_SECRET)
  │ user_id をコンテキストにセット
```

**Supabase Auth 完全廃止。** Supabase JS SDK も Frontend から削除。
Google OAuth は Google Cloud Console で直接設定（redirect_uri を api-go に向ける）。
`handle_new_user` トリガーも不要（api-go が OAuth コールバックでユーザー作成）。

### バックアップ戦略

```bash
# batch コンテナの cron で実行
# 毎日 3:00 JST

pg_dump -h postgres -U app open_regime \
  | gzip \
  | aws s3 cp - s3://open-regime-backups/db/$(date +%Y%m%d).sql.gz \
    --endpoint-url https://xxx.r2.cloudflarestorage.com

# R2 は S3 互換なので aws cli がそのまま使える
# 保持期間: 30日 (R2 lifecycle rule)
```

---

## 7. batch コンテナ設計

### cron スケジュール (ホスト OS cron)

コンテナ内に cron デーモンは入れない。ホスト OS の crontab から `docker compose run --rm` で起動する。

```crontab
# /etc/cron.d/open-regime (ホスト OS 側)

# 日次: 市場データ取得 (7:30 JST = 22:30 UTC)
30 22 * * * deploy cd /opt/open-regime && docker compose run --rm batch python run.py --daily >> /var/log/open-regime/daily.log 2>&1

# 週次: FRB + 雇用 + レイヤー再計算 (土曜 8:00 JST = 金曜 23:00 UTC)
0 23 * * 5 deploy cd /opt/open-regime && docker compose run --rm batch python run.py --weekly >> /var/log/open-regime/weekly.log 2>&1

# DB バックアップ (毎日 3:00 JST = 18:00 UTC)
0 18 * * * deploy cd /opt/open-regime && docker compose run --rm r2-uploader >> /var/log/open-regime/backup.log 2>&1
```

### DB 接続変更

```python
# 現在: Supabase REST API
from supabase import create_client
supabase = create_client(url, key)
supabase.table("fed_balance_sheet").upsert(data).execute()

# 移行後: PostgreSQL 直接 (psycopg2 or asyncpg)
import psycopg2

conn = psycopg2.connect(
    host="postgres",
    dbname="open_regime",
    user="app",
    password=os.environ["DB_PASSWORD"]
)
# INSERT ... ON CONFLICT DO UPDATE (upsert)
```

### R2 連携スクリプト

```bash
#!/bin/bash
# scripts/upload-logs.sh

DATE=$(date -d "yesterday" +%Y%m%d)

# nginx アクセスログ
gzip -c /var/log/nginx/access.log > /tmp/nginx-${DATE}.log.gz
aws s3 cp /tmp/nginx-${DATE}.log.gz \
  s3://open-regime-logs/nginx/${DATE}.log.gz \
  --endpoint-url $R2_ENDPOINT

# API ログ
for svc in api-go api-python batch; do
  if [ -f /var/log/${svc}/${DATE}.log ]; then
    gzip -c /var/log/${svc}/${DATE}.log > /tmp/${svc}-${DATE}.log.gz
    aws s3 cp /tmp/${svc}-${DATE}.log.gz \
      s3://open-regime-logs/${svc}/${DATE}.log.gz \
      --endpoint-url $R2_ENDPOINT
  fi
done
```

---

## 8. Frontend 設計変更

### Static Export → SSR

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  // output: 'export' を削除
  // → SSR モードに変更 (VPS で Node.js が動いてるので可能)
  images: {
    // unoptimized: true を削除
    // → Next.js Image Optimization が使える
    remotePatterns: [
      { protocol: 'https', hostname: '**.googleusercontent.com' },
    ],
  },
  // trailingSlash: true を維持 (SEO 一貫性)
};
```

### API URL 変更

```typescript
// 現在: 外部 Worker URL
// NEXT_PUBLIC_API_URL=https://api.open-regime.com

// 移行後: 同一オリジン (nginx がルーティング)
// NEXT_PUBLIC_API_URL=  (空 or 相対パス)
// fetch('/api/holdings') → nginx → api-go

// メリット:
// - CORS 不要 (同一オリジン)
// - Cookie ベース認証も可能に (将来)
// - レイテンシ最小 (ローカルネットワーク)
```

### SEO 対応 (SSR のメリット)

```typescript
// app/layout.tsx
export const metadata: Metadata = {
  title: 'Open Regime - 市場レジーム分析プラットフォーム',
  description: '流動性ストレス、雇用リスク、SMC シグナルを統合した投資判断ツール',
  openGraph: {
    title: 'Open Regime',
    description: '...',
    url: 'https://open-regime.com',
    siteName: 'Open Regime',
    locale: 'ja_JP',
    type: 'website',
  },
};

// app/sitemap.ts
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://open-regime.com', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: 'https://open-regime.com/signals/', lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    // ...
  ];
}

// app/robots.ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: 'https://open-regime.com/sitemap.xml',
  };
}
```

### Google Analytics (GA4)

```typescript
// app/layout.tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}');
          `}
        </Script>
      </body>
    </html>
  );
}
```

---

## 9. Stripe 連携設計

### 構成

```
Frontend                  api-go                    Stripe
  │                         │                         │
  │ POST /api/billing       │                         │
  │ /create-checkout ──────→│                         │
  │                         │── stripe.CheckoutSession│
  │                         │   .Create() ───────────→│
  │                         │←── checkout URL ────────│
  │←── redirect URL ────────│                         │
  │                         │                         │
  │                         │                         │
  │                         │←── POST /api/billing    │
  │                         │    /webhook ─────────── │
  │                         │    (署名検証)            │
  │                         │    → users.plan 更新    │
  │                         │    → Resend で確認メール│
```

### api-go の Stripe ハンドラー

```go
// internal/handler/billing.go

// POST /api/billing/create-checkout
func (h *BillingHandler) CreateCheckout(c echo.Context) error {
    userID := c.Get("user_id").(uuid.UUID)

    params := &stripe.CheckoutSessionParams{
        Mode: stripe.String("subscription"),
        LineItems: []*stripe.CheckoutSessionLineItemParams{{
            Price:    stripe.String(h.cfg.StripePriceID),
            Quantity: stripe.Int64(1),
        }},
        SuccessURL:        stripe.String(h.cfg.FrontendURL + "/settings?payment=success"),
        CancelURL:         stripe.String(h.cfg.FrontendURL + "/settings?payment=cancel"),
        ClientReferenceID: stripe.String(userID.String()),
    }

    session, err := session.New(params)
    if err != nil {
        return echo.NewHTTPError(500, "stripe error")
    }
    return c.JSON(200, map[string]string{"url": session.URL})
}

// POST /api/billing/webhook (認証不要、Stripe 署名で検証)
func (h *BillingHandler) Webhook(c echo.Context) error {
    payload, _ := io.ReadAll(c.Request().Body)
    sig := c.Request().Header.Get("Stripe-Signature")

    event, err := webhook.ConstructEvent(payload, sig, h.cfg.StripeWebhookSecret)
    if err != nil {
        return echo.NewHTTPError(400, "invalid signature")
    }

    switch event.Type {
    case "checkout.session.completed":
        // users.plan = 'pro' に更新
        // Resend でウェルカムメール送信
    case "customer.subscription.deleted":
        // users.plan = 'free' にダウングレード
    }

    return c.NoContent(200)
}
```

---

## 10. docker-compose.yml

```yaml
version: "3.9"

services:
  # ─── リバースプロキシ ───
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - logs:/var/log/nginx
    depends_on:
      frontend:
        condition: service_healthy
      api-go:
        condition: service_healthy
      api-python:
        condition: service_healthy
    mem_limit: 64m
    cpus: 0.25
    restart: unless-stopped

  # ─── フロントエンド ───
  frontend:
    build:
      context: ./app/frontend
      dockerfile: Dockerfile
    environment:
      - NEXT_PUBLIC_API_URL=          # 空 (同一オリジン、nginx がルーティング)
      - NEXT_PUBLIC_SENTRY_DSN=${SENTRY_DSN_FRONTEND}
      - NEXT_PUBLIC_GA_ID=${GA_ID}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/"]
      interval: 30s
      timeout: 5s
      retries: 3
    mem_limit: 256m
    cpus: 0.5
    restart: unless-stopped

  # ─── Go API (CRUD + 認証) ───
  api-go:
    build:
      context: ./api-go
      dockerfile: Dockerfile
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
      - GOOGLE_REDIRECT_URL=https://open-regime.com/api/auth/google/callback
      - FRONTEND_URL=https://open-regime.com
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
      - STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
      - STRIPE_PRICE_ID=${STRIPE_PRICE_ID}
      - RESEND_API_KEY=${RESEND_API_KEY}
      - ADMIN_EMAILS=${ADMIN_EMAILS}
      - MFA_ENCRYPTION_KEY=${MFA_ENCRYPTION_KEY}
      - SENTRY_DSN=${SENTRY_DSN_GO}
      - ENVIRONMENT=production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    mem_limit: 128m
    cpus: 0.5
    restart: unless-stopped

  # ─── Python API (計算) ───
  api-python:
    build:
      context: ./app/backend
      dockerfile: Dockerfile
    environment:
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=open_regime
      - DB_USER=app
      - DB_PASSWORD=${DB_PASSWORD}
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - SENTRY_DSN=${SENTRY_DSN_PYTHON}
      - ENVIRONMENT=production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8081/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    mem_limit: 512m
    cpus: 1.0
    restart: unless-stopped

  # ─── Redis ───
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 100mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    mem_limit: 128m
    cpus: 0.25
    restart: unless-stopped

  # ─── PostgreSQL ───
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=open_regime
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d open_regime"]
      interval: 10s
      timeout: 3s
      retries: 5
    mem_limit: 512m
    cpus: 1.0
    restart: unless-stopped

  # ─── Loki (ログ保存・検索) ───
  loki:
    image: grafana/loki:2.9.0
    command: -config.file=/etc/loki/local-config.yaml
    volumes:
      - loki_data:/loki
    mem_limit: 256m
    cpus: 0.25
    restart: unless-stopped

  # ─── Promtail (ログ転送: Docker → Loki) ───
  promtail:
    image: grafana/promtail:2.9.0
    volumes:
      - ./promtail/config.yml:/etc/promtail/config.yml:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: -config.file=/etc/promtail/config.yml
    depends_on:
      - loki
    mem_limit: 128m
    cpus: 0.25
    restart: unless-stopped

  # ─── Grafana (ダッシュボード) ───
  grafana:
    image: grafana/grafana:10.0.0
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      - GF_SERVER_ROOT_URL=https://grafana.open-regime.com/
    volumes:
      - grafana_data:/var/lib/grafana
    mem_limit: 256m
    cpus: 0.5
    restart: unless-stopped

  # ─── Batch (一時起動、ホスト OS cron) ───
  batch:
    build:
      context: ./app/batch
      dockerfile: Dockerfile
    environment:
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=open_regime
      - DB_USER=app
      - DB_PASSWORD=${DB_PASSWORD}
      - FRED_API_KEY=${FRED_API_KEY}
      - REDIS_URL=redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
    profiles:
      - tools    # docker compose up では起動しない

  # ─── R2 Uploader (一時起動、ホスト OS cron) ───
  r2-uploader:
    build:
      context: ./r2-uploader
      dockerfile: Dockerfile
    environment:
      - DB_HOST=postgres
      - DB_USER=app
      - DB_PASSWORD=${DB_PASSWORD}
      - DB_NAME=open_regime
      - R2_ENDPOINT=${R2_ENDPOINT}
      - R2_ACCESS_KEY=${R2_ACCESS_KEY}
      - R2_SECRET_KEY=${R2_SECRET_KEY}
    depends_on:
      postgres:
        condition: service_healthy
    profiles:
      - tools    # docker compose up では起動しない

volumes:
  pg_data:
  redis_data:
  loki_data:
  grafana_data:
```

---

## 11. CI/CD (GitHub Actions → SSH Deploy)

```yaml
# .github/workflows/deploy.yml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker images
        run: |
          docker compose build --parallel

      - name: Push to GitHub Container Registry
        run: |
          echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin
          docker compose push

      - name: Deploy to VPS via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/open-regime
            git pull origin main
            docker compose pull
            docker compose up -d --remove-orphans
            docker system prune -f
```

---

## 12. セキュリティ設計

### ネットワーク分離

```
外部公開: nginx :80 のみ
  │
  │ CF Proxy (SSL 終端)
  │
  ▼
┌───────────────── Docker Network (internal) ──────────────────┐
│                                                               │
│  nginx ──→ frontend :3000                                    │
│       ──→ api-go :8080                                       │
│       ──→ api-python :8081                                   │
│                                                               │
│  api-go ──→ postgres :5432                                   │
│         ──→ redis :6379                                      │
│                                                               │
│  api-python ──→ postgres :5432                               │
│             ──→ redis :6379                                  │
│                                                               │
│  batch ──→ postgres :5432                                    │
│        ──→ redis :6379                                       │
│        ──→ R2 (外部 HTTPS)                                   │
│                                                               │
│  ⛔ postgres, redis は外部ポート公開しない                    │
└───────────────────────────────────────────────────────────────┘
```

### CF Proxy によるオリジン保護

```
ユーザー → CF Edge (SSL) → VPS :80 (HTTP)

# nginx で CF の IP レンジのみ許可
# https://www.cloudflare.com/ips/
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
...
real_ip_header CF-Connecting-IP;

# CF 以外からのアクセスを拒否
deny all;
```

### VPS ファイアウォール

```bash
# ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH (鍵認証のみ)
ufw allow 80/tcp    # HTTP (CF Proxy から)
ufw enable

# SSH: パスワード認証無効化、鍵認証のみ
```

---

## 13. 監視・ログ (Sentry + Loki + Grafana)

### ヘルスチェック

```
nginx /health → 200
api-go /health → { "status": "ok", "db": "ok", "redis": "ok" }
api-python /health → { "status": "ok", "db": "ok" }
postgres pg_isready
redis redis-cli ping
```

### Sentry (エラー即時通知)

```
api-go      → Sentry Go SDK (5xx のみ、即通知 + スタックトレース)
api-python  → Sentry Python SDK (既に導入済み)
frontend    → Sentry JS SDK (既に導入済み)

用途: エラーが起きた瞬間に気づく
```

### Loki + Grafana (ログ検索 + ダッシュボード)

```
ログの流れ:
  nginx       → stdout → Docker log driver → Loki
  api-go      → stdout → Docker log driver → Loki
  api-python  → stdout → Docker log driver → Loki
  batch       → stdout → Docker log driver → Loki
  postgres    → stdout → Docker log driver → Loki
                                               │
                                               ▼
                                           Grafana
                                      https://grafana.open-regime.com/
                                      (CF Access で管理者のみアクセス可)

用途: 「3日前の14:32に何が起きた？」を検索
      エラー率、レスポンスタイム等のダッシュボード
```

### DB バックアップ (r2-uploader)

```
r2-uploader (毎日 18:00 UTC = 3:00 JST、ホスト OS cron で一時起動)
  → pg_dump → gzip → R2

R2 バケット: open-regime-backups/
  └── db/20260324.sql.gz

保持期間: 30日 (R2 lifecycle rule)
```

---

## 14. Makefile

```makefile
.PHONY: up down build logs backup deploy

# ─── 開発 ───
up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build --parallel

logs:
	docker compose logs -f --tail=100

logs-go:
	docker compose logs -f api-go

logs-python:
	docker compose logs -f api-python

# ─── DB ───
db-shell:
	docker compose exec postgres psql -U app open_regime

db-backup:
	docker compose exec batch /app/scripts/backup-db.sh

db-restore:
	@echo "Usage: cat backup.sql | docker compose exec -T postgres psql -U app open_regime"

# ─── デプロイ ───
deploy:
	git pull origin main
	docker compose build --parallel
	docker compose up -d --remove-orphans
	docker system prune -f

# ─── 監視 ───
health:
	@curl -s http://localhost/health && echo " nginx: ok"
	@curl -s http://localhost:8080/health | jq . && echo " api-go: ok"
	@curl -s http://localhost:8081/health | jq . && echo " api-python: ok"

status:
	docker compose ps
```

---

## 15. VPS 推奨スペック

| プロバイダ | プラン | スペック | 月額 | 東京 |
|-----------|--------|---------|------|------|
| **ConoHa** | 4GB | 4vCPU / 4GB / 100GB SSD | ¥3,608 | ✅ |
| **ConoHa** | 8GB | 6vCPU / 8GB / 100GB SSD | ¥7,348 | ✅ |
| さくら VPS | 4GB | 4vCPU / 4GB / 200GB | ¥3,227 | ✅ |
| Vultr | VC2 4GB | 2vCPU / 4GB / 80GB | $24 (~¥3,600) | ✅ |

**推奨: ConoHa 4GB (¥3,608/月)** — 東京リージョン、x86_64、Docker フル対応。
メモリ合計 ~1.3GB 常駐なので 4GB で十分。余裕が欲しければ 8GB に上げる。

---

## 16. データ移行手順

### Supabase → セルフホスト PostgreSQL

```bash
# 1. Supabase からデータダンプ
pg_dump "postgresql://postgres:[password]@db.xndbmsrscozqyksstzop.supabase.co:5432/postgres" \
  --schema=public \
  --data-only \
  --no-owner \
  --no-privileges \
  > supabase_data.sql

# 2. VPS の PostgreSQL にスキーマ作成
docker compose exec -T postgres psql -U app open_regime < db/init/01_schema.sql

# 3. データ投入
docker compose exec -T postgres psql -U app open_regime < supabase_data.sql

# 4. シーケンスリセット
docker compose exec postgres psql -U app open_regime -c \
  "SELECT setval(pg_get_serial_sequence(t, 'id'), COALESCE(max(id), 0) + 1, false) FROM ..."

# 5. 検証
docker compose exec postgres psql -U app open_regime -c \
  "SELECT tablename, n_tup_ins FROM pg_stat_user_tables ORDER BY tablename;"
```

---

## 17. 実装順序

### Phase 1: 基盤 (Docker + PostgreSQL + Redis)

```
□ VPS 契約 (ConoHa 4vCPU/8GB)
□ Docker + Docker Compose インストール
□ リポジトリ構造変更 (api-go/ ディレクトリ作成)
□ PostgreSQL コンテナ + 初期化スクリプト
□ Redis コンテナ
□ nginx コンテナ + ルーティング設定
□ CF DNS 設定 (A レコード → VPS IP, Proxy mode)
□ ufw + SSH 鍵認証設定
```

### Phase 2: api-go (Go CRUD API)

```
□ Go プロジェクト初期化 (go mod init)
□ config: 環境変数読み込み
□ DB: pgx コネクションプール
□ handler: /api/auth/google (OAuth ログイン + コールバック + JWT 発行)
□ middleware: JWT 認証 (自前 JWT 検証)
□ middleware: CORS + セキュリティヘッダー
□ middleware: Redis レート制限
□ handler: /api/me (2ep) — 最初のテスト
□ handler: /api/holdings/* (15ep)
□ handler: /api/trades/* (6ep)
□ handler: /api/watchlist/* (6ep)
□ handler: /api/stocks (3ep)
□ handler: /api/market-state/* (3ep)
□ handler: /api/fx/usdjpy (1ep)
□ handler: /api/liquidity/* (12ep)
□ handler: /api/employment/* (5ep)
□ handler: /api/admin/* (8ep)
□ handler: /api/admin/mfa/* (5ep)
□ Dockerfile (multi-stage → scratch)
□ 全エンドポイント動作確認
```

### Phase 3: api-python (計算 API スリム化)

```
□ CRUD ルーター削除
□ Supabase REST → asyncpg 直接接続に変更
□ 内部認証に簡略化
□ Dockerfile 更新
□ 動作確認 (signal, regime, exit, stock)
```

### Phase 4: Frontend + Batch + R2 バックアップ

```
□ Next.js: static export → SSR に変更
□ Next.js: API URL を相対パスに変更
□ Next.js: SEO (metadata, sitemap, robots)
□ Next.js: GA4 統合
□ Frontend Dockerfile (multi-stage)
□ Batch: Supabase REST → psycopg2 直接接続
□ Batch Dockerfile (一時起動用、profiles: [tools])
□ r2-uploader: pg_dump → gzip → R2 バックアップスクリプト
□ r2-uploader Dockerfile (一時起動用、profiles: [tools])
□ ホスト OS cron 設定:
   - batch: 平日 07:00 JST (daily), 日曜 03:00 JST (weekly)
   - r2-uploader: 毎日 04:00 JST
□ cron 動作確認 (docker compose run --rm で手動実行)
```

### Phase 5: Stripe + CI/CD

```
□ api-go: Stripe 連携 (/api/billing/*)
□ api-go: Resend メール送信
□ CI/CD: GitHub Actions → SSH デプロイ
□ Sentry 統合 (api-go + api-python + frontend)
□ Makefile
□ 負荷テスト
□ Supabase DB からのデータ移行
□ DNS 切り替え + 本番稼働
```

### Phase 6: 監視・ログ基盤 (Loki + Grafana)

```
□ Loki コンテナ + loki-config.yaml (ログ保持 30 日)
□ Grafana コンテナ + 初期 datasource 設定 (Loki)
□ Docker logging driver 設定 (json-file → Loki)
□ nginx → /grafana/ リバースプロキシ (Basic Auth 付き)
□ Grafana ダッシュボード作成:
   - コンテナ別ログ検索
   - エラーログアラート (Slack/Discord 通知)
   - API レスポンスタイム
□ Sentry との役割分担確認:
   - Sentry: エラー検知 → 即時アラート (例外、500 系)
   - Loki: ログ検索 → 原因調査 (リクエスト追跡、時系列分析)
□ ログ量・ストレージ確認 (VPS ディスク残量モニタリング)
```

---

## 18. コスト比較

| | 現在 (SaaS) | 移行後 (VPS) |
|---|---|---|
| CF Pages | $0 | $0 (CDN のみ) |
| CF Workers | $0 | $0 (廃止) |
| Cloud Run / Railway | $5+/月 | $0 (廃止) |
| Supabase DB | $0 (無料枠) → $25/月 | $0 (セルフホスト) |
| Supabase Auth | $0 | $0 (廃止、Google OAuth 自前) |
| Upstash Redis | $0 (無料枠) | $0 (セルフホスト) |
| **VPS** | — | **¥3,608/月 (ConoHa 4GB)** |
| R2 | — | $0 (10GB 無料) |
| Stripe | — | 3.6% 手数料のみ |
| Resend | $0 | $0 |
| Sentry | $0 | $0 |
| **合計** | **$5-30/月** | **¥3,608/月 (~$24) 固定** |

スケールしても VPS 代は固定。Supabase が $25/月に上がるリスクがなくなる。

---

## 19. インターンアピールポイント

```
1. インフラ設計力
   - SaaS → セルフホストの移行判断と実行
   - Docker Compose 12 コンテナ (常駐 10 + 一時起動 2) の設計
   - ネットワーク分離、セキュリティ設計

2. 言語選定の判断力
   - Go (CRUD: 高速、省メモリ) vs Python (計算: yfinance 依存)
   - 適材適所の言語分離ができる理由を説明できる

3. CI/CD
   - GitHub Actions → Docker Build → SSH Deploy
   - ダウンタイム最小化デプロイ (health check + 自動再起動)

4. 運用設計
   - 自動バックアップ (PostgreSQL → R2)
   - ログ管理: Loki (収集・検索) + Grafana (可視化・ダッシュボード)
   - エラー監視: Sentry (即時アラート) — Loki と役割分担
   - ヘルスチェック + 自動再起動
   - cron バッチジョブ (ホスト OS cron → 一時起動コンテナ)

5. セキュリティ
   - CF Proxy でオリジン IP 秘匿
   - DB/Redis を外部非公開
   - Google OAuth + JWT 認証を Go で自前実装 (Supabase Auth 不使用)
   - Stripe Webhook 署名検証

6. コスト最適化
   - 月 ¥3,608 で全サービス運用
   - SaaS 無料枠の限界を理解した上での移行判断

7. 拡張性
   - 将来の公開 API コンテナ (/v1/*) を見据えた設計
   - 外部データソースの差し替え可能な interface 設計
```

---

## 20. 将来構想: 公開 API コンテナ

```
nginx ルーティング追加:
  /v1/*  → api-public (Go コンテナ)

api-public コンテナ:
  ├── /v1/signal/:ticker    → 市場シグナル分析
  ├── /v1/regime            → 市場レジーム判定
  ├── /v1/liquidity         → 流動性ストレススコア
  ├── /v1/risk-score        → 雇用リスクスコア
  ├── /v1/docs              → OpenAPI (Swagger) ドキュメント
  │
  ├── 認証: API キー (X-API-Key ヘッダー)
  ├── レート制限: プラン別 (Redis)
  ├── 課金: Stripe usage-based billing
  └── MCP サーバー対応 (AI エージェント向け)
```

内部 API (api-go) と完全分離。公開 API の負荷が内部ユーザーに影響しない。
