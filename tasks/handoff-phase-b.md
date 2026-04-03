# Phase B: フロントエンド認証フロー書き換え

## 背景

VPS Docker移行プロジェクトの最終ブロッカー。api-go の Google OAuth + JWT Cookie 認証は完成済み。
フロントエンドがまだ Supabase Auth SDK を使っているため、ログインできない。

**ゴール**: `docker compose up -d` → ブラウザで `http://localhost` → Google ログイン → ダッシュボード表示

---

## 現在の認証フロー（Supabase Auth）

```
ブラウザ → supabase.auth.signInWithOAuth({ provider: 'google' })
         → Supabase 経由で Google OAuth
         → implicit flow: URL hash にトークン
         → localStorage に保存
         → API 呼び出し時に Authorization: Bearer ヘッダー
         → 401 → supabase.auth.refreshSession() → リトライ
```

## 新しい認証フロー（api-go Cookie JWT）

```
ブラウザ → GET /api/auth/google (リダイレクト)
         → Google OAuth 同意画面
         → GET /api/auth/google/callback (api-go が処理)
         → HttpOnly Cookie 'token' にJWT設定
         → 302 → /auth/callback (フロントエンド)
         → GET /api/auth/me で認証確認
         → 全 API 呼び出しは Cookie 自動送信 (credentials: 'include')
         → 401 → POST /api/auth/refresh → リトライ or /login/ へリダイレクト
```

---

## api-go の認証 API 仕様

### エンドポイント

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| GET | `/api/auth/google` | 不要 | Google OAuth 開始（307 リダイレクト） |
| GET | `/api/auth/google/callback` | 不要 | OAuth コールバック（Cookie 設定 → 302 リダイレクト） |
| POST | `/api/auth/refresh` | Cookie | JWT リフレッシュ → `{"status": "refreshed"}` |
| POST | `/api/auth/logout` | 不要 | Cookie 削除 → `{"status": "logged_out"}` |
| GET | `/api/auth/me` | Cookie | ユーザー情報 → User JSON |

### Cookie 仕様

| 属性 | 値 |
|------|-----|
| Name | `token` |
| HttpOnly | true |
| Secure | production のみ true |
| SameSite | Lax |
| Path | `/` |
| MaxAge | 86400（24時間） |

### `/api/auth/me` レスポンス

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "display_name": "John Doe",
  "plan": "free",
  "auth_provider": "google",
  "is_active": true,
  "is_admin": false,
  "last_login_at": "2026-03-28T12:00:00Z",
  "created_at": "2026-03-01T10:00:00Z"
}
```

### エラーレスポンス（全エンドポイント共通）

```json
{"detail": "エラーメッセージ"}
```

### ユーザー作成/検索ロジック（api-go が自動処理）

1. `auth_provider_id`（Google のサブジェクトID）で検索
2. 見つからなければ `email` で検索（Supabase → Google 移行パス）→ 見つかれば `auth_provider_id` を更新
3. どちらもなければ新規ユーザー作成

→ **既存の Supabase ユーザーは初回 Google ログイン時に email マッチで自動移行される**

---

## 変更対象ファイル

### メインフロントエンド (`app/frontend/src/`)

#### 1. `lib/supabase.ts` — 削除

Supabase client は不要になる。ただし他の場所で import されているので、全参照を削除してから。

#### 2. `lib/auth-store.ts` — 大幅簡素化

**Before**: access token の get/set + リダイレクト防止フラグ
**After**: リダイレクト防止フラグのみ（Cookie ベースなのでトークン管理不要）

```typescript
// Cookie ベースなのでトークン管理は不要
// リダイレクト無限ループ防止のフラグのみ残す
let _isRedirecting = false;

export function isRedirecting(): boolean {
  return _isRedirecting;
}

export function markRedirecting(): void {
  _isRedirecting = true;
}
```

#### 3. `lib/api.ts` — Bearer → Cookie

**変更点:**
- `Authorization: Bearer ${token}` ヘッダー削除
- `credentials: 'include'` を全 fetch に追加（Cookie 自動送信）
- 401 リトライ: `supabase.auth.refreshSession()` → `POST /api/auth/refresh`
- リフレッシュ失敗時: `supabase.auth.signOut()` → `POST /api/auth/logout` + redirect

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  let response = await fetch(url, {
    ...options,
    credentials: 'include',  // Cookie 自動送信
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // 401 → リフレッシュして再試行
  if (response.status === 401) {
    const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshRes.ok) {
      // リフレッシュ成功 → 元のリクエストを再試行
      response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    }

    // まだ 401 → ログアウトしてログインページへ
    if (response.status === 401) {
      if (typeof window !== 'undefined' && !isRedirecting()) {
        markRedirecting();
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          credentials: 'include',
        });
        window.location.href = '/login/';
      }
      throw new Error('Session expired');
    }
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || body.message || JSON.stringify(body);
    } catch {}
    throw new Error(`API Error ${response.status}: ${detail}`);
  }

  return response.json();
}
```

