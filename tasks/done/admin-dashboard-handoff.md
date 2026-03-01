# Admin Dashboard 引き継ぎ

## 目的
管理者専用の Admin Dashboard を **別ドメインの Cloudflare Pages** として作成する。

## 現在のアーキテクチャ

```
[ユーザー向け]
open-regime.pages.dev (Next.js, Cloudflare Pages)
    ↓ API呼び出し
open-regime-api.ryu3ta-ke-mo100307.workers.dev (Cloudflare Worker, Edge Proxy)
    ↓ プロキシ
empathetic-hope-production.up.railway.app (FastAPI, Railway)
    ↓
Supabase PostgreSQL
```

## 既存の Backend Admin API（実装済み）

### `app/backend/routers/admin.py`
- `GET /api/admin/users` — 全ユーザー一覧（id, email, display_name, plan, auth_provider, created_at）
- `PATCH /api/admin/users/{user_id}` — プラン・表示名変更
- 認証: `require_auth()` + `ADMIN_EMAILS` 環境変数（Railway に設定済み）
- 非管理者には **404** を返す（存在を隠す）
- 有効プラン値: `free`, `pro_trial`, `pro`, `demo`

### `app/backend/routers/users.py`
- `GET /api/me` — ユーザー情報（`is_admin` フラグ含む）
- `PATCH /api/me` — 表示名更新

### Worker (`app/worker/src/index.ts`)
- `/api/*` を全てプロキシ（admin含む）
- CORS: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `X-User-Email` ヘッダーで認証（Cloudflare Access の get-identity から取得）
- `ALLOWED_ORIGIN` 環境変数で許可 Origin を制御 → **admin 用に追加が必要**

### 認証フロー
```
Cloudflare Access (ログイン)
    ↓
Frontend: /cdn-cgi/access/get-identity → email 取得
    ↓
API リクエスト: X-User-Email ヘッダー付与
    ↓
Worker: 信頼された Origin からのみ X-User-Email を転送
    ↓
Backend: require_auth() → users テーブルで email → UUID 解決
Backend: require_admin() → ADMIN_EMAILS と照合
```

## やること

### 1. Admin Frontend 作成
- 場所: `app/admin-frontend/` （新規 Next.js アプリ）
- 最小構成: ユーザー管理テーブル（プラン変更 Select 付き）
- 同じ Worker proxy 経由で API 呼び出し
- Bloomberg Terminal デザイン（`plumb-*` CSS）を踏襲

### 2. Cloudflare Pages プロジェクト作成
- プロジェクト名: `open-regime-admin`
- デプロイ: `npx wrangler pages deploy out --project-name=open-regime-admin`
- ドメイン: `open-regime-admin.pages.dev`（またはカスタムドメイン）

### 3. Worker の ALLOWED_ORIGIN 更新
- 現在: `ALLOWED_ORIGIN=https://open-regime.pages.dev`
- Admin からの API 呼び出しも許可する必要あり
- 方法: Worker の `buildAllowedOrigins()` を修正するか、環境変数を追加

### 4. Cloudflare Access 設定
- Zero Trust → Access → Applications で admin ドメインを追加
- ポリシー: 管理者メールのみ許可（二重認証: CF Access + Backend ADMIN_EMAILS）

## 重要ファイル

| ファイル | 内容 |
|---------|------|
| `app/backend/routers/admin.py` | Admin API エンドポイント |
| `app/backend/routers/users.py` | /api/me エンドポイント |
| `app/backend/auth.py` | 認証ロジック（require_auth, require_admin） |
| `app/backend/main.py` | ルーター登録 |
| `app/worker/src/index.ts` | Edge Proxy（CORS, キャッシュ, 認証ヘッダー転送） |
| `app/worker/wrangler.jsonc` | Worker 設定（ALLOWED_ORIGIN 等） |
| `app/frontend/src/app/settings/page.tsx` | 現在のアカウントページ（admin セクション含む） |
| `app/frontend/src/lib/api.ts` | API クライアント（UserProfile型, useAdminUsers等） |
| `app/frontend/src/components/shared/glass.tsx` | デザインシステム（GlassCard等） |

## DB: users テーブル

```sql
CREATE TABLE users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    stripe_customer_id TEXT,
    plan TEXT DEFAULT 'free',
    auth_provider TEXT DEFAULT 'cloudflare_access',
    auth_provider_id TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS有効、anon ポリシーなし（service_role のみ）
```

## 環境変数

| 変数 | 場所 | 値 |
|------|------|-----|
| `ADMIN_EMAILS` | Railway | 管理者メール（カンマ区切り） |
| `PROXY_SECRET` | Railway + Worker | Worker↔Backend 共有シークレット |
| `ALLOWED_ORIGIN` | Worker (wrangler.jsonc) | `https://open-regime.pages.dev` → admin も追加必要 |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Secrets | `c1a8026d00eb674a5d2750d6ef1527ba` |

## Admin Dashboard に将来追加すべき機能

| 機能 | 優先度 |
|------|--------|
| ユーザー一覧 + プラン変更 | 今回実装 |
| ユーザー数 / アクティブ数 KPI | 高 |
| 最終ログイン日時 | 高 |
| ユーザー無効化(BAN) | 中 |
| 招待リンク発行 | 中 |
| 利用ログ / 監査ログ | 低 |
| Stripe 連携（課金状況） | 低 |

## 注意事項
- ユーザーは初回ログイン時に自動作成される（auth.py の Gate パターン）
- アカウントページ (`/settings`) にも管理セクションがあるが、admin ダッシュボード完成後に削除予定
- Worker の `ALLOWED_ORIGIN` は現在単一値。admin 用に複数 Origin 対応が必要
