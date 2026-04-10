# Open Regime

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![Go](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

株式市場のレジーム（局面）検出とトレードシグナル分析プラットフォーム。テクニカル分析・マクロ経済指標・リスク管理を統合し、エントリー/エグジット判断を支援します。

![Architecture](open_regime_architecture.png)

## Features

- **レジーム検出** — 200 EMA / 21 EMA ベースの 4 状態分類（Bullish / Weakening / Recovery / Bearish）
- **シグナル生成** — EMA 収束・BOS・CHoCH・FVG・OB を組み合わせたエントリー/エグジット判定
- **5 層エグジットシステム** — V13 Hybrid アルゴリズムによる自動ストップロス・段階利確
- **マクロ流動性分析** — FRB データ（RRP・準備預金・TGA）のモニタリング
- **雇用リスクスコアリング** — 雇用統計からリスクレベルを算出
- **バックテスト** — 150 銘柄 × 5 年のウォークフォワード検証
- **マルチアセット対応** — 米国株・日本株・暗号資産

## Tech Stack

### Frontend
| | Technology | Role |
|---|-----------|------|
| Framework | **Next.js 15** (React 18, TypeScript) | SSR / ルーティング |
| UI | **Tailwind CSS v4**, **shadcn/ui** | スタイリング / コンポーネント |
| Charts | **Recharts 2.15** | シグナル・レジーム可視化 |
| Data Fetching | **SWR** | キャッシュ付きデータ取得 |
| Monitoring | **Sentry**, **Google Analytics** | エラー追跡 / アクセス解析 |

### Backend — Go (CRUD / Auth)
| | Technology | Role |
|---|-----------|------|
| Framework | **Echo v4** | HTTP ルーティング |
| DB Driver | **pgx/v5** | PostgreSQL 接続 |
| Auth | **golang-jwt/v5**, **Google OAuth2** | JWT 認証 / SSO |
| MFA | **pquerna/otp** (TOTP) | 管理画面 2FA |
| Payments | **Stripe SDK v82** | サブスクリプション管理 |
| Cache | **go-redis/v9** | Redis クライアント |

### Backend — Python (Compute / Analysis)
| | Technology | Role |
|---|-----------|------|
| Framework | **FastAPI 0.109** | 非同期 API |
| Data | **pandas 2.2**, **numpy 1.26** | データ処理 / 数値計算 |
| Market Data | **yfinance** | 株価・暗号資産データ取得 |
| Macro Data | **FRED API** | FRB 経済指標 (RRP, TGA 等) |
| Rate Limit | **slowapi** | API レートリミット |
| Cache | **cachetools**, **redis-py** | インメモリ / Redis キャッシュ |

### Infrastructure
| | Technology | Role |
|---|-----------|------|
| DB | **PostgreSQL 16** (Alpine) | 主データストア (20+ テーブル) |
| Cache | **Redis 7** (Alpine, LRU) | キャッシュレイヤー |
| Proxy | **Nginx** (Alpine) | リバースプロキシ / TLS 終端 |
| Container | **Docker Compose** | 開発 & 本番オーケストレーション |
| CDN / DNS | **Cloudflare** (Pages, Access) | CDN / DDoS 防御 / ゼロトラスト |
| Backup | **rclone → Cloudflare R2** | DB バックアップ |
| Deploy | **SCP → さくら VPS** (1GB) | 本番デプロイ |
| Logging | **JSON 構造化ログ** | SIEM (Wazuh) 連携 |

## Architecture

```
User → Cloudflare → Nginx (reverse proxy)
                        ├── Frontend (Next.js SSR)
                        ├── API-Go (Auth, CRUD, Stripe)
                        └── API-Python (Signal, Regime, Exit, Liquidity)
                              ├── PostgreSQL 16
                              └── Redis 7 (cache)
```

**キャッシュ戦略:**
- シグナル/クォート: 5 分（市場時間中は適応的 TTL）
- ヒストリカルデータ: 24 時間
- マクロデータ: 24 時間
- バッチウォームアップ: 日次（閉場後にリセット）

## Getting Started

### Prerequisites

- Docker & Docker Compose
- 環境変数ファイル（`.env.docker`）

### Setup

```bash
# 1. リポジトリをクローン
git clone https://github.com/<your-org>/open-regime.git
cd open-regime

# 2. 環境変数を設定
cp .env.docker.example .env.docker
# .env.docker を編集:
#   DB_PASSWORD, JWT_SECRET, FRED_API_KEY, MFA_ENCRYPTION_KEY など

# 3. コンテナを起動
docker compose up -d

# 4. 起動確認（Postgres のヘルスチェックに ~30 秒）
docker compose ps
```

### Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost |
| API (Python) | http://localhost/api |
| API (Go) | http://localhost/api/auth |
| Admin | http://localhost:3002 |

### Batch Jobs

```bash
# 日次バッチ（キャッシュウォームアップ + FRED + バックアップ）
docker compose run --rm --profile tools batch python -m app.batch.run --daily

# データバックフィル
docker compose run --rm --profile tools batch python -m app.batch.run --backfill
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_PASSWORD` | Yes | PostgreSQL パスワード |
| `JWT_SECRET` | Yes | JWT 署名キー（32 文字以上） |
| `PROXY_SECRET` | Yes | サービス間リクエスト検証 |
| `FRED_API_KEY` | - | FRB 経済データ API キー |
| `GOOGLE_CLIENT_ID` | - | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth |
| `STRIPE_SECRET_KEY` | - | Stripe 決済 |
| `MFA_ENCRYPTION_KEY` | - | Admin MFA 暗号化キー |
| `SENTRY_DSN` | - | エラートラッキング |

## Production Deployment

```bash
# 本番用ビルド & 起動（1GB VPS 向けに最適化済み）
docker compose -f docker-compose.prod.yml up -d --build
```

本番構成の特徴:
- メモリリミット設定（1GB VPS 対応）
- 構造化 JSON ログ（SIEM 連携）
- ヘルスチェック & 自動リスタート
- ログローテーション（max 3 files, 10MB each）

## Project Structure

```
open-regime/
├── app/
│   ├── frontend/          # Next.js ユーザー向けフロントエンド
│   ├── admin-frontend/    # Next.js 管理画面
│   ├── backend/           # FastAPI 計算 API
│   │   ├── routers/       #   signal, exit, regime, liquidity, employment
│   │   └── analysis/      #   regime_detector, choch_detector, bos_detector, exit_manager
│   └── batch/             # バッチ処理
├── api-go/                # Go CRUD API (Auth, DB, Stripe)
├── db/init/               # DB スキーマ & マイグレーション
├── nginx/                 # リバースプロキシ設定
├── docker-compose.yml     # 開発環境
├── docker-compose.prod.yml # 本番環境
└── scripts/               # デプロイ & ユーティリティ
```

## License

Private. All rights reserved.
