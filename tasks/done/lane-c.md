# レーンC: Frontend SSR化 (Step 5 Phase A)

> 完了日: 2026-03-28
> ステータス: Phase A 完了、Phase B は Step 3 (api-go 認証) 完了待ち

---

## 概要

Cloudflare Pages 向け static export (`output: 'export'`) → VPS 上の Next.js SSR (`output: 'standalone'`) に移行。
Docker standalone モードで軽量コンテナ化し、nginx 経由でアクセスできるようにした。

**Phase A（SSR化）のみ完了。Phase B（Supabase Auth → Cookie JWT 認証への書き換え）は未着手。**

---

## 変更内容

### 1. SSR モードへの切り替え

| ファイル | Before | After |
|---------|--------|-------|
| `app/frontend/next.config.ts` | `output: 'export'` | `output: 'standalone'` |
| `app/admin-frontend/next.config.ts` | `output: 'export'` | `output: 'standalone'` |
| `app/frontend/next.config.ts` | `images: { unoptimized: true }` | `images: { remotePatterns: [googleusercontent] }` |
| `app/admin-frontend/next.config.ts` | 同上 | 同上 |

- `output: 'standalone'` は `.next/standalone/` に Node.js サーバー + 依存パッケージをバンドルする。Docker イメージが軽量になる
- `images.unoptimized` 削除により Next.js Image Optimization が有効になった

### 2. API URL を相対パスに変更

| ファイル | Before | After |
|---------|--------|-------|
| `app/frontend/src/lib/api.ts` | `'https://api.open-regime.com'` | `''` |
| `app/frontend/src/lib/swr.tsx` | `'https://api.open-regime.com'` | `''` |
| `app/admin-frontend/src/lib/api.ts` | `'https://open-regime-api.ryu3ta-ke-mo100307.workers.dev'` | `''` |
| `app/admin-frontend/src/lib/swr.tsx` | 同上 | `''` |

- fallback を空文字にしたことで、`fetch('/api/holdings')` のように相対パスで呼ばれる
- ブラウザ → nginx → api-go/api-python とルーティングされる
- CORS が不要になる（同一オリジン）

**SSR 時の API URL 分離が不要な理由:**
`swr.tsx` は `'use client'` ディレクティブ付き。SWR fetcher / fetchAPI は全てクライアントサイド（ブラウザ）で実行される。SSR 時にサーバーサイドで API を呼ぶコードは現時点でゼロ。将来 Server Components でデータフェッチを追加する場合は `INTERNAL_API_URL = http://nginx:80` の分離が必要になるが、Phase A のスコープ外。

### 3. SEO 追加

| ファイル | 内容 |
|---------|------|
| `app/frontend/src/app/layout.tsx` | metadata に OpenGraph + Twitter Card 追加 |
| `app/frontend/src/app/sitemap.ts` | 新規作成。6ページ分のサイトマップ (`/sitemap.xml`) |
| `app/frontend/src/app/robots.ts` | 新規作成。`/api/` を検索エンジンから除外 |

### 4. GA4 統合

`app/frontend/src/app/layout.tsx` に gtag.js の `<Script>` タグを追加。

- `NEXT_PUBLIC_GA_ID` 環境変数が設定されていれば読み込む
- 未設定なら何もしない（開発環境では無効）
- ページビューは gtag が Next.js のルーティング変更を自動検知してトラッキング

**GA4 プロパティの作成は未実施。** Google Analytics でプロパティを作成し、測定 ID (`G-XXXXXXXXXX`) を `.env.docker` の `GA_ID` に設定する必要がある。

### 5. Sentry

`@sentry/react` のまま維持（`@sentry/nextjs` への移行はスコープ外）。

- `lib/sentry.ts` の `Sentry.init()` はサーバーサイドで呼ばれても例外を投げない（no-op）
- SSR ビルドで問題なし（確認済み）
- Docker 環境変数 `NEXT_PUBLIC_SENTRY_DSN` で DSN を渡す

### 6. build スクリプト修正

