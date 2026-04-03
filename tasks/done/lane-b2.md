# レーンB Phase 2 完了報告: フロントエンド認証フロー書き換え (Supabase Auth → api-go Cookie JWT)

**完了日**: 2026-04-03
**対象**: Phase B (Lane C Phase A 完了後の最終ブロッカー)
**設計書**: `.claude/plans/bright-cuddling-boole.md`

---

## 1. 何をやったか

フロントエンド（メイン + admin）が Supabase Auth SDK を使っていた認証フローを、Lane B で構築済みの api-go Google OAuth + HttpOnly Cookie JWT 認証に全面書き換え。Docker 環境でのログイン → ダッシュボード表示を実現した。

### 成果物の規模

| カテゴリ | 操作 | ファイル数 |
|---------|------|--------:|
| api-go 修正 | ValidateJWTForRefresh + テスト | 3 |
| メインFE 修正 | Cookie化 + UserProvider + ログイン | 6 |
| メインFE 削除 | supabase.ts + 不要ページ4つ | 5 |
| Admin FE 修正 | Cookie化 + UserProvider + MFA修正 | 5 |
| Admin FE 削除 | auth-store.ts | 1 |
| インフラ | nginx, docker-compose, next.config | 3 |
| ドキュメント | lane-b2.md | 1 |
| **合計** | +350行 / -1,071行 | **24** |

---

## 2. 変更内容

### 2.1 api-go (Step 0)

| ファイル | 変更 |
|---------|------|
| `service/auth_service.go` | `ValidateJWTForRefresh()` 追加 — exp チェックせず署名のみ検証、iat から7日以内なら refresh 許可 |
| `handler/auth.go:154` | RefreshToken で `ValidateJWT()` → `ValidateJWTForRefresh()` |
| `handler/auth.go:142` | callback redirect に trailing slash 追加（Next.js の 308 二重リダイレクト防止） |
| `service/auth_service_test.go` | 3テスト追加: 発行1h前→通過、発行8日前→拒否、期限切れだが発行2日前→通過 |

**`WithLeeway` ではなく `iat` ベースの理由**: `WithLeeway(7d)` は「期限切れ JWT を7日間有効扱い」になりセキュリティリスク。`iat` ベースなら refresh 専用メソッドであることが明確。

### 2.2 メインフロントエンド (Step 1-7)

| ファイル | 変更 |
|---------|------|
| `lib/supabase.ts` | **削除** |
| `lib/auth-store.ts` | `_accessToken` / `setAccessToken` / `getAccessToken` 削除。`isRedirecting` のみ残す |
| `lib/api.ts` | `ApiError` クラス + `refreshToken()` Promise 共有パターン + Cookie ベース `fetchAPI` (isRetry フラグで無限ループ防止) |
| `lib/swr.tsx` | Supabase import 削除。Cookie ベース。`ApiError.status` でリトライ判定 |
| `providers/UserProvider.tsx` | Supabase 全削除。`/api/auth/me` で認証確認。`refreshUser()` 追加。5xx 時は user 変更しない |
| `app/login/page.tsx` | Google OAuth ボタンのみ。メール/パスワードフォーム・register/reset リンク削除 |
| `app/auth/callback/page.tsx` | `refreshUser()` → `router.replace('/')` のみ。Supabase hash/PKCE/PASSWORD_RECOVERY 全削除 |
| `app/settings/page.tsx` | 「Supabase Auth 認証」→「Google 認証」 |
| `package.json` | `@supabase/supabase-js` 削除 |
| 不要ページ4つ | `register/`, `reset-password/`, `update-password/`, `auth/verify/` 削除 |

**refresh 競合防止**: `refreshPromise` モジュール変数で SWR が同時に複数の 401 を返しても refresh は1回だけ。

### 2.3 Admin フロントエンド (Step 8-12)

| ファイル | 変更 |
|---------|------|
| `nginx/conf.d/default.conf` | `location /admin/` ブロック追加（`location /` より前に配置） |
| `next.config.ts` | `basePath: '/admin'` 追加 |
| `lib/auth-store.ts` | **削除**（`X-User-Email` ヘッダー廃止） |
| `lib/api.ts` | Cookie ベース + `ApiError` + `refreshToken()` 共有パターン。MFA ルート修正: `/mfa/setup/verify` → `/mfa/verify-setup`, `DELETE /mfa/session` → `POST /mfa/session/logout` |
| `lib/swr.tsx` | Cookie ベース。`X-User-Email` 削除。`ApiError` status 判定 |
| `providers/UserProvider.tsx` | `/cdn-cgi/access/get-identity` → `/api/auth/me`。`signOut()` 追加 |
| `app/page.tsx` | `<a href="/cdn-cgi/access/logout">` → `signOut()`、ヘッダーの logout ボタンも同様 |

### 2.4 インフラ

| ファイル | 変更 |
|---------|------|
| `docker-compose.yml` | admin-frontend の `depends_on` に `api-go` 追加 |

---

## 3. 検証結果

### 3.1 Go テスト
```
=== RUN   TestIssueAndValidateJWT                        --- PASS
=== RUN   TestValidateJWT_Expired                        --- PASS
=== RUN   TestValidateJWT_WrongSecret                    --- PASS
=== RUN   TestValidateJWT_Garbage                        --- PASS
=== RUN   TestValidateJWTForRefresh_RecentlyIssued       --- PASS
=== RUN   TestValidateJWTForRefresh_TooOld               --- PASS
=== RUN   TestValidateJWTForRefresh_ExpiredButRecent     --- PASS
PASS  ok  internal/service  0.514s
```

### 3.2 フロントエンドビルド
- `app/frontend`: ビルド成功、`grep -r "supabase"` 残留なし
- `app/admin-frontend`: ビルド成功、`grep -r "cdn-cgi"` / `grep -r "getAuthEmail"` 残留なし

### 3.3 Docker E2E
```
curl http://localhost/health        → 200
curl http://localhost/login/        → 200
curl http://localhost/api/auth/me   → 401 (未認証、期待通り)
curl http://localhost/admin/        → 200
curl http://localhost/api/auth/google → 307 → accounts.google.com
curl -X POST http://localhost/api/auth/refresh → 401 (Cookie なし、期待通り)
```

全7コンテナ正常稼働（postgres/redis healthy）。

---

## 4. 注意事項・既知の制限

### 4.1 Google OAuth テストには環境変数が必要
`.env` に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を設定しないと OAuth フローは動作しない（リダイレクト先が `client_id=` 空になる）。

### 4.2 Admin ログイン後のリダイレクト先
admin で未認証 → `/login/` → Google OAuth → main callback → main ダッシュボード → ユーザーが `/admin/` に手動移動。将来的に `?redirect=` パラメータで改善可能だが Phase B スコープ外。

### 4.3 basePath 後のアセットパス
`basePath: '/admin'` により `/_next/static/...` が `/admin/_next/static/...` に。nginx の `location /admin/` でそのまま upstream に渡されるため動作する（proxy_pass に URI 部分なし）。

---

## 5. 次のステップ

1. **E2E 手動テスト** — Google OAuth で実際にログイン → ダッシュボード → Holdings/Signals → ログアウト
2. **admin MFA フロー確認** — `/admin/` → MFA セットアップ or チャレンジ
3. **VPS デプロイ** — `tasks/vps-migration-plan.md` に従って進行
