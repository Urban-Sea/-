# レーンA: api-python Docker化 (Step 2) + Batch Docker化 (Step 6)

## 背景

VPS Docker移行プロジェクトのレーンA。現在のシステムは Cloudflare Workers (CRUD) + Google Cloud Run (Python計算API) + Supabase (DB/Auth) + Upstash Redis で構成されている。

このレーンでは Python 側のコンテナ化を担当する。

- 設計書: `tasks/vps-docker-design.md`（Section 5, 7）
- 実装計画: `tasks/vps-migration-plan.md`

---

## 最重要ルール: CRUDルーターは一切変換しない

`app/backend/routers/` にある **10個のCRUDルーター** は全てレーンB (Go) に移植される。asyncpg への変換は不要。Supabase SDK のまま残す。

対象（触らないファイル）:
- `holdings.py` (15ep), `trades.py` (6ep), `watchlist.py` (6ep)
- `users.py` (2ep), `admin.py` (8ep), `admin_mfa.py` (5ep)
- `stocks.py` (3ep), `market_state.py` (3ep)
- `liquidity.py` (12ep), `employment.py` (5ep)

これらは nginx でルーティングしないため、Docker 環境では呼ばれない。

---

## 確認済みの事実

### 計算ルーター4つは DB アクセスがゼロ

`signal.py`, `regime.py`, `exit.py`, `stock.py` 内に `supabase` の呼び出しは **一切ない**。yfinance + Redis のみで動作する。→ **Redis 接続変更だけで動く**。

### CRUDルーターの Supabase 呼び出しパターン

全65箇所が **関数内で** `supabase = main.get_supabase()` を呼ぶパターン。import 時に Supabase client を参照するルーターは **ゼロ**。

→ `get_supabase()` が `None` を返しても **FastAPI は正常起動する**。CRUDエンドポイントが実際に呼ばれた時のみ `NoneType` エラーになるが、nginx でルーティングしないので問題なし。

### auth.py の Supabase 依存

`auth.py:79` で `from main import get_supabase` → `supabase.table("users")` を呼んでいる（`_resolve_user_by_jwt()` 関数内）。これは asyncpg に変換が必要。

具体的なDB操作（auth.py 内の全Supabase呼び出し）:
1. `supabase.table("users").select("id, is_active").eq("auth_provider_id", sub)` — auth_provider_id で検索
2. `supabase.table("users").update({"last_login_at": now_iso}).eq("id", user["id"])` — last_login_at 更新
3. `supabase.table("users").select("id, is_active, auth_provider").eq("email", email_lower)` — email で検索
4. `supabase.table("users").update({...}).eq("id", user["id"])` — auth_provider 移行更新
5. `supabase.table("users").insert({...})` — 新規ユーザー作成
6. `supabase.table("users").select("id").eq("auth_provider_id", sub)` — 競合時リトライ

### redis_cache.py の構造

L1 (インメモリ dict) + L2 (Upstash Redis REST) の2層キャッシュ。`get_redis()` が lazy init で Upstash client を返す。公開 API は `cache_get(key)` / `cache_set(key, data, ttl)`。

現状の接続: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` → `upstash_redis.Redis(url, token)`

### main.py の構造

- L13: `from supabase import create_client, Client`
- L96: `supabase: Client = None` (グローバル変数)
- L100-136: `lifespan()` で Supabase client を初期化（SUPABASE_URL + SUPABASE_KEY）
- L323-325: `get_supabase() -> Client` がグローバル変数を返す
- L21: 全15ルーターを一括 import（起動時に全ルーターが読み込まれる）

---

## Step 2: api-python Docker化

### 2-1. `app/backend/db.py` 新設 — asyncpg pool

auth.py がユーザー解決で DB アクセスするために必要。計算ルーターは使わない。

```python
# init_pool() / close_pool() / get_pool()
# 環境変数: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
```

### 2-2. `app/backend/redis_cache.py` 書き換え

- `upstash_redis` → `redis.asyncio`（pip: `redis>=5.0.0`）
- `get_redis()` の初期化: `redis.from_url(os.environ.get("REDIS_URL", ""))`
- `cache_get` / `cache_set` のインターフェースは維持（L1 + L2 の2層構造も維持）
- ⚠️ 現在 `cache_get`/`cache_set` は **同期関数**。`redis.asyncio` に変更する場合は呼び出し元も `await` が必要になる。影響範囲を確認してから決める（同期の `redis` パッケージを使う手もある）
- `requirements.txt`: `redis>=5.0.0` 追加、`upstash-redis` 削除

### 2-3. `app/backend/main.py` 書き換え

**変更点:**
- `from supabase import create_client, Client` → 削除しない（CRUDルーターが使う）
- `lifespan()` に asyncpg pool init / close を追加
- `lifespan()` の Supabase init は**削除しない** — `get_supabase()` は None を返すスタブにする
  - 理由: CRUDルーターが `main.get_supabase()` を65箇所で呼んでいる。import エラーにならないよう関数は残す
- CORS に `http://localhost:3000` を追加（開発環境、既に入っている）