| ファイル | Before | After |
|---------|--------|-------|
| `app/frontend/package.json` | `"next build && find out -name '*.txt' -delete"` | `"next build"` |
| `app/admin-frontend/package.json` | 同上 | `"next build"` |

SSR モードでは `out/` ディレクトリが生成されないため `find out` は不要。

### 7. Dockerfile 新規作成

| ファイル | 構成 | ポート |
|---------|------|--------|
| `app/frontend/Dockerfile` | multi-stage (deps → builder → runner) | 3000 |
| `app/admin-frontend/Dockerfile` | 同上 | 3002 |

構成:
1. **deps**: `npm ci` で依存インストール
2. **builder**: `npm run build` で standalone ビルド
3. **runner**: `node:20-alpine` 最小イメージ、非 root ユーザー (`nextjs:1001`)、`.next/standalone/` + `public/` + `.next/static/` のみコピー

admin-frontend は `ENV PORT=3002` で Next.js standalone の起動ポートを制御。

### 8. docker-compose.yml 更新

追加したサービス:

```yaml
frontend:
  build: ./app/frontend
  environment:
    - NEXT_PUBLIC_SENTRY_DSN=${SENTRY_DSN:-}
    - NEXT_PUBLIC_GA_ID=${GA_ID:-}
  mem_limit: 256m, cpus: 0.5

admin-frontend:
  build: ./app/admin-frontend
  environment:
    - PORT=3002
    - NEXT_PUBLIC_SENTRY_DSN=${SENTRY_DSN:-}
  mem_limit: 256m, cpus: 0.5
```

nginx の `depends_on` に `frontend` を追加。

### 9. nginx 更新

```nginx
upstream frontend {
    server frontend:3000;
}
upstream admin_frontend {
    server admin-frontend:3002;
}

location / {
    proxy_pass http://frontend;
    # WebSocket 対応 (HMR 等)
}
```

`/api/(signal|regime|exit|stock)` → api-python、`/api/` → api-go が先にマッチするので、`location /` は最後にフォールバックとして frontend に到達する。

---

## 変更ファイル一覧 (14件)

| ファイル | 操作 |
|---------|------|
| `app/frontend/next.config.ts` | 修正 |
| `app/frontend/package.json` | 修正 |
| `app/frontend/src/lib/api.ts` | 修正 |
| `app/frontend/src/lib/swr.tsx` | 修正 |
| `app/frontend/src/app/layout.tsx` | 修正 |
| `app/frontend/src/app/sitemap.ts` | **新規** |
| `app/frontend/src/app/robots.ts` | **新規** |
| `app/frontend/Dockerfile` | **新規** |
| `app/admin-frontend/next.config.ts` | 修正 |
| `app/admin-frontend/package.json` | 修正 |
| `app/admin-frontend/src/lib/swr.tsx` | 修正 |
| `app/admin-frontend/src/lib/api.ts` | 修正 |
| `app/admin-frontend/Dockerfile` | **新規** |
| `docker-compose.yml` | 修正 |
| `nginx/conf.d/default.conf` | 修正 |

---

## 検証結果

```
✅ cd app/frontend && npm run build       → 成功 (21ページ、warning のみ)
✅ cd app/admin-frontend && npm run build  → 成功 (7ページ)
```

---

## ユーザーが知っておくべきこと

### 1. Phase B（認証フロー書き換え）は未着手

`@supabase/supabase-js` の認証関連コードはそのまま残っている。以下は Step 3 (api-go 認証) 完了後に実施:

| 現在 | 変更先 |
|------|--------|
| `supabase.auth.signInWithOAuth({ provider: 'google' })` | `window.location = '/api/auth/google'` |
| `supabase.auth.getSession()` → Authorization ヘッダー | Cookie 自動送信 (`credentials: 'include'`) |
| `supabase.auth.signOut()` | `POST /api/auth/logout` |
| `supabase.auth.onAuthStateChange()` | `/api/auth/me` ポーリング or Cookie 有無チェック |
| `supabase.auth.refreshSession()` (401 リトライ) | Cookie JWT の自動リフレッシュ |

