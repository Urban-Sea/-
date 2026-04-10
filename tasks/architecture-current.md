# 現行アーキテクチャ図 (2026-04-10 更新)

> **2026-04-05** に VPS 切替完了 / **2026-04-07** に admin サブドメイン分離 / **2026-04-08** にログ JSON 化 + R2 バックアップ + cron 完了 / **2026-04-09** に Redis TTL チューニング + デジタル庁デザイン統一 / **2026-04-10** に signals ページ UX 全面改善
>
> 本番は CF Pages / CF Workers / Cloud Run / Supabase ではなく **Sakura VPS 上の Docker 構成** で稼働中。
> 旧 SaaS (CF Workers, Cloud Run, Supabase, Upstash) は #28 廃止条件達成まで残存中 (動いてはいるが本番トラフィック 0)。
> `.github/workflows/deploy.yml` (legacy SaaS デプロイ) は **2026-04-08 に `workflow_dispatch` のみに変更**、push トリガー廃止。

---

## 1. 本番稼働中 (Sakura VPS / Docker)

```
ブラウザ
  │
  ▼  https://open-regime.com   |   https://admin.open-regime.com
Cloudflare (DNS Proxy ON / WAF / Access[admin] / SSL: Full Strict)
  │  Origin Cert: ワイルドカード *.open-regime.com (15年)
  ▼  443 (TLS)
┌────────────────────────────────────────────────────────────────────┐
│  Sakura VPS 1GB (Ubuntu 24.04, 大阪第3, 49.212.164.21)             │
│  swap 2GB / Docker / ufw                                            │
│                                                                    │
│  ┌──────────┐                                                       │
│  │  nginx    │ :80/:443  リバースプロキシ (server_tokens off)         │
│  │ (alpine)  │  - HSTS (preload), IP直拒否(444), HTTP→HTTPS リダイレクト│
│  │  UID 101  │  - PROXY_SECRET 注入 (api-go の CSRF)                │
│  └────┬─────┘                                                       │
│       │ server: open-regime.com                                     │
│       ├── /api/(signal|regime|exit|stock) ──→ api-python :8081      │
│       │   (Python + FastAPI + asyncpg, UID 1000)                    │
│       │                                                             │
│       ├── /api/* ──→ api-go :8080                                   │
│       │   (Go + Echo v4 + pgx, distroless nonroot UID 65532)        │
│       │   CRUD 75ep + Google OAuth + JWT(HttpOnly) + Stripe + MFA   │
│       │   golang-migrate (起動時自動)                                │
│       │                                                             │
│       ├── / (catch-all) ──→ frontend :3000                          │
│       │   (Next.js 15 SSR / standalone)                             │
│       │   Cookie JWT 認証 (Supabase Auth 完全除去済)                 │
│       │                                                             │
│       └── /admin, /admin/ → 301 https://admin.open-regime.com/       │
│                                                                    │
│       │ server: admin.open-regime.com                               │
│       ├── /api/* ──→ api-go :8080  (admin が相対パスで叩けるよう)     │
│       └── / ──→ admin-frontend :3002                                │
│           (Next.js 15 SSR / standalone, 独自サブドメイン)            │
│           CF Access (Zero Trust) + Cookie JWT + admin MFA トークン   │
│                                                                    │
│  ┌──────────────┐  ┌───────────┐                                    │
│  │ PostgreSQL 16 │  │  Redis 7   │                                  │
│  │  :5432         │  │  :6379     │                                  │
│  │  open_regime   │  │ 100MB LRU  │                                  │
│  │  チューニング 12項│  │            │                                  │
│  └──────────────┘  └───────────┘                                    │
│                                                                    │
│  batch (profiles: [tools], cron 経由のオンデマンド)                   │
│    (Python + psycopg2 + yfinance + rclone, UID 1000)                │
│    cron: 日次 (UTC 22:30) / 週次 (UTC 木 23:00) / R2 backup (UTC 00:00)│
│                                                                    │
│  メモリ合計上限: 896MB / 実測 ~582MB (1GB VPS, swap 2GB)             │
└────────────────────────────────────────────────────────────────────┘
```

### コンテナ UID 一覧 (ホスト ↔ コンテナのバインドマウントで重要)

| サービス | コンテナ内ユーザー | UID | ベースイメージ |
|---|---|---|---|
| nginx | nginx | **101** | nginx:alpine |
| api-go | nonroot | **65532** | gcr.io/distroless/static-debian12:nonroot |
| api-python | appuser | **1000** | python:3.11-slim |
| batch | appuser | **1000** | python:3.11-slim |
| postgres | postgres (内部) | - | postgres:16-alpine |
| redis | redis (内部) | - | redis:7-alpine |
| frontend / admin-frontend | nextjs | - | node:20-alpine |