#### 4. `lib/swr.tsx` — 同様の変更

`api.ts` と同じパターン。Bearer ヘッダー削除 + `credentials: 'include'` + リフレッシュロジック変更。

**変更点:**
- `getAccessToken()` / `setAccessToken()` の import 削除
- `supabase` の import 削除
- Bearer ヘッダー削除
- `credentials: 'include'` 追加
- 401 リトライ: `POST /api/auth/refresh` に変更

#### 5. `components/providers/UserProvider.tsx` — 全面書き換え

**Before**: `supabase.auth.getSession()` + `onAuthStateChange()` で認証状態管理
**After**: `GET /api/auth/me` で認証状態確認

```typescript
'use client';

import { createContext, useContext, useEffect, useState } from 'react';

interface User {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  is_admin: boolean;
}

interface UserContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
  refreshUser: async () => {},
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const signOut = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    setUser(null);
    window.location.href = '/login/';
  };

  const refreshUser = async () => {
    await fetchMe();
  };

  return (
    <UserContext.Provider value={{ user, loading, signOut, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}
```

#### 6. `app/login/page.tsx` — Google OAuth のみに簡素化

**Before**: メール/パスワード + Google OAuth（Supabase SDK）
**After**: Google OAuth のみ（api-go にリダイレクト）

```typescript
// Google ログインボタンのクリックハンドラー
const handleGoogleLogin = () => {
  window.location.href = '/api/auth/google';
};
```

- メール/パスワードフォームを削除（api-go は Google OAuth のみ対応）
- `supabase.auth.signInWithPassword()` 削除
- `supabase.auth.signInWithOAuth()` → `window.location.href = '/api/auth/google'`
- 認証済みチェック: `supabase.auth.getSession()` → `useUser()` の `user` を使う

#### 7. `app/register/page.tsx` — ログインページにリダイレクト or 統合

Google OAuth は登録とログインが同じフロー（初回ログイン時に自動作成）。
→ 登録ページは不要。`/register/` → `/login/` にリダイレクトするか、ログインページに「初めての方も Google でログイン」と表示。

#### 8. `app/auth/callback/page.tsx` — 簡素化

**Before**: Supabase implicit flow のハッシュ処理 + `exchangeCodeForSession`
**After**: `/api/auth/me` で認証確認してリダイレクト

api-go の GoogleCallback が `/auth/callback` にリダイレクトする時点で Cookie は既にセットされている。
→ `/api/auth/me` を呼んで成功すればダッシュボードへ、失敗すればログインへ。

```typescript
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
          router.replace('/');
        } else {
          router.replace('/login/');
        }
      } catch {
        router.replace('/login/');
      }
    };
    checkAuth();
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p>認証中...</p>
    </div>
  );
}
```

#### 9. 削除するページ

以下は Supabase Auth 固有の機能で、Google OAuth では不要:

- `app/reset-password/page.tsx` — パスワードリセット
- `app/update-password/page.tsx` — パスワード更新
- `app/auth/verify/page.tsx` — メール確認

これらのページへのリンクがある箇所も削除・更新する。

#### 10. `app/settings/page.tsx` — テキスト更新

- "Supabase Auth 認証" → "Google 認証" に変更
- `useUser().signOut` はそのまま使える（UserProvider が新しい signOut を提供）

#### 11. `components/layout/UserMenu.tsx` — 変更なし

`useUser().signOut()` を使っているので、UserProvider の変更で自動的に新しい signOut が使われる。

#### 12. `components/providers/AuthGuard.tsx` — 微修正

`useUser()` を使っているので、UserProvider の変更で自動的に動く。
ただし `loading` 状態の間はリダイレクトしないことを確認。

#### 13. `package.json` — Supabase SDK 削除

```bash
npm uninstall @supabase/supabase-js
```

---

### 管理フロントエンド (`app/admin-frontend/src/`)

#### 現状

Cloudflare Access (`/cdn-cgi/access/get-identity`) + `X-User-Email` ヘッダーで認証。
Docker 環境では CF Access がないので、api-go の Cookie JWT に切り替える。

#### 変更対象

