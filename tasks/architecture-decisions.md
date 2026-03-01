# アーキテクチャ決定事項

> 決定日: 2026-03-01
> 最終更新: 2026-03-01
> ステータス: 確定

---

## 1. 決定事項サマリ

| 項目 | 決定 | 理由 |
|------|------|------|
| Backend 言語 | **Python 維持** (FastAPI + yfinance) | 計算エンドポイントが yfinance に強く依存。Go への書き直しは工数・リスクに見合わない |
| CRUD エンドポイント | **Cloudflare Workers (TypeScript)** | エッジで即応答、コールドスタートなし。Supabase に SELECT するだけなので Python 不要 |
| 計算エンドポイント | **Google Cloud Run (Python)** | スケール to ゼロ、従量課金、自動スケール、東京リージョン。既存コードそのまま移行 |
| バッチ処理 | **Python + yfinance 維持** | yfinance の安定性・拡張性。バッチは日次1回なので起動速度は問題なし |
| キャッシュ (エッジ) | **Cloudflare Workers Cache API** (現状維持) | HTTP レスポンスのエッジキャッシュ。全ユーザー共通データ向け |
| キャッシュ (アプリ) | **Upstash Redis** (新規導入) | per-user レート制限、Cloud Run のインメモリキャッシュ代替、stock_cache 代替 |
| メール | **Resend** (Stripe と同時導入) | Supabase Custom SMTP + トランザクショナルメール |
| 決済 | **Stripe** (Phase 4 で導入) | saas-considerations.md の既存計画通り |
| エラー監視 | **Sentry** (公開と同時に導入) | Python SDK + Frontend JS SDK。公開時に必須 |
| プロダクト分析 | **PostHog** (公開直後に導入) | ファネル分析、Feature Flags。無料 100 万イベント/月 |
| ホスティング (Backend) | **Railway → Google Cloud Run に移行** | Railway は無料トライアル限定。GCR は無料枠大(200万req/月)、自動スケール |

---

## 2. 現在のアーキテクチャ（移行前）

### 2.1 全体構成