**ホスト VPS の UID**: ryu=1001 (sudo), deploy=1002 (docker only)
→ Docker volume の chown は **必ず数字 UID** で。`deploy:deploy` 指定だと UID 不一致でコンテナから書き込めない (今回ハマった罠)

### nginx ルーティング詳細

| Server | ルート | 振り先 | 備考 |
|---|---|---|---|
| `open-regime.com` | `/api/(signal\|regime\|exit\|stock)(/\|$)` | api-python:8081 | Python 計算 API |
| `open-regime.com` | `/api/*` | api-go:8080 | Go CRUD API |
| `open-regime.com` | `/admin`, `/admin/` | 301 → admin.open-regime.com | 旧 path のリダイレクト |
| `open-regime.com` | `/` (catch-all) | frontend:3000 | Next.js メイン |
| `admin.open-regime.com` | `/api/*` | api-go:8080 | admin が相対 /api を叩ける |
| `admin.open-regime.com` | `/` | admin-frontend:3002 | Next.js admin |
| `_` (default_server) | 全部 | `return 444` | IP 直アクセス遮断 |

`/api/stock/` は正規表現で Python 側にマッチ。`/api/stocks` (複数形) は Go に正しく流れる。

---

## 2. ログ収集の仕組み (Phase 6 で追加)

### 全体方針
**各コンテナが自分で JSON ファイルに書き込み → ホスト OS にバインドマウント**。Loki/Fluentd 等の集約基盤は今は入れない (1GB VPS 制約)。将来 Wazuh SIEM agent を入れたら同じファイルから読む前提。

### マウント関係

```
ホスト OS                                       コンテナ内
/var/log/open-regime/
├── nginx/        (chown 101:101)         ←→  nginx          /var/log/nginx/
│   ├── access.log (json_combined)              既存形式そのまま
│   └── error.log
│
├── api-go/       (chown 65532:65532)     ←→  api-go         /var/log/open-regime/api-go/
│   └── app.log    (lumberjack 自前ローテ)       50MB × 3 世代 + 7 日 + gzip
│                                                io.MultiWriter で stdout にも併出
│
├── api-python/   (chown 1000:1000)       ←→  api-python     /var/log/open-regime/api-python/
│   ├── app.log    (RotatingFileHandler)         python-json-logger 整形
│   └── uvicorn.log                              uvicorn が log_config.json で書く
│
└── batch/        (chown 1000:1000)       ←→  batch          /var/log/open-regime/batch/
    ├── app.log    (内部 logger, JSON)
    ├── cron.log   (cron リダイレクト, raw text)
    └── backup.log (R2 backup の cron リダイレクト)
```

### ローテーション戦略 (二重ローテ防止)

| ファイル | ローテ方式 | 設定場所 |
|---|---|---|
| api-go/app.log | **lumberjack** (アプリ自前) | `api-go/cmd/server/main.go` |
| api-python/app.log | **RotatingFileHandler** (Python 自前) | `app/backend/main.py setup_logging()` |
| api-python/uvicorn.log | **RotatingFileHandler** (uvicorn) | `app/backend/log_config.json` |
| batch/app.log | **RotatingFileHandler** (Python 自前) | `app/batch/run.py` |
| nginx/access.log, error.log | **logrotate** (ホスト) + nginx USR1 シグナル | `/etc/logrotate.d/open-regime` |
| batch/cron.log, backup.log | **logrotate** (ホスト) + copytruncate | 同上 |

⚠️ **重要**: api-go と api-python/batch のアプリ自前ローテと logrotate を同じファイルに掛けると、アトミック rename と copytruncate が競合してログ欠損する。**logrotate は nginx と batch cron 出力のみ対象**にしている。

logrotate 設定ファイル: `scripts/logrotate-open-regime.conf` (リポ) → `/etc/logrotate.d/open-regime` (VPS)

### Cloud Run 互換 (api-python のみ)

api-python は VPS 用と Cloud Run 用 (旧構成、まだ image は build される) の両方で同じイメージを使う。Cloud Run には書き込み可能なローカルパスがないので、`K_SERVICE` 環境変数 (Cloud Run 自動付与) を検出してファイル出力をスキップ:

- `app/backend/main.py setup_logging()`: K_SERVICE があれば stdout のみ
- `app/backend/Dockerfile` CMD: K_SERVICE 有無で `log_config.json` ↔ `log_config_stdout.json` を切替