| ファイル | 変更内容 |
|---------|---------|
| `components/providers/UserProvider.tsx` | CF Access → `GET /api/auth/me` |
| `lib/auth-store.ts` | email store → 不要（UserProvider から取得） |
| `lib/api.ts` | `X-User-Email` ヘッダー → `credentials: 'include'` |
| `lib/swr.tsx` | 同上 |
| `app/page.tsx` | ログアウト: CF Access → `POST /api/auth/logout` |

#### UserProvider の変更

```typescript
// Before: Cloudflare Access
const res = await fetch('/cdn-cgi/access/get-identity');
const identity = await res.json();
setEmail(identity.email);

// After: api-go Cookie JWT
const res = await fetch('/api/auth/me', { credentials: 'include' });
const user = await res.json();
// user.is_admin で管理者チェック
```

#### api.ts の変更

```typescript
// Before:
headers: {
  'X-User-Email': getAuthEmail() || '',
  'X-MFA-Token': getMfaToken() || '',
}

// After:
credentials: 'include',
headers: {
  'X-MFA-Token': getMfaToken() || '',  // MFA は維持
}
```

#### ログインフロー

admin-frontend には独自のログインページはない。
api-go の `is_admin` フラグ（`ADMIN_EMAILS` に含まれるかで判定）で管理者かどうかを確認。
未認証 or 非管理者の場合は `/api/auth/google` にリダイレクト。

---

## api-go 側の修正が必要（Phase B の前提条件）

### ⚠️ RefreshToken が期限切れ JWT を拒否する問題

`api-go/internal/handler/auth.go:154` の `RefreshToken` ハンドラーが `ValidateJWT()` を呼んでいるが、`jwt.ParseWithClaims` はデフォルトで expiry チェックする。

**問題**: JWT が期限切れ（24時間経過）→ フロントエンドが `POST /api/auth/refresh` → `ValidateJWT()` が `token expired` エラー → 401 → **ユーザーは24時間ごとに必ず再ログインさせられる**

**修正**: `RefreshToken` ハンドラーで期限切れを許容する。方法は2つ:

**方法A**: リフレッシュ専用のバリデーション関数を追加（推奨）

```go
// auth_service.go に追加
func (s *AuthService) ValidateJWTForRefresh(tokenStr string) (*Claims, error) {
    parser := jwt.NewParser(
        jwt.WithValidMethods([]string{"HS256"}),
        jwt.WithoutClaimsValidation(), // expiry チェックをスキップ
    )
    token, err := parser.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
        return s.jwtSecret, nil
    })
    if err != nil {
        return nil, fmt.Errorf("invalid token: %w", err)
    }
    claims, ok := token.Claims.(*Claims)
    if !ok {
        return nil, fmt.Errorf("invalid token claims")
    }
    // 署名は検証済み。期限切れでも猶予期間内（例: 7日）なら許可
    if time.Since(claims.ExpiresAt.Time) > 7*24*time.Hour {
        return nil, fmt.Errorf("token too old for refresh")
    }
    return claims, nil
}
```

```go
// auth.go の RefreshToken を修正
claims, err := h.authSvc.ValidateJWTForRefresh(cookie.Value) // ← ValidateJWT → ValidateJWTForRefresh
```

**方法B**: `jwt.ParseWithClaims` に `jwt.WithLeeway()` で猶予を追加

```go
parser := jwt.NewParser(jwt.WithLeeway(7 * 24 * time.Hour))
```

→ **この修正は Phase B 実装前に api-go 側で行うこと。**

---

## 注意事項

### 1. `credentials: 'include'` は必須

Cookie JWT なので、全ての fetch/axios に `credentials: 'include'` が必要。
これがないと Cookie が送信されず、認証が通らない。

### 2. CORS 設定

api-go の CORS は開発環境で `http://localhost:3000` と `http://localhost` を許可済み。
`credentials: 'include'` の場合、`Access-Control-Allow-Credentials: true` が必要（設定済み）。

### 3. Google OAuth の Client ID / Secret

`docker compose` の環境変数で設定が必要:
```yaml
api-go:
  environment:
    - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
    - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
    - GOOGLE_REDIRECT_URL=http://localhost/api/auth/google/callback
    - FRONTEND_URL=http://localhost
```

Google Cloud Console で OAuth 2.0 クライアントを作成し、リダイレクト URI に `http://localhost/api/auth/google/callback` を追加する必要がある。

**既存の Google OAuth 設定（Supabase 用）がある場合**: リダイレクト URI を追加するだけでよい。Client ID / Secret は同じものが使える。

### 4. 複数リクエスト同時401時のリフレッシュ競合（将来改善）