**具体的な lifespan 変更:**
```python
# 追加: asyncpg pool
from db import init_pool, close_pool

@asynccontextmanager
async def lifespan(app: FastAPI):
    # asyncpg pool 初期化
    await init_pool()

    # Supabase client は初期化しない（Docker環境では不要）
    # get_supabase() は None を返す → CRUDルーターは動かないが問題なし

    yield

    await close_pool()
```

### 2-4. `app/backend/auth.py` 書き換え

`_resolve_user_by_jwt()` 内の Supabase 呼び出し（6箇所）を asyncpg SQL に変換:

```python
# Before (L79-80):
from main import get_supabase
supabase = get_supabase()

# After:
from db import get_pool
pool = get_pool()

# Before (L87-89):
result = supabase.table("users").select("id, is_active").eq("auth_provider_id", sub).limit(1).execute()

# After:
row = await pool.fetchrow("SELECT id, is_active FROM users WHERE auth_provider_id = $1", sub)
```

⚠️ `_resolve_user_by_jwt()` は現在 **同期関数**（def、async def ではない）。asyncpg は async なので `async def` に変更が必要。呼び出し元の `require_auth()` (L168) は既に `async def` なので `await _resolve_user_by_jwt(sub, email)` に変更するだけ。

### 2-5. 計算ルーター4つ — Redis 接続変更のみ

`signal.py`, `regime.py`, `exit.py`, `stock.py` は DB アクセスがゼロ。`redis_cache.py` の修正が反映されれば自動的に動く。個別の変更は不要（`from redis_cache import cache_get, cache_set` で呼んでいるはず）。

### 2-6. Sentry SDK

既に導入済み（main.py L36-44）。環境変数 `SENTRY_DSN` が Docker 環境で渡されることを確認するだけ。

### 2-7. Dockerfile 更新

- ポート: `8081`（api-go が 8080 を使う）
- `requirements.txt` の変更を反映

### 2-8. docker-compose.yml に `api-python` 追加

```yaml
api-python:
  build: ./app/backend
  environment:
    - DB_HOST=postgres
    - DB_PORT=5432
    - DB_NAME=open_regime
    - DB_USER=app
    - DB_PASSWORD=${DB_PASSWORD}
    - REDIS_URL=redis://redis:6379
    - JWT_SECRET=${JWT_SECRET}
    - ENVIRONMENT=development
    - SENTRY_DSN=${SENTRY_DSN:-}
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
  mem_limit: 512m
  restart: unless-stopped
```

### 2-9. nginx upstream 追加

`nginx/conf.d/default.conf` で `/api/(signal|regime|exit|stock)` のコメントアウトを解除。**それ以外の `/api/*` は api-go（レーンB完了後に有効化）。**

### 2-10. 動作確認

```bash
docker compose up -d
curl http://localhost/api/regime          # → regime JSON
curl http://localhost/api/signal/SPY      # → signal JSON
curl http://localhost/api/exit/SPY?entry_price=100  # → exit JSON
curl http://localhost/api/stock/SPY       # → stock info JSON
```

---

## Step 6: Batch Docker化

Batch は api-go に移行しないため、Supabase → psycopg2 の **全変換が必要**。

### 6-1. `app/batch/config.py`

`supabase = create_client(url, key)` → `psycopg2.connect(host, port, dbname, user, password)`