---

## 3. R2 バックアップの仕組み (Phase 6 で追加)

### 全体図

```
[VPS] /opt/open-regime/                       [Cloudflare R2]
├── backup/  (chown 1000:1000)                 r2:open-regime-backup/
│   └── 一時置き場                              ├── db/
└── rclone.conf  (chown 1000:1000, 0600)        │   └── open_regime_db_YYYYMMDD_HHMMSS.sql.gz
                                               └── logs/
                                                   └── open_regime_logs_YYYYMMDD_HHMMSS.tar.gz
       ↑↑↑
       batch コンテナ (cron 経由) が UTC 00:00 = JST 09:00 に
       scripts/r2-backup.sh を実行:
       1. pg_dump → gzip → /backup/
       2. /var/log/open-regime/ を tar czf → /backup/
       3. rclone copy で R2 に push (--s3-no-check-bucket)
       4. ローカル + R2 両側で 7 日以上前のファイル削除
```

### r2-backup.sh の動作

ファイル: `scripts/r2-backup.sh` (リポ + VPS の `/opt/open-regime/scripts/r2-backup.sh`)

| ステップ | 内容 |
|---|---|
| 1 | `pg_dump` で `open_regime` DB を gzip 圧縮し `/backup/open_regime_db_TIMESTAMP.sql.gz` に保存 |
| 2 | `/var/log/open-regime/` 配下を `tar czf` で `/backup/open_regime_logs_TIMESTAMP.tar.gz` に保存 |
| 3 | `rclone copy ... --s3-no-check-bucket` で R2 にアップロード |
| 4 | ローカル側 7 日以上のファイルを `find -mtime +7 -delete` で削除 |
| 5 | R2 側も `rclone delete --min-age 7d` で削除 |

**`--s3-no-check-bucket` 必須**: R2 API トークンが Object R/W のみで CreateBucket 権限がないため、rclone のデフォルトバケット存在チェック (HeadBucket → CreateBucket フォールバック) が 403 で失敗する。

### rclone 設定

`/opt/open-regime/rclone.conf` (VPS、chown 1000:1000、chmod 600):
```ini
[r2]
type = s3
provider = Cloudflare
access_key_id = <Object R/W の access key>
secret_access_key = <Object R/W の secret>
endpoint = https://<account_id>.r2.cloudflarestorage.com
acl = private
```

docker-compose で `/opt/open-regime/rclone.conf:/etc/rclone/rclone.conf:ro` として batch にマウント。

---

## 4. cron 設定 (Phase 6 で追加)

deploy ユーザーの crontab (UTC 基準):

| Cron 式 (UTC) | JST | 内容 | ログ出力先 |
|---|---|---|---|
| `30 22 * * *` | 翌 07:30 | 日次 batch (Yahoo + FRED + SRF + 失業保険) | `/var/log/open-regime/batch/cron.log` |
| `0 23 * * 4` | 翌金 08:00 | 週次 batch (FRB BS + MMF + 雇用統計 + Layer 再計算) | 同上 |
| `0 0 * * *` | 09:00 | R2 backup (DB + ログ tar.gz) | `/var/log/open-regime/batch/backup.log` |

実行コマンド形式:
```bash
cd /opt/open-regime && docker compose -f docker-compose.prod.yml run --rm batch <cmd> >> <log> 2>&1
```

タイムライン: daily batch (~10-30分) → weekly batch (木曜のみ) → 30 分後に R2 backup。**R2 backup は必ず batch 完了後**に走らせる (バッチが更新したデータを含めるため)。

---

## 5. Redis キャッシュ戦略 (2026-04-09 更新)

