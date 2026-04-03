# レーンC: Frontend SSR化 (Step 5)

## 背景

VPS Docker移行のレーンC。Cloudflare Pages 向け static export → VPS 上の Next.js SSR に移行する。

- Phase A（SSR化・SEO・GA4・Sentry・Dockerfile）は先行着手可能
- Phase B（認証フロー書き換え）は Step 3 (レーンB) の認証完了待ち
- 設計書: `tasks/vps-docker-design.md` Section 8

---

## 最重要ルール

1. **Phase B（認証フロー書き換え）はこのタスクのスコープ外**。Supabase Auth SDK の除去は Step 3 完了後に別途実施
2. **Supabase 関連の import/コードは触らない** — Phase A では SSR ビルドが通ることだけを保証する

---

## 確認済みの事実

### next.config.ts — 既に変更済み ✅

```ts
// output: 'export' → 削除済み
// images.unoptimized → remotePatterns に変更済み
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '**.googleusercontent.com' },
  ],
},
trailingSlash: true,
```

→ **追加で `output: 'standalone'` が必要**（Docker standalone モード用）

### データフェッチは全てクライアントサイド

- `app/frontend/src/lib/swr.tsx` L1: **`'use client'`** ディレクティブあり → SWR fetcher はブラウザでのみ実行
- `app/frontend/src/lib/api.ts`: SWR hooks + fetchAPI 関数 → 全てクライアントサイドから呼ばれる
- **SSR 時にサーバーサイドで API を呼ぶコードは現時点でゼロ**

→ coworker が指摘した「SSR 時の API URL 分離」（`INTERNAL_API_URL = http://nginx:80`）は **Phase A では不要**。全てクライアントサイド fetch なので相対パスでブラウザ → nginx → api に到達する。将来 Server Components でデータフェッチを追加する場合に必要になるが、今は不要。

### API URL のハードコード箇所

| ファイル | 行 | 現在の値 |
|---|---|---|
| `app/frontend/src/lib/api.ts` | L42 | `process.env.NEXT_PUBLIC_API_URL \|\| 'https://api.open-regime.com'` |
| `app/frontend/src/lib/swr.tsx` | L8 | `process.env.NEXT_PUBLIC_API_URL \|\| 'https://api.open-regime.com'` |
| `app/admin-frontend/src/lib/swr.tsx` | L7 | `process.env.NEXT_PUBLIC_API_URL \|\| 'https://open-regime-api.ryu3ta-ke-mo100307.workers.dev'` |
| `app/admin-frontend/src/lib/api.ts` | 要確認 | 同様のパターンがあるはず |

→ 全て fallback を `''`（空文字 = 相対パス）に変更

### 認証の現状（Phase B で変更、今は触らない）

- `api.ts` L39-40: `import { getAccessToken, setAccessToken } from './auth-store'` + `import { supabase } from './supabase'`
- `api.ts` L56-79: 401 時に `supabase.auth.refreshSession()` でトークンリフレッシュ
- `swr.tsx` L4-5: 同様に `auth-store` + `supabase` import
- admin-frontend: `X-User-Email` + `X-MFA-Token` ヘッダーを localStorage から取得

### package.json の build スクリプト

- `app/frontend/package.json` L7: `"build": "next build && find out -name '*.txt' -delete"`
  - SSR では `out/` ディレクトリは生成されない → `find out` を削除
- `app/admin-frontend/package.json`: 同様に確認して修正

### Sentry

- `@sentry/react` を使用中（`@sentry/nextjs` ではない）
- `app/frontend/src/lib/sentry.ts` に初期化コード（`typeof window` チェックが入っている想定）
- **Phase A では `@sentry/react` のまま維持** — `@sentry/nextjs` 移行は大きい変更（instrumentation.ts, sentry.client.config.ts 等が必要）でスコープ外
- Docker 環境変数 `NEXT_PUBLIC_SENTRY_DSN` を docker-compose で渡す

