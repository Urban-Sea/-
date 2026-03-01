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
| `plumbing:summary` | 流動性サマリー | 1800s |
| `liquidity:events` | 流動性イベント | 1800s |
| `liquidity:policy` | 政策データ | 1800s |
| `liquidity:backtest:{limit}` | バックテスト | 3600s |
| `employment:risk_score` | 雇用リスクスコア | 3600s |
| `employment:risk_history:{months}` | 雇用リスク履歴 | 3600s |
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