```
┌─────────────────────────────────────────────────────────────┐
│                      ユーザー                                │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│        Cloudflare Pages — Frontend (TypeScript)              │
│        open-regime.pages.dev                                 │
│        Next.js 15 SSG 静的配信                               │
│        Supabase Auth (implicit flow)                         │
│        SWR でクライアントキャッシュ                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ Authorization: Bearer <JWT>
                           │
┌──────────────────────────▼──────────────────────────────────┐
│        Cloudflare Worker — APIプロキシ (TypeScript)           │
│        open-regime-api.ryu3ta-ke-mo100307.workers.dev        │
│                                                              │
│        役割: プロキシ + エッジキャッシュ（ロジックなし）      │
│        ├── CORS 検証 (ALLOWED_ORIGIN 環境変数)               │
│        ├── レート制限 (120 req/min per IP)                   │
│        ├── Cache API (GET のみ、エンドポイント別 TTL)        │
│        │   ├── 24時間: liquidity/*, employment/*, stocks     │
│        │   ├── 5分:    regime, market-state, fx, batch-quotes│
│        │   └── 0(なし): me, holdings, trades, watchlist,     │
│        │               signal/*, stock/*, exit/*             │
│        ├── X-Proxy-Secret 付与 (CSRF 対策)                   │
│        ├── Authorization ヘッダー転送                        │
│        ├── セキュリティヘッダー付与                           │
│        │   (X-Content-Type-Options, X-Frame-Options,         │
│        │    HSTS, Referrer-Policy, Permissions-Policy)       │
│        └── ⚠ 全リクエストを Railway に転送（CRUD 含む）     │
│                                                              │
│        環境変数:                                              │
│        ├── ORIGIN = Railway Backend URL                      │
│        ├── ALLOWED_ORIGIN = Frontend URLs (カンマ区切り)     │
│        └── PROXY_SECRET = Backend との共有シークレット       │
└──────────────────────────┬──────────────────────────────────┘
                           │ 全84エンドポイントを転送
                           │
┌──────────────────────────▼──────────────────────────────────┐
│        Railway — Backend (Python / FastAPI)                   │
│        empathetic-hope-production.up.railway.app              │
│        Docker: python:3.11-slim (~200MB)                     │
│        メモリ: 200-400MB 常駐                                │
│                                                              │
│   ┌─ ミドルウェアスタック ────────────────────────────┐      │
│   │  SecurityHeaderMiddleware (セキュリティヘッダー)   │      │
│   │  CSRFOriginMiddleware (X-Proxy-Secret 検証)       │      │
│   │  CORSMiddleware (Origin 制限)                     │      │
│   │  slowapi (60 req/min per IP)                      │      │
│   └──────────────────────────────────────────────────┘      │
│                                                              │
│   ┌─ 認証 (auth.py) ─ デュアルモード ────────────────┐      │
│   │  優先: Authorization: Bearer <JWT>                │      │
│   │    → Supabase JWT 検証 (ES256 JWKS or HS256)     │      │
│   │    → sub + email からユーザー解決                 │      │
│   │  フォールバック: X-User-Email + X-Proxy-Secret    │      │
│   │    → レガシー (CF Access 時代の互換)              │      │
│   │  キャッシュ: email→UUID, auth_id→UUID (TTL 5分)  │      │
│   └──────────────────────────────────────────────────┘      │
│                                                              │
│   ┌─ 全84エンドポイントが1つのアプリに同居 ──────────┐      │
│   │                                                    │      │
│   │  CRUD 49 endpoints (Supabase に SELECT/INSERT)     │      │
│   │  ├── /api/holdings/*   (15) ポートフォリオ管理     │      │
│   │  ├── /api/admin/*      (8)  管理者機能             │      │
│   │  ├── /api/admin/mfa/*  (5)  MFA 管理               │      │
│   │  ├── /api/trades/*     (6)  取引記録               │      │
│   │  ├── /api/watchlist/*  (6)  ウォッチリスト         │      │
│   │  ├── /api/stocks       (3)  銘柄マスター           │      │
│   │  ├── /api/market-state (3)  市場状態履歴           │      │
│   │  ├── /api/me           (2)  ユーザープロフィール   │      │
│   │  └── /api/fx/usdjpy    (1)  為替レート             │      │
│   │                                                    │      │
│   │  計算 35 endpoints (pandas/numpy/yfinance 使用)    │      │
│   │  ├── /api/liquidity/*  (12) 流動性スコア計算       │      │
│   │  ├── /api/stock/*      (8)  株価分析, EMA/RSI/ATR  │      │
│   │  ├── /api/signal/*     (6)  CHoCH/BOS/RS/エントリー│      │
│   │  ├── /api/employment/* (5)  景気リスクスコア       │      │
│   │  ├── /api/regime       (2)  市場レジーム判定       │      │
│   │  └── /api/exit/*       (2)  5層エグジットロジック  │      │
│   └────────────────────────────────────────────────────┘      │
│                                                              │
│   キャッシュ: インメモリ (cachetools)                        │
│   ├── email→UUID (TTL 5分, max 1000)                        │
│   ├── auth_provider_id→UUID (TTL 5分, max 1000)             │
│   └── 各エンドポイント固有キャッシュ (TTL 5-10分)            │
│   ⚠ Railway 再起動で全キャッシュ消失                        │
│                                                              │
│   環境変数:                                                  │
│   ├── SUPABASE_URL, SUPABASE_KEY (service_role)             │
│   ├── SUPABASE_JWT_SECRET (JWT 署名検証)                    │
│   ├── PROXY_SECRET (Worker との共有シークレット)             │
│   └── ENVIRONMENT (production / development)                │
│                                                              │
│   コスト: $5/月〜（トライアル $5 クレジット使い切ったら課金）│
└─────┬───────────────────────────────────────────────────────┘
      │
      ▼
┌───────────┐
│ Supabase  │
│ PostgreSQL│  22+ テーブル
│ + Auth    │  service_role key で接続
│           │  RLS 有効 (service_role でバイパス)
│           │  データ分離はアプリコード側で user_id フィルタ
└───────────┘
      ▲
      │
┌─────┴─────────────────────────────────────────────────────┐
│  GitHub Actions — Batch (Python)                           │
│  .github/workflows/batch-daily.yml                         │
│  cron: 毎日 7:30 JST (22:30 UTC)                          │
│                                                            │
│  コマンド: python app/batch/run.py --daily --verbose       │
│  ├── Yahoo Finance (yfinance) → 14日分 OHLC               │
│  ├── FRED API → 3年分 流動性データ                         │
│  ├── NY Fed → SRF 利用額                                   │
│  ├── 雇用統計データ                                        │
│  ├── Layer1/2 ストレス計算                                 │
│  ├── precomputed_results テーブルに事前計算結果保存         │
│  └── Worker 全エンドポイントをウォームアップ（キャッシュ充填）│
│                                                            │
│  環境変数: SUPABASE_URL, SUPABASE_KEY, FRED_API_KEY        │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  Cloudflare Pages — Admin Frontend (TypeScript)             │
│  open-regime-admin                                          │
│  保護: Cloudflare Access + ADMIN_EMAILS + TOTP MFA (3層)   │
│  機能: ユーザー管理, Feature Flags, 監査ログ, バッチログ   │
└────────────────────────────────────────────────────────────┘
```