### layout.tsx の現状

- SEO metadata は最小限（title + description のみ）
- openGraph, twitter, icons がない
- GA4 統合なし

---

## Phase A: SSR化タスク

### 1. next.config.ts に `output: 'standalone'` 追加

```ts
const nextConfig: NextConfig = {
  output: 'standalone',  // ← 追加（Docker standalone モード）
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.googleusercontent.com' },
    ],
  },
  trailingSlash: true,
};
```

ファイル: `app/frontend/next.config.ts`

### 2. API URL を相対パスに変更

**変更ファイル:**

| ファイル | 変更内容 |
|---|---|
| `app/frontend/src/lib/api.ts` L42 | fallback を `''` に |
| `app/frontend/src/lib/swr.tsx` L8 | fallback を `''` に |
| `app/admin-frontend/src/lib/swr.tsx` L7 | fallback を `''` に |
| `app/admin-frontend/src/lib/api.ts` | 同様に確認して変更 |

```ts
// Before:
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.open-regime.com';

// After:
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
```

**SSR 時の API URL 分離は不要** — 現在のデータフェッチは全てクライアントサイド（`'use client'` + SWR）。将来 Server Components を追加する場合に `INTERNAL_API_URL` が必要になるが、Phase A のスコープ外。

### 3. SEO: metadata 強化 + sitemap.ts + robots.ts

**変更ファイル:**

| ファイル | 内容 |
|---|---|
| `app/frontend/src/app/layout.tsx` | metadata に openGraph, twitter, icons 追加 |
| `app/frontend/src/app/sitemap.ts` | 新規作成 |
| `app/frontend/src/app/robots.ts` | 新規作成 |

設計書 `tasks/vps-docker-design.md` Section 8 のコード例をベースにする。

### 4. GA4 統合

`app/frontend/src/app/layout.tsx` に `<Script>` タグ追加:

```tsx
import Script from 'next/script';

// body 内に追加:
{process.env.NEXT_PUBLIC_GA_ID && (
  <>
    <Script src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`} strategy="afterInteractive" />
    <Script id="ga4" strategy="afterInteractive">
      {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${process.env.NEXT_PUBLIC_GA_ID}');`}
    </Script>
  </>
)}
```

### 5. Sentry 確認

- `@sentry/react` のまま維持（`@sentry/nextjs` 移行はスコープ外）
- Docker 環境変数 `NEXT_PUBLIC_SENTRY_DSN` を確認
- SSR ビルドが通ることを確認（`typeof window` チェックが入っていれば問題なし）

### 6. package.json の build スクリプト修正

```json
// Before:
"build": "next build && find out -name '*.txt' -delete"

// After:
"build": "next build"
```

ファイル: `app/frontend/package.json`, `app/admin-frontend/package.json`

### 7. Dockerfile 作成 (multi-stage)

新規: `app/frontend/Dockerfile`

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

⚠️ standalone モードは `output: 'standalone'` が next.config.ts に必要（タスク1で追加）。

### 8. docker-compose.yml + nginx 更新

**docker-compose.yml に追加:**

```yaml
frontend:
  build: ./app/frontend
  environment:
    - NEXT_PUBLIC_SENTRY_DSN=${SENTRY_DSN:-}
    - NEXT_PUBLIC_GA_ID=${GA_ID:-}
  depends_on:
    api-python:
      condition: service_started
  mem_limit: 256m
  cpus: 0.5
  restart: unless-stopped

admin-frontend:
  build: ./app/admin-frontend
  environment:
    - NEXT_PUBLIC_SENTRY_DSN=${SENTRY_DSN:-}
  mem_limit: 256m
  cpus: 0.5
  restart: unless-stopped
```

**nginx/conf.d/default.conf:**

```nginx
upstream frontend {
    server frontend:3000;
}
# admin は別の server ブロック or パスで

