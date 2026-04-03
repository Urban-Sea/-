# レーンA 完了報告: api-python Docker化 + Batch Docker化

**実施日**: 2026-03-28
**設計書**: `tasks/handoff-lane-a.md`

---

## 一言でいうと

Supabase REST API / Upstash Redis REST という **SaaS 経由の間接接続** を、Docker 内の **PostgreSQL / Redis への直接TCP接続** に書き換えた。VPS セルフホストの土台。

```
Before:  Python → HTTPS → Supabase REST → PostgreSQL (SaaS)
         Python → HTTPS → Upstash REST  → Redis (SaaS)

After:   Python → TCP → PostgreSQL コンテナ (asyncpg/psycopg2)
         Python → TCP → Redis コンテナ (redis パッケージ)
```

---

## Step 2: api-python Docker化

### 変更ファイル

| ファイル | 操作 | 内容 |
|---|---|---|
| `app/backend/db.py` | 新規 | asyncpg コネクションプール管理 (`init_pool` / `close_pool` / `get_pool`) |
| `app/backend/redis_cache.py` | 修正 | Upstash REST → `redis` パッケージ直接接続。Upstash フォールバック付き |
| `app/backend/main.py` | 修正 | lifespan に asyncpg pool init/close 追加。`get_supabase()` は None スタブとして残存 |
| `app/backend/auth.py` | 修正 | `_resolve_user_by_jwt()` を async 化。asyncpg / Supabase SDK のデュアルパス |
| `app/backend/requirements.txt` | 修正 | `upstash-redis` → `redis>=5.0.0` |
| `app/backend/Dockerfile` | 修正 | ポート 8080 → 8081 |
| `docker-compose.yml` | 追記 | `api-python` サービス |
| `nginx/conf.d/default.conf` | 修正 | `upstream api_python` + location ブロック有効化 |

### 設計判断: デュアルパス

api-python は **同じコードが Docker と Cloud Run の両方で動く** ように設計した。

```python
# auth.py
_USE_ASYNCPG = bool(os.getenv("DB_HOST"))  # Docker なら True

async def _resolve_user_by_jwt(sub, email):
    if _USE_ASYNCPG:
        return await _resolve_user_asyncpg(sub, email)  # asyncpg SQL
    else:
        return _resolve_user_supabase(sub, email)  # Supabase SDK
```

```python
# redis_cache.py の get_redis()
if os.getenv("REDIS_URL"):     → redis.from_url() 直接接続
elif os.getenv("UPSTASH_*"):   → upstash_redis.Redis() REST接続
```

```python
# main.py lifespan
if os.getenv("DB_HOST"):
    await init_pool()          # Docker: asyncpg pool 起動
else:
    pass                       # Cloud Run: asyncpg スキップ

# Supabase init は常に試みる（SUPABASE_URL があれば）
# get_supabase() は CRUD ルーターが使うため削除できない
```

### CRUDルーターは一切触っていない

`holdings.py`, `trades.py`, `watchlist.py` 等 10 個の CRUD ルーターは **Supabase SDK のまま**。
Docker 内では nginx が `/api/(signal|regime|exit|stock)` のみ api-python にルーティングするため、CRUD エンドポイントは呼ばれない。
`get_supabase()` が None を返すので、CRUD エンドポイントを直接叩くと NoneType エラーになるが、これは意図的。

---

## Step 6: Batch Docker化

### 変更ファイル

| ファイル | 操作 | 内容 |
|---|---|---|
| `app/batch/config.py` | 修正 | Supabase SDK 完全削除 → psycopg2 (`get_supabase()` → `get_conn()`) |
| `app/batch/db.py` | 全書き換え | 全 upsert を `execute_values` + `ON CONFLICT DO UPDATE` SQL に変換 |
| `app/batch/run.py` | 修正 | `_log_start` / `_log_finish` / stock_cache 掃除 → psycopg2 |
| `app/batch/manual_input.py` | 全書き換え | 全 Supabase → psycopg2 SQL |
| `app/batch/snapshot.py` | 全書き換え | 全 Supabase → psycopg2 SQL |
| `app/batch/backfill_snapshots.py` | 修正 | 全 Supabase → psycopg2 SQL |
| `app/batch/calculators/layer_stress.py` | 修正 | `_fetch_all()` → psycopg2 SQL + date/Decimal 型変換 |
| `app/batch/calculators/precompute.py` | 修正 | Upstash → redis 直接接続 + Supabase → psycopg2 |
| `app/batch/requirements.txt` | 新規 | psycopg2-binary, pandas, yfinance, fredapi, requests, python-dotenv, redis |
| `app/batch/Dockerfile` | 新規 | Python 3.11-slim、build context = リポジトリルート |
| `docker-compose.yml` | 追記 | `batch` サービス (`profiles: [tools]`) |
| `scripts/r2-backup.sh` | 新規 | pg_dump + gzip (R2 アップロードは VPS 契約後) |

### Batch は Cloud Run 非対応になった

api-python とは異なり、batch は **デュアルパス設計にしていない**。
`config.py` から `SUPABASE_URL` / `SUPABASE_KEY` の読み込みを完全削除した。
batch を動かすには `DB_HOST` 等の PostgreSQL 接続情報が**必須**。