### 2.2 デプロイパイプライン（現在）

`.github/workflows/deploy.yml`:

| ステップ | トリガー | コマンド |
|---------|---------|---------|
| Worker デプロイ | `app/worker/` 変更時 | `npx wrangler deploy` |
| Frontend デプロイ | `app/frontend/` 変更時 | `npm run build` → `wrangler pages deploy` |
| Admin デプロイ | `app/admin-frontend/` 変更時 | `npm run build` → `wrangler pages deploy` |
| Backend デプロイ | 手動 | Railway Git 連携 (Docker 自動ビルド) |

### 2.3 環境変数（現在）

| 場所 | 変数 | 用途 |
|------|------|------|
| **Worker** | `ORIGIN` | Railway Backend URL |
| | `ALLOWED_ORIGIN` | 許可 Frontend URL (カンマ区切り) |
| | `PROXY_SECRET` | Backend との共有シークレット |
| **Railway** | `SUPABASE_URL` | Supabase プロジェクト URL |
| | `SUPABASE_KEY` | service_role key |
| | `SUPABASE_JWT_SECRET` | JWT 署名検証 |
| | `PROXY_SECRET` | Worker との共有シークレット |
| | `ENVIRONMENT` | production / development |
| **Frontend** (GitHub Secrets → build env) | `NEXT_PUBLIC_API_URL` | Worker URL |
| | `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL |
| | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 公開キー |
| **Batch** (GitHub Secrets) | `SUPABASE_URL` | Supabase URL |
| | `SUPABASE_KEY` | service_role key |
| | `FRED_API_KEY` | FRED データ API |

### 2.4 セキュリティ機構（現在）

| コード | 対策 | 場所 |
|--------|------|------|
| C1 | CSRF: `X-Proxy-Secret` ヘッダー検証 | Worker → Backend |
| C3 | キャッシュポイズニング: ユーザーデータは TTL=0 | Worker |
| C5 | レガシー認証の非推奨化: X-User-Email 使用時に警告ログ | Backend |
| H2 | JWT アルゴリズム混乱: alg を JWKS で検証 | Backend |
| H7 | レート制限: Worker 120/min + Backend 60/min per IP | 両方 |
| M1 | CORS: 許可外 Origin には 403 (CORS ヘッダーなし) | Worker |
| M2 | 起動時検証: PROXY_SECRET + SUPABASE_JWT_SECRET 必須 | Backend |
| M9 | 未確認メール: JWT の email_confirmed_at チェック | Backend |

### 2.5 現在の問題点

| # | 問題 | 影響 |
|---|------|------|
| 1 | **Railway は無料トライアル限定** ($5 クレジット) | トライアル終了後は課金必須 |
| 2 | **CRUD 49 個が Python で動いている** | Supabase に SELECT するだけなのに 200MB の Python コンテナが常駐 |
| 3 | **全リクエストが Railway 経由** | CRUD は Worker → Supabase で済むのに 3 ホップ |
| 4 | **インメモリキャッシュ** | Railway 再起動で消失。スケール to ゼロ不可 |
| 5 | **Python の依存管理** | pip/venv が不安定。pandas/numpy 更新で壊れるリスク |
| 6 | **レート制限が IP ベース** | per-user 制限不可（Feature Gate に不十分） |
| 7 | **エラー監視なし** | 本番エラーに気づく手段がない |
| 8 | **プロダクト分析なし** | ユーザー行動が不明 |

---

## 3. 新アーキテクチャ（移行後）

### 3.1 全体構成

```
┌─────────────────────────────────────────────────────────────┐
│                      ユーザー                                │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│        Cloudflare Pages — Frontend (TypeScript)              │
│        open-regime.pages.dev                                 │
│        Next.js SSG 静的配信（変更なし）                       │
│        Supabase Auth (implicit flow)（変更なし）              │
│        SWR クライアントキャッシュ（変更なし）                 │
│        + PostHog JS タグ (プロダクト分析)             ← 新規 │
│        + Sentry JS SDK (フロントエンドエラー監視)    ← 新規 │
└──────────────────────────┬──────────────────────────────────┘
                           │ Authorization: Bearer <JWT>
                           │