# Step 5: Frontend
location / {
    proxy_pass http://frontend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

⚠️ nginx の `location /` は **最後に配置**（`/api/` より下）。`/api/` が先にマッチするので計算ルーターとの衝突はない。

### 9. admin-frontend SSR化 + Dockerfile

| ファイル | 変更内容 |
|---|---|
| `app/admin-frontend/next.config.ts` | `output: 'export'` → `output: 'standalone'`、images 修正 |
| `app/admin-frontend/package.json` | build スクリプト修正 |
| `app/admin-frontend/src/lib/swr.tsx` | API_URL fallback を `''` に |
| `app/admin-frontend/src/lib/api.ts` | API_URL fallback を `''` に（存在する場合） |
| `app/admin-frontend/Dockerfile` | 新規 — frontend と同じ構成（ポート 3002） |

admin-frontend の Dockerfile では `EXPOSE 3002` + `CMD ["node", "server.js"]`。
Next.js standalone の起動ポートは環境変数 `PORT=3002` で制御。

---

## 変更対象ファイル一覧

| ファイル | 操作 | 内容 |
|---|---|---|
| `app/frontend/next.config.ts` | 修正 | `output: 'standalone'` 追加 |
| `app/frontend/package.json` | 修正 | build スクリプト修正 |
| `app/frontend/src/lib/api.ts` | 修正 | API_URL fallback を `''` に |
| `app/frontend/src/lib/swr.tsx` | 修正 | API_URL fallback を `''` に |
| `app/frontend/src/app/layout.tsx` | 修正 | SEO metadata + GA4 Script |
| `app/frontend/src/app/sitemap.ts` | 新規 | サイトマップ |
| `app/frontend/src/app/robots.ts` | 新規 | robots.txt |
| `app/frontend/Dockerfile` | 新規 | multi-stage standalone |
| `app/admin-frontend/next.config.ts` | 修正 | SSR + standalone |
| `app/admin-frontend/package.json` | 修正 | build スクリプト修正 |
| `app/admin-frontend/src/lib/swr.tsx` | 修正 | API_URL fallback を `''` に |
| `app/admin-frontend/src/lib/api.ts` | 修正 | API_URL fallback を `''` に |
| `app/admin-frontend/Dockerfile` | 新規 | multi-stage standalone (ポート 3002) |
| `docker-compose.yml` | 追記 | frontend + admin-frontend サービス |
| `nginx/conf.d/default.conf` | 修正 | upstream frontend 有効化 |

---

## 検証

```bash
cd app/frontend && npm run build        # エラーなくビルド完了
cd app/admin-frontend && npm run build   # 同上
docker compose build frontend admin-frontend  # Docker イメージビルド成功
docker compose up -d
curl http://localhost/                   # → SSR HTML が返る（<meta> タグ含む）
```

---

## スコープ外（Phase B: Step 3 完了後）

- Supabase Auth SDK 除去（`@supabase/supabase-js` の認証依存を除去）
- Cookie ベース JWT 認証への切り替え（`supabase.auth.signInWithOAuth()` → `window.location = '/api/auth/google'`）
- SWR fetcher の Authorization ヘッダー手動付与 → Cookie 自動送信への変更
- 認証状態管理の書き換え（`onAuthStateChange` → `/api/auth/me` ポーリング）

---

## 注意事項

1. **`@supabase/supabase-js` の import は残す** — Phase B まで認証フローは既存のまま維持
2. **SSR ビルド時に Supabase SDK がサーバーサイドで動作するか確認** — `typeof window` チェックが入っていなければビルドエラーになる可能性あり。その場合は dynamic import or `'use client'` で対応
3. **standalone モードでは `node_modules` が `.next/standalone/` にバンドルされる** — `public/` と `.next/static/` は手動コピーが必要（Dockerfile で対応済み）
4. **admin-frontend の認証** は `X-User-Email` + `X-MFA-Token` ヘッダー方式。Phase B で Cookie JWT に変更される