理由: batch はレーンB (Go) に移植しないので、Docker 専用で問題ない。

### psycopg2 の型変換に注意

Supabase SDK は全値を文字列/数値で返していたが、psycopg2 は Python ネイティブ型を返す:
- `DATE` カラム → `datetime.date` オブジェクト（文字列ではない）
- `NUMERIC` カラム → `Decimal` オブジェクト（float ではない）

`layer_stress.py` の `_fetch_all()` で `str()` / `float()` への変換を追加済み。
新しいバッチコードを書く際は同様の変換が必要になる可能性がある。

---

## 現行環境への影響

### push しても壊れないもの

| コンポーネント | 理由 |
|---|---|
| Cloud Run api-python | デュアルパス設計。`DB_HOST` 未設定 → Supabase SDK パスにフォールバック |
| CF Workers (CRUD) | api-python と独立。影響なし |
| フロントエンド | API インターフェース変更なし |
| 計算ルーター4つ | DB アクセスゼロ。Redis 変更のみ、フォールバックあり |

### push すると壊れるもの

| コンポーネント | 理由 | 対策 |
|---|---|---|
| **batch (ローカル実行)** | `config.py` から `SUPABASE_URL`/`SUPABASE_KEY` 削除済み。`DB_HOST` 必須に変更 | Docker 内で実行するか、ローカル PG に接続する |
| **Cloud Run 再デプロイ** の Redis | `requirements.txt` から `upstash-redis` を削除。`from upstash_redis import Redis` が ImportError になる | ただし `redis_cache.py` は try/except で保護しており、L2 Redis が無効化されるだけ（L1 インメモリのみで動作）。クラッシュはしない |

### 安全に両立させるなら

`app/backend/requirements.txt` に `upstash-redis` を戻せば Cloud Run の再デプロイも安全:
```
redis>=5.0.0,<6.0.0
upstash-redis>=1.0.0,<2.0.0   # Cloud Run フォールバック用
```
ただし Cloud Run を廃止予定なら不要。

---

## 必要な環境変数

### `.env` (docker compose 用)

```bash
# 必須
DB_PASSWORD=<PostgreSQL パスワード>
JWT_SECRET=<Supabase JWT シークレットと同じ値>
FRED_API_KEY=<FRED API キー>

# 任意
SENTRY_DSN=<Sentry DSN>
GA_ID=<Google Analytics ID>
GOOGLE_CLIENT_ID=<Google OAuth>
GOOGLE_CLIENT_SECRET=<Google OAuth>
ADMIN_EMAILS=<admin@example.com>
MFA_ENCRYPTION_KEY=<MFA 暗号化キー>
```

---

## 使い方

### 通常起動

```bash
docker compose up -d
# nginx(80) → api-python(8081), api-go(8080), frontend(3000)
```

### バッチ実行

```bash
# 日次バッチ
docker compose run --rm batch python -m app.batch.run --daily

# 週次バッチ
docker compose run --rm batch python -m app.batch.run --weekly

# 手動入力 CLI
docker compose run --rm batch python -m app.batch.manual_input list
docker compose run --rm batch python -m app.batch.manual_input add ADP 2026-03 150

# Layer 計算のみ
docker compose run --rm batch python -m app.batch.run --calc

# 事前計算のみ
docker compose run --rm batch python -m app.batch.run --precompute
```

### バックアップ

```bash
docker compose run --rm batch bash scripts/r2-backup.sh
# 出力: /backup/open_regime_YYYYMMDD_HHMMSS.sql.gz
# R2 アップロードは VPS 契約後に追加
```

### エンドポイント確認

```bash
curl http://localhost/health              # → ok
curl http://localhost/api/regime           # → {"regime":"BEAR",...}
curl http://localhost/api/signal/SPY       # → signal JSON
curl http://localhost/api/exit/SPY?entry_price=100  # → exit JSON
curl http://localhost/api/stock/batch-quotes?tickers=SPY  # → quotes JSON
```

---

## 動作確認結果 (2026-03-28)

```
docker compose build api-python  → OK
docker compose build batch       → OK
docker compose up -d             → 全サービス起動
/health                          → ok
/api/regime                      → {"regime":"BEAR",...}
/api/signal/SPY                  → signal JSON (ticker, price, ...)
/api/exit/SPY?entry_price=100    → {"ticker":"SPY",...}
/api/stock/batch-quotes?tickers=SPY → {"quotes":[...],"count":1}
```

---

## 今後の作業（レーンA 範囲外）

1. **Cloud Run 廃止判断** — VPS Docker が安定したら Cloud Run をオフにし、`requirements.txt` から `upstash-redis` / `supabase` を削除
2. **crontab 設定** — VPS 上で `docker compose run --rm batch python -m app.batch.run --daily` のスケジュール
3. **R2 バックアップ** — `scripts/r2-backup.sh` に AWS CLI の R2 アップロードを追加
4. **Supabase → PostgreSQL データ移行** — `scripts/export-supabase.sh` で既存データをダンプし、Docker PG にインポート
5. **auth.py の Supabase SDK パス削除** — Cloud Run 廃止後に `_resolve_user_supabase()` を削除可能