┌──────────────────────────▼──────────────────────────────────┐
│        Cloudflare Worker (TypeScript)                         │
│                                                              │
│   ┌─ 既存機能（変更なし）──────────────────────────────┐    │
│   │  CORS 検証 (ALLOWED_ORIGIN)                        │    │
│   │  Cache API (エッジキャッシュ、TTL 設定も同じ)      │    │
│   │  セキュリティヘッダー付与                           │    │
│   │  X-Proxy-Secret 付与 (Cloud Run 向けに継続)        │    │
│   └──────────────────────────────────────────────────────┘    │
│                                                              │
│   ┌─ 変更: ルーティング分岐 ─────────────────────────┐     │
│   │                                                    │     │
│   │  なぜ分ける？                                      │     │
│   │  CRUD は Supabase に SELECT するだけ。              │     │
│   │  Cloud Run (Python) を起こす必要がない。            │     │
│   │  Worker のエッジで即応答 → レイテンシ 400ms→100ms  │     │
│   │  Cloud Run の負荷も 84ep→35ep に 58% 削減          │     │
│   │                                                    │     │
│   │  /api/signal/*      ─┐                             │     │
│   │  /api/regime         │                             │     │
│   │  /api/exit/*         ├→ Cloud Run (Python) に転送  │     │
│   │  /api/liquidity/*    │   (現在の Railway 転送と同様)│     │
│   │  /api/employment/*   │                             │     │
│   │  /api/stock/*        ─┘                             │     │
│   │                                                    │     │
│   │  /api/holdings/*    ─┐                             │     │
│   │  /api/trades/*       │                             │     │
│   │  /api/watchlist/*    │                             │     │
│   │  /api/admin/*        ├→ Worker 内で処理    ← 新規  │     │
│   │  /api/me             │   Supabase に直接クエリ     │     │
│   │  /api/stocks         │   Cloud Run 不要            │     │
│   │  /api/market-state   │                             │     │
│   │  /api/fx/usdjpy     ─┘                             │     │
│   │                                                    │     │
│   └────────────────────────────────────────────────────┘     │
│                                                              │
│   ┌─ 新規: Worker 内認証 ───────────────────────────┐      │
│   │  JWT 検証を Worker 内で実行                       │      │
│   │  Supabase JWT secret でエッジ検証                 │      │
│   │  CRUD は Backend に行かず認証完結                  │      │
│   └────────────────────────────────────────────────────┘      │
│                                                              │
│   ┌─ 新規: Upstash Redis 連携 ──────────────────────┐      │
│   │  per-user レート制限 (Free: 30/min, Pro: 120/min)│      │
│   │  signal_usage カウント (Free: 3回/日)             │      │
│   │  @upstash/redis (REST API、Workers 対応)          │      │
│   └────────────────────────────────────────────────────┘      │
│                                                              │
│   環境変数（変更・追加）:                                    │
│   ├── ORIGIN → Cloud Run URL に変更                         │
│   ├── SUPABASE_URL, SUPABASE_KEY ← 新規 (CRUD 用)          │
│   ├── SUPABASE_JWT_SECRET ← 新規 (Worker 内 JWT 検証用)     │
│   ├── UPSTASH_REDIS_REST_URL ← 新規                        │
│   ├── UPSTASH_REDIS_REST_TOKEN ← 新規                      │
│   ├── ALLOWED_ORIGIN (変更なし)                              │
│   └── PROXY_SECRET (変更なし、Cloud Run 向け)               │
└────────────────┬────────────────────────────────────────────┘
                 │ 計算 35 エンドポイントのみ転送
                 │
┌────────────────▼────────────────────────────────────────────┐
│        Google Cloud Run (Python + FastAPI + yfinance)  ← 新規│
│        リージョン: asia-northeast1（東京）                    │
│        Docker: python:3.11-slim (~200MB)                     │
│        メモリ: 200-400MB                                     │
│        スケール: 0〜N インスタンス自動                        │
│                                                              │
│   既存の Python コードをそのまま移行（Railway → Cloud Run）  │
│   計算ロジック・yfinance 呼び出し・キャッシュ等すべて維持    │
│                                                              │
│   ┌─ 計算エンドポイント (35 個) ──────────────────────┐     │
│   │  /api/liquidity/*  (12) 流動性スコア, Z スコア     │     │
│   │  /api/stock/*      (8)  株価分析, EMA/RSI/ATR      │     │
│   │  /api/signal/*     (6)  CHoCH/BOS 検出, RS 分析    │     │
│   │  /api/employment/* (5)  景気リスクスコア            │     │
│   │  /api/regime       (2)  市場レジーム判定            │     │
│   │  /api/exit/*       (2)  5層エグジットロジック       │     │
│   └────────────────────────────────────────────────────┘     │
│                                                              │
│   ┌─ 認証 ───────────────────────────────────────────┐     │
│   │  X-Proxy-Secret 検証 (Worker からの転送を保証)    │     │
│   │  JWT 検証 (既存 auth.py をそのまま使用)           │     │
│   └────────────────────────────────────────────────────┘     │
│                                                              │
│   データ取得: yfinance (.info, .history, .download)          │
│   時系列計算: pandas + numpy（既存コードそのまま）           │
│   キャッシュ: Upstash Redis (インメモリキャッシュの代替)     │
│   + Sentry Python SDK (エラー監視)                    ← 新規 │
│                                                              │
│   環境変数:                                                  │
│   ├── SUPABASE_URL, SUPABASE_KEY (Railway から移行)         │
│   ├── SUPABASE_JWT_SECRET (Railway から移行)                │
│   ├── PROXY_SECRET (Railway から移行)                       │
│   ├── UPSTASH_REDIS_REST_URL ← 新規                        │
│   ├── UPSTASH_REDIS_REST_TOKEN ← 新規                      │
│   ├── SENTRY_DSN ← 新規                                    │
│   └── ENVIRONMENT (Railway から移行)                        │
│                                                              │
│   コスト: 使わない時 $0、200万 req/月まで無料               │
└─────┬──────────────┬────────────────────────────────────────┘
      │              │
      ▼              ▼
┌───────────┐  ┌────────────────────────────────────────────┐
│ Supabase  │  │  Upstash Redis                      ← 新規│
│ PostgreSQL│  │                                            │
│ + Auth    │  │  用途:                                     │
│           │  │  ├── stock_cache (TTL 5分)                 │
│(変更なし) │  │  │   Python インメモリキャッシュの代替     │
│           │  │  │   Cloud Run 停止中もデータ保持          │
│           │  │  ├── per-user レート制限カウンター         │
│           │  │  │   Free: 30 req/min, Pro: 120 req/min   │
│           │  │  ├── signal_usage (Free: 3回/日)           │
│           │  │  └── precomputed_results キャッシュ        │
│           │  │                                            │
│           │  │  Worker + Cloud Run 両方から REST API で   │
│           │  │  アクセス（TCP 接続不要）                  │
│           │  │                                            │
│           │  │  コスト: 1万 cmd/日まで無料               │
└───────────┘  └────────────────────────────────────────────┘
      ▲
      │
┌─────┴─────────────────────────────────────────────────────┐
│  GitHub Actions — Batch (Python + yfinance 維持)           │
│  cron: 毎日 7:30 JST（変更なし）                           │
│                                                            │
│  構成:                                                     │
│  ├── Yahoo Finance: yfinance (.download, .info) ← メイン   │
│  ├── FRED API: requests (現状維持)                         │
│  ├── 計算結果 → Supabase + Upstash Redis に保存            │
│  └── Worker ウォームアップ（変更なし）                     │
│                                                            │
│  環境変数: SUPABASE_URL, SUPABASE_KEY, FRED_API_KEY       │
│           + UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN│
└────────────────────────────────────────────────────────────┘

外部サービス（新規）:
┌────────────────────────────────────────────────────────────┐
│  Stripe  → Cloud Run (Python) の /api/billing/webhook で受信│
│  Resend  → Supabase Custom SMTP + Stripe 決済通知メール    │
│  Sentry  → Frontend (JS SDK) + Cloud Run (Python SDK)      │
│  PostHog → Frontend のみ（JS タグ）                        │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  Cloudflare Pages — Admin Frontend (TypeScript)             │
│  変更なし: Cloudflare Access + ADMIN_EMAILS + TOTP MFA     │
└────────────────────────────────────────────────────────────┘
```

### 3.2 デプロイパイプライン（移行後）

`.github/workflows/deploy.yml` 更新:

| ステップ | トリガー | コマンド | 変更 |
|---------|---------|---------|------|
| Worker デプロイ | `app/worker/` 変更時 | `npx wrangler deploy` | 変更なし |
| Frontend デプロイ | `app/frontend/` 変更時 | `npm run build` → `wrangler pages deploy` | 変更なし |
| Admin デプロイ | `app/admin-frontend/` 変更時 | `npm run build` → `wrangler pages deploy` | 変更なし |
| **Backend デプロイ** | `app/backend/` 変更時 | **`gcloud run deploy`** | **新規（Railway 廃止）** |

### 3.3 環境変数（移行後）

| 場所 | 変数 | 用途 | 変更 |
|------|------|------|------|
| **Worker** | `ORIGIN` | **Cloud Run URL** | 変更（Railway → Cloud Run） |
| | `ALLOWED_ORIGIN` | 許可 Frontend URL | 変更なし |
| | `PROXY_SECRET` | Cloud Run との共有シークレット | 変更なし |
| | `SUPABASE_URL` | Supabase URL | **新規**（CRUD 用） |
| | `SUPABASE_KEY` | service_role key | **新規**（CRUD 用） |
| | `SUPABASE_JWT_SECRET` | JWT 検証 | **新規**（Worker 内認証用） |
| | `UPSTASH_REDIS_REST_URL` | Redis URL | **新規** |
| | `UPSTASH_REDIS_REST_TOKEN` | Redis トークン | **新規** |
| **Cloud Run** | `SUPABASE_URL` | Supabase URL | Railway から移行 |
| | `SUPABASE_KEY` | service_role key | Railway から移行 |
| | `SUPABASE_JWT_SECRET` | JWT 検証 | Railway から移行 |
| | `PROXY_SECRET` | Worker との共有シークレット | Railway から移行 |
| | `UPSTASH_REDIS_REST_URL` | Redis URL | **新規** |
| | `UPSTASH_REDIS_REST_TOKEN` | Redis トークン | **新規** |
| | `SENTRY_DSN` | Sentry エラー送信先 | **新規** |
| | `ENVIRONMENT` | production / development | Railway から移行 |
| **Frontend** (GitHub Secrets) | `NEXT_PUBLIC_API_URL` | Worker URL | 変更なし |
| | `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL | 変更なし |
| | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 公開キー | 変更なし |
| | `NEXT_PUBLIC_POSTHOG_KEY` | PostHog プロジェクトキー | **新規** |
| | `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN | **新規** |
| **Batch** (GitHub Secrets) | `SUPABASE_URL` | Supabase URL | 変更なし |
| | `SUPABASE_KEY` | service_role key | 変更なし |
| | `FRED_API_KEY` | FRED データ API | 変更なし |
| | `UPSTASH_REDIS_REST_URL` | Redis URL | **新規** |
| | `UPSTASH_REDIS_REST_TOKEN` | Redis トークン | **新規** |
| **Railway** | 全部 | — | **廃止** |

---

## 4. リクエストフロー比較

### CRUD リクエスト（例: GET /api/holdings）

```
【現在】3 ホップ、レイテンシ ~400ms
  ブラウザ
    → Worker (キャッシュ: TTL=0、スルー)
    → Railway (Python: JWT 検証 → Supabase SELECT)
    → Worker (レスポンス返却)
    → ブラウザ

【今後】2 ホップ、レイテンシ ~100ms
  ブラウザ
    → Worker (JWT 検証 → Supabase SELECT → レスポンス返却)
    → ブラウザ
  ※ Cloud Run に行かない。エッジで完結。
```

### 計算リクエスト（例: GET /api/signal/NVDA）

```
【現在】3 ホップ、レイテンシ ~1-3 秒
  ブラウザ
    → Worker (キャッシュ: TTL=0、スルー)
    → Railway (Python: JWT 検証 → yfinance → pandas 計算)
    → Worker (レスポンス返却)
    → ブラウザ

【今後】3 ホップ、レイテンシ ~1-2 秒
  ブラウザ
    → Worker (キャッシュチェック)
    → Cloud Run (Python: X-Proxy-Secret 検証 → yfinance → pandas 計算)
    → Worker (レスポンス返却)
    → ブラウザ
  ※ ホップ数は同じ。東京リージョン + CRUD 負荷分離で改善
  ※ 計算ロジック・yfinance は既存コードそのまま
```

### キャッシュ済みリクエスト（例: GET /api/liquidity/overview）

```
【現在も今後も同じ】1 ホップ、レイテンシ ~60ms
  ブラウザ
    → Worker (Cache API: HIT → 即返却)
    → ブラウザ
  ※ Workers Cache API の動作は変更なし
```

---

## 5. キャッシュ戦略の比較

### 現在（2 層）

| 層 | 技術 | 用途 | 問題 |
|---|------|------|------|
| L1: エッジ | Workers Cache API | 全ユーザー共通レスポンスキャッシュ | 問題なし |
| L2: アプリ | Python インメモリ (cachetools) | email→UUID, stock_cache 等 | **再起動で消失** |
| (L3: DB) | Supabase stock_cache テーブル | yfinance 結果 (TTL 5分) | DB に負荷 |

### 今後（3 層）

| 層 | 技術 | 用途 | 改善点 |
|---|------|------|--------|
| L1: エッジ | Workers Cache API（変更なし） | 全ユーザー共通レスポンスキャッシュ | 同じ |
| L2: アプリ | **Upstash Redis** | stock_cache, レート制限, signal_usage | **永続化。再起動で消えない** |
| L3: DB | Supabase precomputed_results | バッチ計算結果 (TTL 24時間) | 同じ |

### Workers Cache API は何が変わる？

**何も変わらない。** エッジキャッシュの動作・TTL 設定はそのまま:

| エンドポイント | TTL | 変更 |
|---------------|-----|------|
| `/api/liquidity/*` | 24 時間 | なし |
| `/api/employment/*` | 24 時間 | なし |
| `/api/stocks` | 24 時間 | なし |
| `/api/regime` | 5 分 | なし |
| `/api/fx/usdjpy` | 5 分 | なし |
| `/api/holdings/*` | 0 (キャッシュなし) | なし |
| `/api/signal/*` | 0 (キャッシュなし) | なし |

---

## 6. セキュリティ機構の比較

| 対策 | 現在 | 今後 | 変更 |
|------|------|------|------|
| CSRF (X-Proxy-Secret) | Worker → Railway | Worker → Cloud Run | 転送先が変わるだけ |
| JWT 検証 | Railway (auth.py) のみ | **Worker (CRUD) + Cloud Run (計算)** | Worker でも検証 |
| CORS | Worker で検証 | 同左 | 変更なし |
| レート制限 | IP ベース (Worker 120 + Backend 60) | **per-user (Upstash Redis)** | Free/Pro プラン別 |
| セキュリティヘッダー | Worker + Backend 両方 | Worker + Cloud Run 両方 | 同じ |
| レガシー認証 (X-User-Email) | Backend でフォールバック | **廃止** | Cloud Run 移行時に削除 |

---

## 7. コスト比較

| サービス | 現在 | 今後 | 差分 |
|---------|------|------|------|
| CF Pages | $0 | $0 | ±$0 |
| CF Workers | $0 | $0 | ±$0 |
| **Railway** | **$5/月〜** | **$0（廃止）** | **-$5** |
| **Cloud Run** | — | **$0** | ±$0 |
| Supabase | $0 | $0 | ±$0 |
| **Upstash Redis** | — | **$0** | ±$0 |
| **Sentry** | — | **$0** | ±$0 |
| **PostHog** | — | **$0** | ±$0 |
| **合計** | **$5/月〜** | **$0** | **-$5** |

サービス数: 5 → 9 に増加。だが全て無料枠内で運用可能。

---

## 8. なぜ Python を維持するか（Go 移行を見送った理由）

### Go 移行を検討した背景

Go の利点（低メモリ 20-50MB、高速起動 <100ms、Go 1 互換性保証 14 年）は魅力的だったが、
実際にコードを調査した結果、**計算エンドポイントの大半がリクエスト時に yfinance を直接呼んでいた。**

### 計算エンドポイントの yfinance 依存度

| エンドポイント | yfinance 呼び出し | 用途 |
|---------------|-------------------|------|
| `stock/{ticker}` | `.info` + `.history(5d)` | 現在価格 + ファンダメンタルズ (20+ フィールド) |
| `stock/{ticker}/history` | `.history(period)` | OHLCV (ユーザー指定期間: 1d〜max) |
| `stock/{ticker}/ema` | `.history(6mo)` | EMA 計算用 Close データ |
| `stock/batch-quotes` | `.info` x 20銘柄 | バッチ現在価格 |
| `signal/{ticker}` | `.history(6mo)` + `.info` | シグナル分析 + 会社名 |
| `signal/batch` | 上記 x 最大50銘柄 | バッチシグナル分析 |
| `signal/{ticker}/bos` | `.history(6mo)` | BOS 分析 |
| `signal/{ticker}/history` | `.history(2y)` x 2 | 主銘柄 + ベンチマーク |
| `exit/{ticker}` | `.history(6mo)` | エグジット分析 |
| `exit/{ticker}/quick` | `.info` | 現在価格 |

**35 個中ほぼ全ての計算エンドポイントがリクエスト時に yfinance を使用。**

### Go に書き直す場合の問題

1. **yfinance の全機能を Go で再実装** — crumb/cookie 認証、.info (20+ フィールド)、レート制限、Yahoo 仕様変更対応
2. **35 エンドポイント + 分析ロジックの全書き直し** — 数週間〜1ヶ月の工数
3. **Yahoo Finance HTTP だけでは .info の代替が困難** — quoteSummary API の認証が複雑
4. **バグリスク** — 新規コード = 新しいバグの温床。既存コードは実績がある
5. **Python yfinance サービスを別途用意する案** — 2サービス管理、ホップ追加、メモリ合計は変わらない

### Python 維持のメリット

| 観点 | Go 書き直し | Python 維持 |
|------|-----------|------------|
| 工数 | 数週間〜1ヶ月 | **数日（Railway→Cloud Run 移行のみ）** |
| リスク | 高（新コード） | **低（既存コード再利用）** |
| yfinance | 再実装が必要 | **そのまま使える** |
| Cloud Run コスト | $0（無料枠内） | $0（無料枠内） |
| メモリ | 20-50MB | 200-400MB（無料枠内なら課金なし） |

### 結論

**Go のメリット（メモリ・起動速度）は無料枠内では課金差を生まない。**
yfinance 依存が深すぎて Go 書き直しの工数・リスクに見合わない。

将来的にユーザーが増えて Python がボトルネックになった場合、
または有料データ API に切り替えて yfinance 依存がなくなった場合に
Go 移行を再検討する。

### yfinance の付加価値（参考）

yfinance は Yahoo Finance の HTTP エンドポイントのラッパーだが、以下の付加価値がある:
- **crumb/cookie 認証**: Yahoo が求める認証トークンの自動取得・更新
- **レート制限対応**: 自動リトライ・バックオフ
- **エンドポイント変更追従**: OSS コミュニティが Yahoo の仕様変更に対応
- **.info**: regularMarketPrice, sector, industry, marketCap, PE 等のファンダメンタルズ
- **.download()**: 複数ティッカー一括ダウンロード（バッチ向き）
- **.history()**: 可変期間 OHLCV (1d〜max、1m〜1mo インターバル)

---

## 9. 導入順序

| 順序 | やること | 理由 |
|------|---------|------|
| **1** | CRUD を Workers (TS) に移行 | 最大の改善効果。Railway 負荷 58% 削減。レイテンシ 400ms→100ms |
| **2** | Cloud Run (Python) に計算エンドポイント移行 | Railway → Cloud Run。既存コードそのまま |
| **3** | Upstash Redis 導入 | インメモリキャッシュの代替。Cloud Run のスケール to ゼロ対応 |
| ~~**4**~~ | ~~Sentry 導入~~ | ~~公開前にエラー監視を入れる~~ ✅ 完了 |
| ~~**4.5**~~ | ~~Resend SMTP 導入~~ | ~~Supabase Auth メール制限解除 (4通/月→3,000通/月)~~ ✅ 完了 |
| ~~**4.6**~~ | ~~カスタムドメイン導入~~ | ~~`open-regime.com` 取得、CF Pages/Worker/メール統一~~ ✅ 完了 |
| **5** | 利用規約 + Feature Gate | 公開に必要 |
| **6** | PostHog 導入 | 公開後のユーザー行動分析 |
| **7** | Stripe 導入 | 収益化 |

---

## 10. 関連ドキュメント

| ファイル | 内容 |
|---------|------|
| `tasks/saas-considerations.md` | SaaS 化の詳細移行ドキュメント (Phase 1-5) |
| `tasks/future-roadmap.md` | 機能拡張ロードマップ |
| `app/docs/システム設計_詳細.md` | 現行システム設計（Python ベース） |
| `app/worker/src/index.ts` | 現在の Worker ソースコード |
| `app/worker/src/cache-config.ts` | 現在のキャッシュ TTL 設定 |
| `app/backend/auth.py` | 現在の認証ロジック |
| `app/backend/main.py` | 現在のミドルウェア構成 |
| `app/backend/routers/stock.py` | yfinance 使用箇所の参照 |
| `app/backend/routers/signal.py` | yfinance 使用箇所の参照 |
| `app/backend/routers/exit.py` | yfinance 使用箇所の参照 |
| `app/backend/cache_utils.py` | DB キャッシュ + yfinance フォールバック |