### 2. `NEXT_PUBLIC_*` 環境変数はビルド時に埋め込まれる

Next.js の `NEXT_PUBLIC_` プレフィックス付き環境変数は **Docker イメージビルド時** にバンドルに焼き込まれる。ランタイムでの変更は反映されない。

- 値を変更したら `docker compose build frontend` の再ビルドが必要
- `SENTRY_DSN` や `GA_ID` を本番用に設定してからビルドすること

### 3. admin-frontend の nginx ルーティングは未設定

`upstream admin_frontend` は定義したが、どのパス/ドメインで admin に振るかの `location` ブロックはまだ追加していない。

想定される選択肢:
- **サブドメイン**: `admin.open-regime.com` で別の `server` ブロック → CF Access で保護
- **パスベース**: `location /admin/ { proxy_pass http://admin_frontend; }`

設計書では `open-regime-admin.pages.dev` (カスタムドメインなし、CF Access 保護) となっている。VPS 移行後の方針を決めてから設定する。

### 4. GA4 プロパティは未作成

コードは入っているが、以下が未実施:
1. Google Analytics で GA4 プロパティを作成
2. 測定 ID (`G-XXXXXXXXXX`) を取得
3. `.env.docker` に `GA_ID=G-XXXXXXXXXX` を設定
4. `docker compose build frontend` で再ビルド

不要であればコードを削除可能（layout.tsx の `{process.env.NEXT_PUBLIC_GA_ID && ...}` ブロック + docker-compose の `GA_ID` 環境変数）。

### 5. Supabase SDK がサーバーサイドで動作するリスク

現在のページコンポーネントは全て `'use client'` またはクライアントコンポーネントから呼ばれているため、SSR 時にサーバーサイドで Supabase SDK が実行されることはない。

**ただし、将来 Server Components を追加する場合は注意:**
- `supabase.auth.getSession()` は `localStorage` に依存 → サーバーサイドでは動作しない
- `typeof window === 'undefined'` チェックを入れるか、`'use client'` を明示する必要がある
- Phase B で Supabase SDK を除去すればこの問題は解消される

### 6. standalone モードの注意点

- `.next/standalone/` にバンドルされるのは `node_modules` のサブセットのみ（ファイルトレーシングで必要な分だけ）
- `public/` と `.next/static/` は自動コピーされない → Dockerfile で手動コピー済み
- `server.js` が起動スクリプト。`next start` ではなく `node server.js` で起動
- ポートは `PORT` 環境変数で制御（admin-frontend は `PORT=3002`）

### 7. outputFileTracingRoot の Warning

ビルド時に以下の warning が出る:

```
⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
We detected multiple lockfiles and selected the directory of /Users/ryu/package-lock.json as the root directory.
```

これは monorepo 構成で複数の `package-lock.json` が存在するため。Docker ビルド時はコンテキストが `./app/frontend` に限定されるので問題ない。ローカルで気になる場合は `next.config.ts` に `outputFileTracingRoot` を設定できるが、必須ではない。

---

## Phase B 着手時の手順（Step 3 完了後）

1. `app/frontend/src/lib/supabase.ts` の認証関連コードを確認
2. `app/frontend/src/components/providers/UserProvider.tsx` の `onAuthStateChange` を `/api/auth/me` ポーリングに書き換え
3. `app/frontend/src/lib/api.ts` の 401 リトライ内 `supabase.auth.refreshSession()` を削除（Cookie JWT は自動リフレッシュ）
4. `app/frontend/src/lib/swr.tsx` の同様の箇所を修正
5. ログイン/登録ページの `supabase.auth.signInWithOAuth()` → `window.location = '/api/auth/google'`
6. `app/frontend/src/app/auth/callback/page.tsx` を api-go のコールバックに合わせて書き換え
7. `@supabase/supabase-js` を `package.json` から削除
8. admin-frontend も同様に対応（`X-User-Email` + `X-MFA-Token` → Cookie JWT）
