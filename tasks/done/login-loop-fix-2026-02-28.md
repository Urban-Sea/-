# Open Regime: ログインループ修正 (2026-02-28)

## 発生した問題

ログイン後、**ポートフォリオ**・**銘柄分析**タブをクリックするとログイン画面に戻されるループが発生。
ダッシュボード・流動性・雇用統計ページは正常に動作。

セキュリティ強化コミット `ab66329` 以降に発生。

## 原因分析

### 認証方式の違い

| ページ | 認証方式 | エラー時 | 状態 |
|--------|----------|----------|------|
| ダッシュボード / 流動性 / 雇用 | `require_proxy` (X-Proxy-Secret) | 403 | 正常 |
| ポートフォリオ / 銘柄分析 | `require_auth` (JWT Bearer) | 401 | ループ |

### 根本原因: ES256 vs HS256

SupabaseのJWTは **ES256 (ECDSA)** で署名されているが、バックエンドの `require_auth` は **HS256 (HMAC)** のみで検証しようとしていた。

- JWTヘッダーの `alg` = `"ES256"`
- バックエンドの `algorithms=["HS256"]` → `InvalidAlgorithmError` → 401
- フロントエンドが401を受信 → `signOut()` → `/login/` リダイレクト → ループ

`SUPABASE_JWT_SECRET` はHMAC用のシークレットであり、ES256のJWTには使えない。
ES256にはJWKS公開鍵（`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`）が必要。

## 修正内容

### Fix 1: ES256 JWKS公開鍵検証 (commit `95fc3f9`)

**ファイル**: `app/backend/auth.py`

`PyJWKClient` を使い、JWTのアルゴリズムに応じて検証方式を切り替え:

- ES/RS/PS → JWKS公開鍵で検証（`PyJWKClient` + 1時間キャッシュ）
- HS → HMAC シークレットで検証（フォールバック）

```python
from jwt import PyJWKClient

_jwks_client: PyJWKClient | None = None
if _SUPABASE_URL:
    _jwks_client = PyJWKClient(
        f"{_SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        cache_keys=True,
        lifespan=3600,
    )
```

### Fix 2: 401リダイレクトループ防止 (commit `eca0cec`)

**ファイル**: `app/frontend/src/lib/auth-store.ts`, `swr.tsx`, `api.ts`

モジュールレベルの `_isRedirecting` フラグで無限ループを防止:

- 1回目の401 → signOut + リダイレクト（通常通り）
- 2回目以降 → フラグがtrueなのでスキップ
- ログイン成功（`setAccessToken`）でフラグをリセット

### Fix 3: email_confirmed_at を警告のみに (commit `b75aada`)

**ファイル**: `app/backend/auth.py`

`email_confirmed_at` がJWTに含まれない場合、以前は403を返していたが、警告ログのみに変更。

### Fix 4: JWT診断エンドポイント (commit `eca0cec`)

**ファイル**: `app/backend/main.py`

`GET /api/auth/check` — JWT検証の各ステップを可視化する診断用エンドポイント（認証不要）:

- トークンの存在・デコード
- アルゴリズム検出（ES256/HS256）
- 署名検証（JWKS or HMAC）
- issuer / audience / email_confirmed_at チェック

### Fix 5: favicon.ico 再生成 (commit `bc4b620`)

**ファイル**: `app/frontend/src/app/favicon.ico`

`public/icon.png` の青いXロゴから 16/32/48px の favicon.ico を再生成。
以前の favicon.ico（722 bytes, 16x16, 別アイコン）を正しいものに置き換え。

## アーキテクチャ

```
Browser → Cloudflare Pages (Frontend/Next.js)
              ↓ API calls
       Cloudflare Worker (Proxy)
          - adds X-Proxy-Secret header
          - forwards Authorization header
              ↓
       Railway (Backend/FastAPI)
          - require_proxy: X-Proxy-Secret検証 → 403
          - require_auth: JWT Bearer検証 → 401
              ↓
          Supabase (DB + Auth)
```

## コミット一覧

| コミット | 内容 |
|----------|------|
| `eca0cec` | ループ防止ガード + 診断エンドポイント + エラーログ強化 |
| `b75aada` | HS384/HS512許可 + email_confirmed_at警告のみ |
| `95fc3f9` | ES256 JWKS公開鍵検証（根本修正） |
| `bc4b620` | favicon.ico を青アイコンから再生成 |

## 学んだこと

1. **SupabaseのJWTはES256がデフォルト** — `SUPABASE_JWT_SECRET` はHMAC用。ES256にはJWKS公開鍵が必要。
2. **401自動リダイレクトにはサーキットブレーカーが必須** — JWTが壊れていると無限ループになる。
3. **JWT検証前に `alg` ヘッダーを確認** — アルゴリズムを仮定せず、ヘッダーに応じて検証戦略を選ぶ。