SWR はページロード時に複数 API リクエストを同時発行する。全部 401 になると全部が `POST /api/auth/refresh` を叩く。Cookie JWT の場合は各リフレッシュが独立して新しい Cookie を設定するだけなので**実害は小さい**が、無駄なリクエストが発生する。

将来的にはリフレッシュの mutex（1つだけリフレッシュして他は待つ）を `swr.tsx` / `api.ts` に入れるとクリーン:

```typescript
let refreshPromise: Promise<boolean> | null = null;

async function refreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(res => res.ok)
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}
```

**Phase B では未対応で問題なし。** 機能的に壊れることはない。

### 5. SWR のグローバル fetcher

`swr.tsx` の `SWRProvider` が全コンポーネントに fetcher を提供している。
ここを `credentials: 'include'` に変更すれば、個別のコンポーネントは変更不要。

### 5. 既存ユーザーの移行

api-go は初回 Google ログイン時に email で既存ユーザーを検索し、`auth_provider_id` を Supabase Auth UUID から Google のサブジェクトIDに自動更新する。
→ 既存データ（holdings, trades 等）は `user_id`（UUID）で紐付いているので影響なし。

### 6. admin-frontend の nginx ルーティング

admin-frontend のアクセス経路がまだ未設定（upstream 定義のみ）。
Phase B のスコープ外だが、テストするなら一時的に:
```nginx
location /admin/ {
    proxy_pass http://admin_frontend;
    ...
}
```
を追加するか、`docker compose exec admin-frontend curl localhost:3002` で直接テスト。

---

## 動作確認手順

### 1. Google OAuth テスト

```
1. docker compose up -d --build
2. ブラウザで http://localhost にアクセス
3. ログインページが表示される
4. "Google でログイン" をクリック
5. Google 認証画面 → 同意
6. /auth/callback にリダイレクト
7. ダッシュボードが表示される
```

### 2. Cookie 確認

ブラウザの開発者ツール → Application → Cookies → `http://localhost`:
- `token` Cookie が存在すること
- HttpOnly: true
- Path: /

### 3. 認証付き API テスト

```
1. ログイン後、Holdings ページにアクセス
2. 保有銘柄一覧が表示される（DB にデータがあれば）
3. 銘柄を追加・編集・削除できる
```

### 4. ログアウトテスト

```
1. ユーザーメニュー → ログアウト
2. Cookie が削除される
3. /login/ にリダイレクトされる
4. 保護ページにアクセス → /login/ にリダイレクト
```

### 5. セッション切れテスト

```
1. ログイン後、開発者ツールで token Cookie を削除
2. 保護ページにアクセス
3. 401 → リフレッシュ失敗 → /login/ にリダイレクト
```

---

## 変更ファイル一覧

### メインフロントエンド

| ファイル | 操作 |
|---------|------|
| `app/frontend/src/lib/supabase.ts` | 削除 |
| `app/frontend/src/lib/auth-store.ts` | 簡素化（トークン管理削除） |
| `app/frontend/src/lib/api.ts` | Bearer → Cookie (`credentials: 'include'`) |
| `app/frontend/src/lib/swr.tsx` | 同上 |
| `app/frontend/src/components/providers/UserProvider.tsx` | 全面書き換え |
| `app/frontend/src/components/providers/AuthGuard.tsx` | 微修正（確認のみ） |
| `app/frontend/src/app/login/page.tsx` | Google OAuth のみに簡素化 |
| `app/frontend/src/app/register/page.tsx` | 削除 or リダイレクト |
| `app/frontend/src/app/auth/callback/page.tsx` | 簡素化 |
| `app/frontend/src/app/reset-password/page.tsx` | 削除 |
| `app/frontend/src/app/update-password/page.tsx` | 削除 |
| `app/frontend/src/app/auth/verify/page.tsx` | 削除 |
| `app/frontend/src/app/settings/page.tsx` | テキスト変更 |
| `app/frontend/package.json` | `@supabase/supabase-js` 削除 |

### 管理フロントエンド

| ファイル | 操作 |
|---------|------|
| `app/admin-frontend/src/components/providers/UserProvider.tsx` | CF Access → Cookie JWT |
| `app/admin-frontend/src/lib/auth-store.ts` | 簡素化 or 削除 |
| `app/admin-frontend/src/lib/api.ts` | `X-User-Email` → `credentials: 'include'` |
| `app/admin-frontend/src/lib/swr.tsx` | 同上 |
| `app/admin-frontend/src/app/page.tsx` | ログアウト URL 変更 |
| `app/admin-frontend/package.json` | `@supabase/supabase-js` 削除（入っていれば） |