> ⚠️ **【重要】2026-04-09 doc 訂正**:
> このセクションは元々 Python ルーター実装を前提に書かれていたが、本番 VPS の nginx 振り分けは `/api/(signal|regime|exit|stock)` のみ api-python に投げ、それ以外 (employment, liquidity, market-state, stocks) は **api-go** に投げている (§1 参照)。api-go 側で実際にキャッシュ実装があるのは:
>
> - `fx.go` ([fx.go:96-116](../api-go/internal/handler/fx.go#L96-L116)) — 5min cache
> - `auth.go` (oauth_state) / `auth_service.go` (user cache) — 認証関連
> - **`employment.go` ([employment.go](../api-go/internal/handler/employment.go)) — 24h cache (2026-04-09 追加)**
>
> したがって、以下に列挙された 24h cache のうち **api-python 側 (signal/regime/exit/stock + employment 系の Python ルーター)** は本番では Cloud Run 残骸でしか動いておらず、本番トラフィックには影響しない。**api-go 側で同等の cache 実装が必要なエンドポイント** (liquidity / market-state / stocks) は **未実装、別 PR で対応予定**。「実装場所」列を参照。

### 全体方針

**signal / stock quote / fx 以外は 24h 固定キャッシュ**。日足ベースの計算 (regime, exit, stock history/ema) と週次/月次 FRED 系 (liquidity, employment, market_state, stocks 一覧) は同一営業日中に再計算する意味がない。

**設計思想**: 重い計算 (Layer Stress 等) は batch cron が日次/週次で precompute → DB 永続化 → Redis warmup → API はキャッシュから読むだけ。これにより VPS 1GB の制約で API リクエスト毎の重計算を回避し、メモリ実測 ~582/961MB に収める。

**api-go 側の方針**: 同ホスト Docker Redis のラウンドトリップは <1ms なので **L1 in-memory cache は持たず L2 Redis のみ**。各 cache 操作には `context.WithTimeout` で per-operation timeout (GET 200ms / SET 500ms など) を必ず付ける (Redis skill ルール `conn-timeouts`)。Redis 遅延時に API リクエストを巻き込まないためのフォールバック装置。

### 二段キャッシュ (L1 + L2)

実装ファイル: `app/backend/redis_cache.py`

```
リクエスト
   ↓
[L1] プロセスローカル dict (0ms, 最大 500 entries)
   ↓ ミス
[L2] Redis 7 (~10ms)
   ↓ ミス
計算実行 → L1 + L2 両方に SET (新 TTL)
```

| 項目 | 値 / 仕様 |
|---|---|
| L1 (in-memory) | dict, 上限 500 entries, 期限切れは lazy eviction |
| L2 (Redis) | redis:7-alpine, `:6379`, `appendonly yes` 永続化 |
| L2 メモリ上限 | **48mb** (prod), `maxmemory-policy allkeys-lru` |
| L2 ヒット時の L1 バックフィル | 60 秒 |
| Graceful degradation | Redis 障害時は L1 のみで動作 (None フォールバック、API は落ちない) |
| 永続性 | コンテナ / VPS 再起動でも L2 のデータは生き残る |

**重要**: 各ルーターは必ず `cache_get(key)` で L1→L2 を先に確認し、ヒットすれば計算スキップして即 return。**情報があれば計算しない**。

### TTL マトリクス (確定版、2026-04-09 訂正)

「実装場所」列が **本番でどこが実際に cache 効いているか** を示す。✅ = 実装済 / ❌ = 未実装 (doc 上の TTL は希望値)。

| カテゴリ | エンドポイント | TTL | 実装場所 / 状態 |
|---|---|---|---|
| **リアルタイム (5min)** | `/api/fx/usdjpy` | 5min | ✅ api-go [fx.go](../api-go/internal/handler/fx.go) |
|  | `/api/signal/*` (4 endpoints) | 5min + adaptive | ✅ api-python `signal.py` |
|  | `/api/stock/{ticker}` (info) | 5min + adaptive | ✅ api-python `stock.py` |
|  | `/api/stock/{ticker}/quote` | 5min + adaptive | ✅ api-python `stock.py` |
|  | `/api/stock/batch-quotes` | 5min + adaptive | ✅ api-python `stock.py` |
| **日足ベース (24h 固定)** | `/api/regime` | 24h | ✅ api-python `regime.py` |
|  | `/api/stock/{ticker}/history` | 24h | ✅ api-python `stock.py` |
|  | `/api/stock/{ticker}/ema` | 24h | ✅ api-python `stock.py` |
|  | `/api/exit/{ticker}` | 24h | ✅ api-python `exit.py` |
|  | `/api/exit/{ticker}/quick` | 24h | ✅ api-python `exit.py` |
| **雇用 (24h)** | `/api/employment/risk-score` | 24h | ✅ **api-go [employment.go](../api-go/internal/handler/employment.go)** key: `employment:risk_score:v1` (2026-04-09 追加) |
|  | `/api/employment/risk-history` | 24h | ✅ **api-go** key: `employment:risk_history:v1:{months}` (2026-04-09 追加) |
| **流動性 (24h)** | `/api/liquidity/plumbing-summary` | 24h | ❌ **未実装 (api-go)** ⚠️ doc は希望値、実装は別 PR |
|  | `/api/liquidity/events` | 24h | ❌ **未実装 (api-go)** ⚠️ |
|  | `/api/liquidity/policy-regime` | 24h | ❌ **未実装 (api-go)** ⚠️ |
|  | `/api/liquidity/backtest-states` | 24h | ❌ **未実装 (api-go)** ⚠️ |
| **月次集計 (24h)** | `/api/market-state` (履歴) | 24h | ❌ **未実装 (api-go)** ⚠️ |
|  | `/api/market-state/latest` | 24h | ❌ **未実装 (api-go)** ⚠️ |
| **静的マスタ (24h)** | `/api/stocks` (一覧) | 24h | ❌ **未実装 (api-go)** ⚠️ |
|  | `/api/stocks/{ticker}` | 24h | ❌ **未実装 (api-go)** ⚠️ |
|  | `/api/stocks/categories/list` | 24h | ❌ **未実装 (api-go)** ⚠️ |

### `adaptive_ttl` ヘルパー

`app/backend/market_hours.py:233-247` の既存ヘルパー。「市場開場中は base_ttl、閉場中は次の開場までの秒数を返す」動作で、リアルタイム系 (signal / stock quote / fx) のみで使用。24h 固定系では `adaptive_ttl(_REGIME_TTL)` の wrap を削除して定数を直接渡す形に統一 (24h は十分長いので動的計算不要 + コードの意図を明示)。

### batch warmup との連携 (2026-04-09 訂正)

> ⚠️ **訂正**: 旧 `WORKER_URL = "https://open-regime-api.ryu3ta-ke-mo100307.workers.dev"` は 2026-04-05 の DNS 切替で削除済の旧 CF Worker を指していて、2026-04-05〜2026-04-09 の 4 日間ずっと dead 機能化していた。本日修正済 (`BACKEND_URL = "https://open-regime.com"`)。
>
> また、warmup 対象を **実際にキャッシュ実装済みエンドポイント** だけに絞った。キャッシュ無いエンドポイントを叩くと「重い計算が走って結果は捨てられる」という純粋な無駄 DB 負荷になるため。

[`app/batch/run.py`](../app/batch/run.py) の `WARMUP_ENDPOINTS` が日次/週次 cron 後に叩くのは:

- `/api/regime` (api-python の cache が効く)
- `/api/employment/risk-score?purge=1` (api-go の 24h cache を強制リフレッシュ)
- `/api/employment/risk-history?months=350&purge=1` (同上)

`?purge=1` には **`X-Warmup-Token` ヘッダ必須** (api-go config の `WARMUP_TOKEN` env var と一致しないと 403)。これにより外部からの DoS 悪用 (毎リクエスト ~100ms の DB 計算を強制誘発) を防ぐ。

将来 liquidity / market-state / stocks に api-go 側 cache を追加した時は、同じ pattern で warmup リストに追加する。

加えて `app/batch/calculators/precompute.py` が `risk_score`, `plumbing_summary`, `market_events`, `policy_regime` を直接 `precomputed:{key}` キーで Redis + DB に 24h TTL 保存。`app/backend/precomputed.py` 経由で **api-python のみ** が読む高速パス。**api-go は precomputed:* キーを読まない** (Cloud Run 残骸経由で書かれた Python 形式の JSON との互換性問題を避けるため、Go は専用キー `employment:risk_score:v1` を持つ)。

### キャッシュキー命名規約

| キーパターン | 用途 | 場所 |
|---|---|---|
| `regime:v2:us` | レジーム判定 (v2 = NaN バー除去対応) | regime.py |
| `signal:{ticker}:{mode}`, `signal_hist:...`, `markers:...` | シグナル系 | signal.py |
| `stock:quote:{ticker}` | 株価クオート | stock.py |
| `stock:info:{ticker}` | 株価詳細 | stock.py |
| `stock:history:v2:{ticker}:{period}:{interval}` | OHLCV 履歴 | stock.py |
| `stock:ema:{ticker}:{periods}` | EMA (新規) | stock.py |
| `ohlcv:{ticker}:{period}` | OHLCV データ (内部 helper) | cache_utils.py |
| `fx:usdjpy` | USD/JPY | fx.py |
| `plumbing:summary` | 流動性サマリー | liquidity.py |
| `liquidity:events` | 流動性イベント | liquidity.py |
| `liquidity:policy` | 政策 | liquidity.py |
| `liquidity:backtest:{limit}` | バックテスト | liquidity.py |
| `employment:risk_score` | 雇用リスクスコア (api-python, Cloud Run 残骸) | employment.py |
| `employment:risk_history:{months}` | 雇用リスク履歴 (api-python, Cloud Run 残骸) | employment.py |
| **`employment:risk_score:v1`** | **雇用リスクスコア (api-go, 本番、24h)** | **api-go/internal/handler/employment.go** |
| **`employment:risk_history:v1:{months}`** | **雇用リスク履歴 (api-go, 本番、24h)** | **同上** |
| `stocks:master:{cat}:{wl}:{active}` | stocks 一覧 (新規) | stocks.py |
| `stocks:master:single:{ticker}` | 個別マスタ (新規) | stocks.py |
| `stocks:master:categories` | カテゴリ列挙 (新規) | stocks.py |
| `market_state:latest` | 最新市場状態 (新規) | market_state.py |
| `market_state:history:{limit}:{offset}` | 市場状態履歴 (新規) | market_state.py |
| `exit:{ticker}:{entry}:{date}:{grade}:{stop}` | Exit 判定 (新規) | exit.py |
| `exit:quick:{ticker}:{entry}` | Quick Exit (新規) | exit.py |
| `precomputed:{key}` | batch 事前計算結果 | batch/calculators/precompute.py |
| `rl:ip:{ip}` | レートリミット | api-go middleware/ratelimit.go |

### 効果

| 観点 | Before (2026-04-09 以前) | After |
|---|---|---|
| regime / stock history | 5min TTL → 最悪 288 回/日 再計算 | 24h、batch warmup で実質 0 回 |
| exit / market_state / stocks 一覧 | キャッシュなし → リクエスト数 = 計算回数 | 24h、ユーザー初回のみ計算 |
| liquidity / employment | 6h TTL → 4 回/日 | 24h、batch warmup で実質 0 回 |
| signal / stock quote / fx | 5min + adaptive | 変更なし (リアルタイム性維持) |

---

## 6. デプロイフロー

```
git push (main)
  ├─ paths-filter で変更検知
  │   - app/frontend/**       → frontend image build
  │   - app/admin-frontend/** → admin image build
  │   - app/backend/**        → api-python image build
  │   - api-go/**             → api-go image build
  │   - app/batch/**          → batch image build
  │
  ├─ 該当サービスのみ docker build → docker save | gzip → SCP → VPS
  ├─ 並行: docker-compose.prod.yml, nginx/, db/init/, scripts/ も SCP
  │       (2026-04-08 から scripts/ ディレクトリ全体)
  │
  └─ VPS 上で
      ├─ docker load
      ├─ docker compose up -d (該当サービスのみ)
      ├─ ヘルスチェック (30回×2秒, Host ヘッダー付き)
      └─ 失敗時ロールバック
```

ワークフロー: `.github/workflows/deploy-vps.yml`

**legacy `deploy.yml`** (Cloud Run / CF Workers / CF Pages へのデプロイ): 2026-04-08 から `workflow_dispatch` のみ。push トリガー廃止。サービス本体削除は #28。

---

## 7. 本番依存サービス

### アクティブ (現在使用中)
| サービス | 用途 | 状態 |
|---|---|---|
| **Cloudflare** | DNS, WAF, SSL (Full Strict + Origin Cert), Access (admin) | ✅ |
| **Cloudflare R2** | DB + ログのバックアップ (`open-regime-backup`) | ✅ Phase 6 で導入 |
| **Google OAuth** | 認証 (redirect: `https://open-regime.com/api/auth/google/callback`) | ✅ |
| **Stripe** | 決済 (webhook: `https://open-regime.com/api/billing/webhook`) | scaffold 済、本格運用は未 |
| **GitHub Actions** | デプロイ (`deploy-vps.yml`) | ✅ |

### 設定済みだが未使用 / 未注入
| サービス | 状態 |
|---|---|
| **Sentry** | DSN 未注入 (#35 未着手)。コードは ready |
| **Resend** | 未使用 (パスワード認証 #39 で有効化予定) |
| **PostHog** | 未導入 (`今後やること.md` で検討中) |

### 廃止予定 (#28 廃止条件達成後に削除)
| サービス | 状態 |
|---|---|
| Cloud Run (`open-regime-backend`) | 動作中だがトラフィック 0 |
| CF Workers (`open-regime-api`) | カスタムドメイン削除済、Worker 本体は残存 |
| CF Pages (`open-regime`, `open-regime-admin.pages.dev`) | DNS は VPS 向き |
| Supabase | データは VPS に移行済、SaaS 側はそのまま (※ コードに dual-path フォールバックがまだ残る) |
| Upstash Redis | 未使用 |
| GH Secrets 12 個 (CF/GCP/Supabase/Upstash 系) | #28 で一括削除予定 |

**廃止条件**:
1. R2 バックアップが **3 回以上** 成功 (現在 1/3 = 手動)
2. cron batch が **5 回以上** 正常完了 (現在 0/5 = cron 登録直後)
3. Google OAuth ログインが安定動作 (達成済)

→ **2026-04-13 (月曜) 頃に達成見込み** → #28 着手可能

---

## 8. セキュリティ対応状況

### Phase 5 (2026-04-05) で対応済
| # | 内容 |
|---|---|
| 29 | nginx default_server で IP 直アクセス拒否 (`return 444`) |
| 30 | nginx `server_tokens off` |
| 31 | nginx HSTS (`max-age=31536000; includeSubDomains; preload`) |
| 32 | deploy-vps.yml ヘルスチェックをリトライループ化 |

### Phase 6 (2026-04-08) で対応済
| # | 内容 |
|---|---|
| 34 | **R2 バックアップ実装** (DB + ログ) |
| 27 | **batch cron 設定** (日次 / 週次 / R2 backup) |
| - | **api-go distroless nonroot 化** (UID 65532) |
| - | **JSON ログ + ホストバインドマウント** (4 サービス) |
| - | **legacy deploy.yml を `workflow_dispatch` のみに変更** |

### 公開前に未対応 (推奨実施順)
| 順 | # | 内容 | 優先度 |
|---|---|---|---|
| 1 | **33** | **ufw を Cloudflare IP レンジのみ許可** | 🔴 必須 |
| 2 | 35 | Sentry DSN を VPS に注入 | 🟡 必須 |
| 3 | 36 | Python API CORS origins 掃除 | 🟢 後回し可 |
| 4 | - | gitleaks/trufflehog でシークレットスキャン (リポ public 化前) | 🔴 必須 |
| 5 | - | 利用規約 / プライバシーポリシー / Cookie 同意 | 🔴 必須 |
| 6 | - | Google OAuth 同意画面 Production 昇格 | 🔴 必須 |

### 将来対応 (パスワード認証導入時 = Phase 7)
- #37 `users.password_hash` カラム追加
- #38 `POST /api/auth/login` `/register` (bcrypt)
- #39 Resend でメール認証 + パスワードリセット
- **#40 jti ブラックリスト (Redis)** ← パスワード変更時の即時失効
- #41 Go API に CSRF (PROXY_SECRET) 保護

### 将来対応 (優先度低)
- #42 CSP ヘッダー / #43 fail2ban / #44 trivy / #45 Rate Limiting 統一

---

## 9. 観測されたリスク / 残課題

### 現状リスク
- **VPS が単一**。冗長化なし。Sakura 大阪第 3 リージョン障害で全停止
- **ufw が CF IP 限定でない** → IP 直叩きで CF Access バイパス可 (#33 未着手)
- **メモリ余裕が小さい** (~582/961MB)。サービス追加時は OOM 注意
- **外形監視なし** (UptimeRobot 等未導入)。VPS 死亡時の通知手段なし
- **DB seed は 2026-03-26 時点**。本番運用後の差分は cron 稼働まで埋まらない

### コードの dual-path 残債
- `app/backend/main.py` に Supabase クライアント初期化が残っている (Cloud Run フォールバック用)。VPS では未使用だが、ENV 未設定だと警告ログが出る
- 完全削除は #28 のタイミングで実施

---

## 10. 主要ファイル / パス

### リポジトリ側
| ファイル | 役割 |
|---|---|
| `docker-compose.prod.yml` | 本番 compose (image: タグ、メモリ制限、PG チューニング、ログ/backup マウント) |
| `nginx/conf.d/default.prod.conf.template` | 本番 nginx (server_name, SSL, PROXY_SECRET, HSTS, IP直拒否) |
| `nginx/nginx.conf` | nginx 全体 (json_combined フォーマット定義) |
| `.github/workflows/deploy-vps.yml` | SCP デプロイ (paths-filter + ロールバック) |
| `.github/workflows/deploy.yml` | legacy SaaS デプロイ (workflow_dispatch のみ) |
| `scripts/r2-backup.sh` | R2 バックアップスクリプト (rclone) |
| `scripts/logrotate-open-regime.conf` | logrotate 設定 (nginx + batch cron 出力のみ) |
| `api-go/cmd/server/main.go` | api-go エントリポイント (lumberjack ファイル出力) |
| `api-go/Dockerfile` | distroless static-debian12:nonroot |
| `app/backend/main.py` | FastAPI エントリ (`setup_logging()` で K_SERVICE 検出) |
| `app/backend/log_config.json` | uvicorn JSON ログ設定 (VPS 用) |
| `app/backend/log_config_stdout.json` | uvicorn JSON ログ設定 (Cloud Run 用) |
| `app/backend/Dockerfile` | K_SERVICE 有無で log_config 切替 |
| `app/batch/Dockerfile` | rclone + postgresql-client 込み |
| `app/batch/run.py` | batch エントリ (production で JSON ログ) |

### VPS 側
| パス | 用途 |
|---|---|
| `/opt/open-regime/` | デプロイ先 (`docker-compose.prod.yml`, `nginx/`, `db/init/`, `scripts/`) |
| `/opt/open-regime/.env` | 本番環境変数 (chmod 600, owner deploy) |
| `/opt/open-regime/ssl/origin.pem` | CF Origin Certificate (15 年) |
| `/opt/open-regime/backup/` | R2 アップロード前の一時置き場 (chown 1000:1000) |
| `/opt/open-regime/rclone.conf` | rclone 設定 (chown 1000:1000, chmod 600) |
| `/opt/open-regime/images/` | docker save の tar.gz 一時置き場 |
| `/var/log/open-regime/` | コンテナログのバインドマウント先 |
| `/var/log/open-regime/{nginx,api-go,api-python,batch}/` | サービス別ログ |
| `/etc/logrotate.d/open-regime` | logrotate 設定 (手動配置) |

---

## 11. フロントエンド ページ構成 (2026-04-10 時点)

| ページ | タブ構成 | 備考 |
|---|---|---|
| `/` | — | ランディングページ |
| `/signals` | エントリー判定 / 決済分析 / 過去のポジション / システム解説 | **保有分析タブは 2026-04-10 に廃止** (決済分析に統合) |
| `/liquidity` | ダッシュボード / 履歴グラフ / バックテスト | 履歴は Power BI 風グリッド (一覧/詳細 2 view) |
| `/employment` | ダッシュボード / リスク履歴 / 指標グラフ | 指標は Power BI 風グリッド |
| `/holdings` | — | ポートフォリオ管理 |
| `/dashboard` | — | 統合ダッシュボード |
| `/discovery` | — | finviz スキャン結果 |
| `/settings` | — | 設定 |
| `/login` | — | Google OAuth ログイン |

### signals ページの主要変更 (2026-04-10)

- **運用モード** (balanced/aggressive/conservative): UI 非表示、balanced 固定。API パラメータは残存
- **Exit モード** (standard/stable): UI 非表示、standard 固定。API パラメータは残存
- **決済分析**: 1 件 → Hero + 3 chip (損切/反転/利確)、2+ → Power BI 風グリッド (緊急度ソート)
- **過去のポジション**: trade_results + active positions を 1 行 1 ポジション表示。partial + full を entry_date でグルーピング
- **システム解説**: 実物 chip + アクション表示で色の意味を図解。バックテスト結果は S&P500 / NASDAQ100 / Nikkei225 の 10 年データ
- **デザイン**: DA token 全面適用。Tailwind 素色禁止。`--brand-*` / `--signal-*` / `--neutral-*`
- **localhost auth バイパス**: UserProvider / swr.tsx / api.ts に `hostname === 'localhost'` チェック追加 (dev 専用)

---

## 12. 関連ドキュメント

- [`tasks/順番.md`](順番.md) — 全 Phase の作業順序
- [`tasks/今後やること.md`](今後やること.md) — 公開前スプリント + Phase 7 構想
- [`tasks/architecture-decisions.md`](architecture-decisions.md) — 2026-03-01 アーキテクチャ決定の背景
- [`tasks/future-environments.md`](future-environments.md) — 将来の本番/STG/Dev分離 + Wazuh SIEM 構想
- [`tasks/future-roadmap.md`](future-roadmap.md) — 機能ロードマップ
- [`tasks/done/log7.md`](done/log7.md) — Phase 6 詳細作業ログ (ログ JSON 化 + R2 + cron)
- [`tasks/done/phase6-logs-r2-cron-setup.md`](done/phase6-logs-r2-cron-setup.md) — VPS 側手順書
- [`tasks/done/vps-initial-setup.md`](done/vps-initial-setup.md) — VPS 初期構築ログ
- [`tasks/done/e2e-test-results.md`](done/e2e-test-results.md) — E2E テスト結果
- [`tasks/done/go-python-precision-results.md`](done/go-python-precision-results.md) — Go vs Python 精度検証
- [`tasks/prompt-landing-redesign.md`](prompt-landing-redesign.md) — Landing 改修の次セッション用指示書