### 6-2. `app/batch/db.py` 全 upsert 関数を SQL 化

```python
# Before:
supabase.table(t).upsert(rows, on_conflict=col).execute()

# After:
INSERT INTO t (...) VALUES (...) ON CONFLICT (col) DO UPDATE SET ...
```

### 6-3. `app/batch/manual_input.py` SQL 化

ADP_CHANGE, CHALLENGER_CUTS, TRUFLATION の手動入力 CLI が動くこと。

### 6-4. `app/batch/snapshot.py` SQL 化

### 6-5. `app/batch/calculators/precompute.py` Redis 変更

Upstash REST → redis 直接接続。

### 6-6. Batch Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY app/batch/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/batch/ ./app/batch/
COPY app/backend/analysis/ ./app/backend/analysis/   # batch が参照する分析モジュール
CMD ["python", "-m", "app.batch.run", "--daily"]
```

build context はリポジトリルート（`app/backend/analysis/` を COPY するため）。

### 6-7. `app/batch/requirements.txt` 作成

batch 固有: psycopg2-binary, pandas, yfinance, fredapi, requests, python-dotenv, redis

### 6-8. docker-compose.yml に batch 追加

```yaml
batch:
  build:
    context: .
    dockerfile: app/batch/Dockerfile
  profiles: [tools]
  environment:
    - DB_HOST=postgres
    - DB_PORT=5432
    - DB_NAME=open_regime
    - DB_USER=app
    - DB_PASSWORD=${DB_PASSWORD}
    - REDIS_URL=redis://redis:6379
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
```

### 6-9. r2-uploader スクリプト + Dockerfile

`scripts/r2-backup.sh`: `pg_dump | gzip > /backup/...` まで確認。R2 実アップロードは VPS 契約後。

### 6-10. 動作確認

```bash
docker compose run --rm batch python -m app.batch.run --daily
docker compose run --rm batch python -m app.batch.run --weekly
docker compose run --rm batch python -m app.batch.manual_input list
```

---

## 変更対象ファイル一覧

### Step 2 (api-python)

| ファイル | 操作 | 内容 |
|---|---|---|
| `app/backend/db.py` | 新規 | asyncpg pool (auth.py 用) |
| `app/backend/redis_cache.py` | 修正 | Upstash REST → redis 直接接続 |
| `app/backend/main.py` | 修正 | lifespan に pool init、Supabase init 削除、get_supabase() は None スタブ |
| `app/backend/auth.py` | 修正 | _resolve_user_by_jwt() を asyncpg SQL に変換 (6箇所) |
| `app/backend/requirements.txt` | 修正 | redis>=5.0.0 追加、upstash-redis 削除、asyncpg 確認 |
| `app/backend/Dockerfile` | 修正 | ポート 8081 |
| `docker-compose.yml` | 追記 | api-python サービス |
| `nginx/conf.d/default.conf` | 追記 | /api/(signal\|regime\|exit\|stock) → api-python |

### Step 6 (batch)

| ファイル | 操作 | 内容 |
|---|---|---|
| `app/batch/config.py` | 修正 | Supabase → psycopg2 |
| `app/batch/db.py` | 修正 | 全 upsert を SQL 化 |
| `app/batch/manual_input.py` | 修正 | Supabase → psycopg2 |
| `app/batch/snapshot.py` | 修正 | Supabase → psycopg2 |
| `app/batch/calculators/precompute.py` | 修正 | Upstash → redis 直接 |
| `app/batch/requirements.txt` | 新規 | batch 固有の依存 |
| `app/batch/Dockerfile` | 新規 | Python 3.11 slim |
| `docker-compose.yml` | 追記 | batch サービス (profiles: tools) |
| `scripts/r2-backup.sh` | 新規 | pg_dump + gzip |

---

## 注意事項

1. **`from supabase import create_client, Client`** は main.py から削除しない。CRUDルーターが参照する
2. **`get_supabase()` 関数は残す**。None を返すスタブにする
3. **`_resolve_user_by_jwt()` を async に変更** する必要がある（asyncpg が async のため）
4. **redis_cache.py の同期/非同期** を確認してから変更方針を決める
5. **計算ルーター4つは DB アクセスゼロ** — Redis 変更だけで動く
