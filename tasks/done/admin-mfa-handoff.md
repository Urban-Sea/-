# Admin TOTP MFA 実装 — 引き継ぎドキュメント

## 概要

admin ダッシュボード (open-regime-admin) に TOTP (Google Authenticator) による多要素認証を追加する。

## 現在の認証フロー

1. **Cloudflare Access** (OAuth) がサイト全体を保護（第1要素）
2. Frontend が `/cdn-cgi/access/get-identity` からユーザーメールを取得
3. 全 API コールは Cloudflare Worker プロキシ経由（`X-User-Email` + `X-Proxy-Secret` ヘッダー付与）
4. Backend (FastAPI) が両ヘッダーを検証、`ADMIN_EMAILS` 環境変数でアクセス制御

## 追加する認証（第2要素: TOTP）

- 初回: QR コード表示 → Authenticator アプリでスキャン → 6桁コードで確認
- 以降: 6桁コード入力（24時間セッション維持、localStorage + DB ハッシュ）

## 実装プラン

詳細プランファイル: `.claude/plans/drifting-napping-snowglobe.md`

### 新規ファイル (6個)

| ファイル | 説明 |
|---|---|
| `app/batch/sql/setup_mfa.sql` | DB マイグレーション（admin_mfa + admin_mfa_sessions テーブル） |
| `app/backend/routers/admin_mfa.py` | MFA API エンドポイント（status, setup, verify, session） |
| `app/admin-frontend/src/lib/mfa-store.ts` | MFA トークン localStorage 管理 |
| `app/admin-frontend/src/components/mfa/MfaGate.tsx` | MFA ゲートラッパー（loading→setup/challenge/authenticated） |
| `app/admin-frontend/src/components/mfa/MfaSetup.tsx` | QR コード表示 + セットアップ検証 UI |
| `app/admin-frontend/src/components/mfa/MfaChallenge.tsx` | TOTP コード入力 UI |

### 変更ファイル (7個)

| ファイル | 変更内容 |
|---|---|
| `app/backend/requirements.txt` | `pyotp==2.9.0`, `qrcode[pil]==8.0` 追加 |
| `app/backend/main.py` | MFA ルーター登録 + CORS に `X-MFA-Token` 追加 |
| `app/backend/routers/admin.py` | `require_admin_mfa` 依存追加、全エンドポイント切替 |
| `app/worker/src/index.ts` | `X-MFA-Token` ヘッダー転送 + CORS 追加 |
| `app/admin-frontend/src/lib/api.ts` | `X-MFA-Token` ヘッダー付与 + MFA API 関数追加 |
| `app/admin-frontend/src/lib/swr.tsx` | SWR fetcher に `X-MFA-Token` 追加 |
| `app/admin-frontend/src/app/page.tsx` | ダッシュボードを `<MfaGate>` で囲む |

### API エンドポイント

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/api/admin/mfa/status` | require_admin | MFA 設定状態 |
| POST | `/api/admin/mfa/setup` | require_admin | シークレット生成 + QR コード |
| POST | `/api/admin/mfa/setup/verify` | require_admin | セットアップ確認 → トークン発行 |
| POST | `/api/admin/mfa/verify` | require_admin | ログイン時 TOTP 検証 → トークン発行 |
| GET | `/api/admin/mfa/session` | require_admin | セッショントークン検証 |

### セキュリティ設計

- トークン: `secrets.token_hex(32)` (256bit)、SHA-256 ハッシュを DB 保存
- TOTP: `pyotp.TOTP.verify(code, valid_window=1)` (±30秒許容)
- `admin_mfa` テーブル: RLS ポリシーなし（service_role のみアクセス可）
- Worker: 信頼された Origin からのみ `X-MFA-Token` を転送

### 実装順序

1. DB マイグレーション → 2. Backend 依存追加 → 3. MFA エンドポイント → 4. 既存エンドポイント保護 → 5. CORS + Worker → 6. Frontend トークン管理 → 7. MFA UI → 8. 統合 → 9. テスト

## 直近完了した作業（このセッション）

- [x] admin ヘッダー: "Open Regime" + オレンジバッジ → "Open Regime Admin"
- [x] admin favicon/icon: 角丸を画像に焼き込み（透過PNG）
- [x] open-regime settings: ユーザー管理セクション削除（admin に移行済み）
- [x] setup_admin.sql: ユーザーが Supabase で実行済み（batch_logs 等のテーブル作成）
- [x] commit & push 済み (`868fb4a`)
