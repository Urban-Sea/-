# Open Regime SaaS 化 — 詳細移行ドキュメント

> 対象スタック: FastAPI (Railway) + Next.js (Cloudflare Pages) + Supabase PostgreSQL + Cloudflare Workers + Cloudflare Access
> 作成日: 2026-02-26 / 更新日: 2026-02-28

---

## 0. 現状のアーキテクチャ

### インフラ構成

| レイヤー | サービス | 役割 |
|---------|---------|------|
| CDN/エッジ | Cloudflare Pages | フロントエンド配信 (Next.js SSG) |
| 認証（一般） | Supabase Auth | Email/Password + Google OAuth (Implicit flow) |
| 認証（管理者） | Cloudflare Access + TOTP MFA | 3層認証 |
| API プロキシ | Cloudflare Workers | CORS, エッジキャッシュ, ヘッダー転送 |
| バックエンド | Railway (FastAPI) | API サーバー |
| データベース | Supabase PostgreSQL | ユーザーデータ, 市場データ |
| 管理画面 | Cloudflare Pages (別プロジェクト) | Admin ダッシュボード |

### 現在の認証フロー（一般ユーザー）

```
ユーザー → Cloudflare Access (Google OAuth)
  → /cdn-cgi/access/get-identity → email 取得
  → Frontend が X-User-Email ヘッダーで API 呼び出し
  → Worker が信頼 Origin チェック後 Backend に転送
  → Backend (auth.py) が email → users テーブル UUID 解決
```

- `app/frontend/src/components/providers/UserProvider.tsx` — CF Access get-identity で email 取得
- `app/frontend/src/lib/auth-store.ts` — モジュールレベル変数で email 保持
- `app/frontend/src/lib/api.ts` — 全 API に `X-User-Email` ヘッダー付与
- `app/worker/src/index.ts` — 信頼 Origin のみ `X-User-Email` 転送 + `X-Proxy-Secret` 付与
- `app/backend/auth.py` — `X-User-Email` + `X-Proxy-Secret` 検証、email → UUID 解決、初回自動登録

### 現在の管理者認証（3 層）

```
Admin → Cloudflare Access → ADMIN_EMAILS 環境変数チェック → TOTP MFA
```

- `app/backend/routers/admin.py` — `require_admin` (CF Access + ADMIN_EMAILS), `require_admin_mfa` (+ TOTP)
- `app/admin-frontend/` — MfaGate, MfaChallenge, MfaSetup コンポーネント

### SaaS 化の障壁

**Cloudflare Access が全アクセスをブロック** → 許可リストにないユーザーはログイン画面すら表示されない → 新規登録不可能

---

## Phase 1: 認証基盤の移行 [✅ 完了 2026-02-28]

### 方針: Supabase Auth への移行

既に Supabase を DB として使用中。Supabase Auth を採用する理由:

- 新しいベンダー導入不要（既存 Supabase プロジェクトに Auth を有効化するだけ）
- Email/Password + Google OAuth が標準装備
- JWT トークンベースの認証（PyJWT でバックエンド検証）
- パスワードリセット、メール確認、メールテンプレートが内蔵
- Admin ダッシュボードは **Cloudflare Access + MFA を維持（変更なし）**
- Cloudflare CDN (Pages + Workers) もそのまま継続

### 1.1 Supabase 側の設定 ✅

- Supabase ダッシュボード → Authentication → Providers で有効化:
  - **Email/Password**: ON（メール確認有効）✅
  - **Google OAuth**: ON ✅
    - Google Cloud Console で OAuth クライアント作成（名前: SupabaseAccess）
    - Authorized JavaScript origins: `https://open-regime.pages.dev`
    - Authorized redirect URI: `https://xndbmsrscozqyksstzop.supabase.co/auth/v1/callback`
    - Skip nonce checks: OFF / Allow users without email: OFF
- Authentication → URL Configuration: ✅
  - Site URL: `https://open-regime.pages.dev`
  - Redirect URLs: `https://open-regime.pages.dev/auth/callback`
- Authentication → Email Templates: 日本語カスタマイズ（未実施）

### 1.2 DB マイグレーション

```sql
-- users テーブルに Supabase Auth ID を追加
ALTER TABLE users ADD COLUMN supabase_auth_id UUID UNIQUE;
CREATE INDEX idx_users_supabase_auth ON users(supabase_auth_id);
```

既存ユーザー（CF Access 時代）は email で自動リンク:
- Supabase Auth でログイン → JWT から email 取得 → users テーブル検索 → `supabase_auth_id` を紐付け → 既存データ保持

### 1.3 Backend 変更

**`app/backend/auth.py`** — 書き換え:

```python
# 新しい認証フロー
# 1. Authorization: Bearer <JWT> ヘッダーを受け付け
# 2. SUPABASE_JWT_SECRET で署名検証 (PyJWT)
# 3. JWT の email + sub クレームからユーザー解決
# 4. 移行期間中は X-User-Email も並行サポート（後で削除）
```

変更点:
- `require_auth()` が `Authorization: Bearer` ヘッダーを優先
- JWT 検証: `jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated")`
- JWT の `sub` (Supabase Auth UID) と `email` でユーザー解決
- 既存の `X-User-Email` は移行期間中のフォールバック
- 依存追加: `PyJWT>=2.8.0` (`app/backend/requirements.txt`)

**`app/backend/main.py`**:
- CORS `allow_headers` に `Authorization` 追加（既に `X-User-Email`, `X-MFA-Token` あり）

### 1.4 Worker 変更

**`app/worker/src/index.ts`**:

```typescript
// 変更: Authorization ヘッダーも Backend に転送
const authHeader = request.headers.get('Authorization');
if (isTrustedOrigin && authHeader) {
  proxyHeaders.set('Authorization', authHeader);
}

// CORS に Authorization 追加（既に設定済み: Content-Type, Authorization, X-User-Email, X-MFA-Token）

// キャッシュキーを email → JWT sub に変更（per-user エンドポイント用）
```

### 1.5 Frontend 変更 ✅

**新規依存**: `@supabase/supabase-js`

**認証フロー**: `flowType: 'implicit'`（PKCE は静的エクスポートでメール確認時に code verifier が消失するため不採用）

**新規ファイル**:
| ファイル | 役割 |
|---------|------|
| `app/frontend/src/lib/supabase.ts` | Supabase クライアント初期化（implicit flow, SSG用プレースホルダーフォールバック付き） |
| `app/frontend/src/app/login/page.tsx` | ログインページ (Email/Password + Google OAuth + パスワード表示トグル) |
| `app/frontend/src/app/register/page.tsx` | 新規登録ページ（パスワード要件5項目リアルタイムチェック + 確認入力 + 利用規約同意） |
| `app/frontend/src/app/reset-password/page.tsx` | パスワードリセット |
| `app/frontend/src/app/auth/callback/page.tsx` | Implicit flow ハッシュフラグメント処理 + PKCE フォールバック |
| `app/frontend/src/app/auth/verify/page.tsx` | メール確認待ち画面 + 再送ボタン |
| `app/frontend/src/components/providers/AuthGuard.tsx` | 保護ページラッパー（未認証→/login リダイレクト） |

**変更ファイル**:
| ファイル | 変更内容 |
|---------|---------|
| `UserProvider.tsx` | CF Access get-identity → Supabase Auth セッション監視 (`onAuthStateChange`) |
| `auth-store.ts` | email 保持 → accessToken 保持に変更 |
| `api.ts` (frontend) | `X-User-Email` → `Authorization: Bearer <accessToken>` |
| `swr.tsx` | 同上 (swrFetcher の headers) |
| `UserMenu.tsx` | ログアウト: `supabase.auth.signOut()` に変更 |
| `settings/page.tsx` | ログアウトリンク変更、「Supabase Auth 認証」に表記更新 |
| `Header.tsx` | 未認証: ホームのみ + ログインボタン / 認証済み: フルナビ + UserMenu。GlossaryButton は認証済みのみ表示 |
| `page.tsx` (ランディング) | 認証状態対応 CTA、機能カードリンク先の出し分け |
| 保護ページ6つ | `dashboard`, `liquidity`, `employment`, `signals`, `holdings`, `settings` に AuthGuard ラッパー追加 |

### 1.6 既存ユーザーの自動移行

1. ユーザーが Supabase Auth でログイン（Google OAuth or Email）
2. JWT から `email` 取得
3. `users` テーブルに同じ email が存在 → `supabase_auth_id` を紐付け
4. 既存データ（holdings, trades, watchlist 等）はそのまま参照可能

CF Access 時代に Google OAuth で登録済みのユーザーは、同じ Google アカウントで Supabase Auth にログインすれば自動でデータが引き継がれる。

### 1.7 デプロイ手順（ゼロダウンタイム）

1. **Backend デプロイ** — JWT + レガシー `X-User-Email` 両方対応
2. **Worker デプロイ** — `Authorization` ヘッダー転送追加
3. **Frontend デプロイ** — Supabase Auth 対応（プレビュー URL でテスト）
4. **動作確認** — 新規登録 → ログイン → API アクセス → データ保存 → ログアウト → 再ログイン
5. **既存ユーザーテスト** — CF Access 時代のメールで Supabase Auth ログイン → 既存データ参照可能か確認
6. **Cloudflare Access を open-regime.pages.dev から削除**（Admin は維持）
7. **安定確認後** — レガシー `X-User-Email` サポートを Backend から削除

### 1.8 環境変数（追加分） ✅

| 場所 | 変数 | 用途 | 設定先 |
|------|------|------|--------|
| Railway | `SUPABASE_JWT_SECRET` | JWT 署名検証（Legacy JWT secret） | Railway 環境変数 |
| GitHub Actions | `SUPABASE_URL` → `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL | GitHub Secrets → deploy.yml build env |
| GitHub Actions | `SUPABASE_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 公開 anon key | GitHub Secrets → deploy.yml build env |

**重要**: CF Pages ダッシュボードの環境変数は GitHub Actions + `wrangler pages deploy` 方式では**ビルド時に使用されない**。`NEXT_PUBLIC_*` 変数は Next.js のビルド時に静的に埋め込まれるため、GitHub Actions の build step の `env` で指定する必要がある。

---

## Phase 2: ランディングページ & 認証 UI & 法務 [一部完了]

### 2.1 ランディングページ（現ホームページベース） ✅

**方針: 現在の `app/frontend/src/app/page.tsx` をベースにランディングページ化**

現在のホームページ（AboutPage）は既にサービス紹介として完成度が高い:
- Hero セクション（Open Regime タイトル + 説明文）
- 5つの機能紹介カード（Liquidity Monitor, Economic Alert, Signal Analysis, Portfolio, Data Pipeline）
- 景気リスクスコアリングモデル解説（DocSection）
- データパイプライン解説（DocSection）
- 免責事項

これをそのまま活かし、**認証状態に応じた CTA ボタンの出し分け**を追加する:

```
【未認証ユーザー】
┌─────────────────────────────────────────────┐
│  Hero: Open Regime                          │
│  「金融市場の流動性と米国景気動向を...」      │
│                                              │
│  ┌──────────────┐  ┌──────────────┐         │
│  │ 無料で始める  │  │  ログイン    │         │
│  └──────────────┘  └──────────────┘         │
│                                              │
│  ── プラン比較セクション（新規追加）──        │
│  Free: ダッシュボード閲覧、シグナル3回/日... │
│  Pro:  全機能無制限...                       │
│                                              │
│  ── 既存の機能紹介カード5つ ──               │
│  ※ カードのリンク先は /register に変更       │
│  ※ 「この機能を使う →」ボタン               │
│                                              │
│  ── 景気リスクスコアリングモデル ──           │
│  ── データパイプライン ──                    │
│  ── 免責事項 ──                              │
│  ── 利用規約・プライバシーポリシーリンク ──   │
└─────────────────────────────────────────────┘

【認証済みユーザー】
  → 既存のホームページをそのまま表示
  → 機能カードのリンク先は各ページへ（現状通り）
  → CTA ボタンは非表示
```

**変更ファイル: `app/frontend/src/app/page.tsx`**:
- Supabase Auth セッションの有無で CTA ボタン/カードリンク先を出し分け
- Hero セクションに「無料で始める」「ログイン」ボタン追加
- プラン比較セクション追加（Free vs Pro の簡易テーブル）
- フッターに利用規約・プライバシーポリシーリンク追加

**ヘッダー変更: `app/frontend/src/components/layout/Header.tsx`**:
- 未認証時: ナビゲーション項目を非表示（or ランディングのみ）+ 「ログイン」ボタン表示
- 認証済み: 現在のナビゲーション（ホーム, ダッシュボード, 流動性, 景気リスク, 銘柄分析, ポートフォリオ）

### 2.2 認証ページ（Supabase Auth UI） ✅

#### ユーザーフロー全体図

```
ランディング (/)
│
├─「無料で始める」─→ /register ─→ メール確認待ち画面 ─→ 確認完了 → /dashboard
│                      ├── Email + Password
│                      ├── Google でアカウント作成
│                      └── 利用規約・プライバシーポリシー同意チェック
│
├─「ログイン」───→ /login ─→ /dashboard
│                    ├── Email + Password
│                    ├── Google でログイン
│                    └── 「パスワードを忘れた方」→ /reset-password
│
├─ 機能カード ──→ /register (未認証時)
│
└─ 認証済みで / にアクセス → 既存のホームページ表示
```

#### 新規ページ一覧

| ページ | ファイル | 内容 |
|--------|---------|------|
| 新規登録 | `app/frontend/src/app/register/page.tsx` | Email+Password フォーム / Google OAuth ボタン / 利用規約同意チェック |
| ログイン | `app/frontend/src/app/login/page.tsx` | Email+Password フォーム / Google OAuth ボタン / パスワードリセットリンク |
| パスワードリセット | `app/frontend/src/app/reset-password/page.tsx` | Email 入力 → リセットメール送信 → 新パスワード設定 |
| OAuth コールバック | `app/frontend/src/app/auth/callback/page.tsx` | Supabase Auth リダイレクト処理 → /dashboard に遷移 |
| メール確認待ち | `app/frontend/src/app/auth/verify/page.tsx` | 「確認メールを送信しました」画面 + 再送ボタン |

#### 登録フォームの項目

```
┌─────────────────────────────────────┐
│        アカウント作成               │
│                                      │
│  ┌─────────────────────────────┐    │
│  │  Google で登録               │    │
│  └─────────────────────────────┘    │
│                                      │
│  ─────────── または ───────────     │
│                                      │
│  メールアドレス: [              ]    │
│  パスワード:     [              ]    │
│  パスワード確認: [              ]    │
│                                      │
│  ☑ 利用規約とプライバシーポリシー   │
│    に同意する                        │
│                                      │
│  ┌─────────────────────────────┐    │
│  │  アカウントを作成            │    │
│  └─────────────────────────────┘    │
│                                      │
│  すでにアカウントをお持ちの方は     │
│  ログイン                            │
└─────────────────────────────────────┘
```

#### パスワード要件 ✅

- 8文字以上 + 大文字(A-Z) + 小文字(a-z) + 数字(0-9) + 記号(!@#$...) の5項目
- フロントエンドでリアルタイムチェックリスト表示（pass/fail アイコン）
- 確認パスワード不一致時の即時エラー表示
- パスワード表示/非表示トグル（Eye/EyeOff アイコン）

#### メール確認フロー

1. ユーザーが Email+Password で登録
2. Supabase Auth が確認メールを送信
3. `/auth/verify` 画面: 「確認メールを送信しました。メール内のリンクをクリックしてください」
4. ユーザーがメール内リンクをクリック → `/auth/callback` → メール確認完了 → `/dashboard` にリダイレクト
5. 確認メールが届かない場合: 「再送する」ボタン（`supabase.auth.resend()`）

※ Google OAuth の場合はメール確認不要（Google が保証済み）

### 2.3 未認証ユーザーのリダイレクト（Auth Guard） ✅

**新規ファイル: `app/frontend/src/components/providers/AuthGuard.tsx`**

認証が必要なページ（/dashboard, /liquidity, /employment, /signals, /holdings, /settings）にアクセスした未認証ユーザーを `/login` にリダイレクト:

```
未認証ユーザー → /dashboard → AuthGuard → /login?redirect=/dashboard
  → ログイン成功 → /dashboard にリダイレクト
```

- `redirect` クエリパラメータで元のページに戻す
- 公開ページ（/, /login, /register, /reset-password, /terms, /privacy）は AuthGuard 不要
- WelcomeModal は認証済みユーザーの初回アクセス時のみ表示（現状通り）

### 2.4 利用規約

**`app/frontend/src/app/terms/page.tsx`**

必須条項:
- サービス内容の定義（株式分析ツール、市場レジーム判定、シグナル計算）
- **投資助言ではない旨の明記（金融商品取引法上極めて重要）**
  - 「本サービスは情報提供のみを目的とし、特定の金融商品の売買を推奨するものではありません」
  - 金融商品取引法第2条第8項第11号に抵触しないことの確認
- 利用料金・支払い条件（Phase 4 実装後に追記）
- 禁止事項（不正利用、リバースエンジニアリング、再販、スクレイピング）
- 免責事項（投資判断による損失の免責）
- 契約解除条件
- 損害賠償の制限
- 準拠法・管轄裁判所（日本法・東京地方裁判所）

### 2.5 プライバシーポリシー

**`app/frontend/src/app/privacy/page.tsx`**

個人情報保護法 (APPI) 対応:
- 収集する個人情報: メールアドレス、認証プロバイダ情報
- 利用目的: サービス提供、アカウント管理
- 第三者提供: なし（委託先として Supabase, Cloudflare, Railway を記載）
- 開示・訂正・削除請求への対応手順
- Cookie 利用の告知

データ処理委託先:

| サービス | 処理内容 | データ所在地 |
|---------|---------|------------|
| Supabase | DB 保管・認証 | AWS (ap-northeast-1) |
| Cloudflare | CDN・エッジ配信 | グローバル（日本 PoP 含む） |
| Railway | API ホスティング | US リージョン |

---

## Phase 3: 機能制限 (Feature Gate) [公開前推奨]

> 課金と独立して先行実装可能。Free/Pro の枠組みを作り、最初は全ユーザー Free で開始。課金実装後に Pro アップグレードを提供。

### 3.1 プラン設計

| 機能 | Free | Pro |
|------|------|-----|
| ダッシュボード閲覧 | 全指標閲覧可 | 全指標閲覧可 |
| 銘柄分析（シグナル） | **1日3回まで** | 無制限 |
| ウォッチリスト銘柄数 | **5銘柄まで** | 50銘柄 |
| ポートフォリオ管理 | **利用不可** | 利用可（5ポートフォリオ） |
| 取引記録 | **利用不可** | 利用可 |
| データエクスポート (CSV) | 不可 | 利用可 |
| API レート制限 | 30 req/min | 120 req/min |

### 3.2 Backend 実装

**新規ファイル: `app/backend/feature_gate.py`**

```python
from enum import Enum
from typing import Dict

class Plan(str, Enum):
    FREE = "free"
    PRO = "pro"

PLAN_LIMITS: Dict[Plan, Dict[str, int]] = {
    Plan.FREE: {
        "signal_analysis_daily": 3,
        "watchlist_max": 5,
        "portfolio_max": 0,       # 利用不可
        "trades_enabled": 0,      # 利用不可
        "api_rate_per_min": 30,
    },
    Plan.PRO: {
        "signal_analysis_daily": 999999,
        "watchlist_max": 50,
        "portfolio_max": 5,
        "trades_enabled": 1,
        "api_rate_per_min": 120,
    },
}
```

**変更が必要な既存ルーター**:

| ルーター | 制限内容 |
|---------|---------|
| `routers/signal.py` | `GET /api/signal/{ticker}` — Free ユーザーは1日3回まで。Supabase に `signal_usage` テーブルで日次カウント |
| `routers/watchlist.py` | `POST /api/watchlist/add-ticker` — Free は5銘柄まで（追加前にカウントチェック） |
| `routers/holdings.py` | Free ユーザーは 403 返却（ポートフォリオ管理は Pro 限定） |
| `routers/trades.py` | Free ユーザーは 403 返却（取引記録は Pro 限定） |

**DB 追加テーブル**:

```sql
-- シグナル分析の日次使用量トラッキング
CREATE TABLE signal_usage (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id),
    used_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    count       INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, used_date)
);
CREATE INDEX idx_signal_usage_user_date ON signal_usage(user_id, used_date);
```

### 3.3 Frontend 変更

- 制限に達した場合のアップグレード誘導 UI（モーダル or バナー）
- ポートフォリオ/取引タブに「Pro 限定」バッジ表示
- シグナル分析に残り回数表示（Free ユーザー）

### 3.4 API レート制限の改善

現状: `slowapi` で 60 req/min per IP（全ユーザー一律）

改善:
- Free: 30 req/min per user
- Pro: 120 req/min per user
- `slowapi` の `key_func` をユーザー ID ベースに変更

---

## Phase 4: 課金 — Stripe 連携 [検討中・会社承認待ち]

> **ステータス: 検討中**。会社の承認プロセスを通す必要があるため、実装は保留。以下は承認後の実装計画。

### 4.1 Stripe Checkout 方式（推奨）

Stripe Checkout（ホスト型決済ページ）を採用。理由:
- 実装コスト最小
- PCI DSS 準拠が Stripe 側で完結（SAQ A）
- 日本のクレジットカード対応（Visa, Mastercard, AMEX, JCB）
- コンビニ払い・銀行振込は需要が出てから追加

### 4.2 必要なエンドポイント

**新規ファイル: `app/backend/routers/billing.py`**

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/billing/checkout` | Stripe Checkout セッション作成 → URL 返却 |
| POST | `/api/billing/portal` | Stripe Customer Portal URL 返却（カード変更・解約） |
| POST | `/api/billing/webhook` | Stripe Webhook 受信（認証不要、署名検証のみ） |
| GET | `/api/billing/subscription` | 現在のサブスクリプション状態 |

### 4.3 必要な DB テーブル

```sql
CREATE TABLE subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    stripe_subscription_id  TEXT UNIQUE NOT NULL,
    stripe_customer_id      TEXT NOT NULL,
    plan                    TEXT NOT NULL DEFAULT 'free',
    status                  TEXT NOT NULL,  -- active, past_due, canceled, trialing
    current_period_end      TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook べき等性チェック用
CREATE TABLE stripe_events (
    event_id    TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.4 Webhook 処理

必須イベント:
- `checkout.session.completed` — 新規サブスクリプション → users.plan を 'pro' に更新
- `customer.subscription.updated` — プラン変更
- `customer.subscription.deleted` — 解約 → users.plan を 'free' に戻す
- `invoice.payment_failed` — 支払い失敗通知

ベストプラクティス:
- 署名検証必須 (`stripe.Webhook.construct_event`)
- べき等性: `event.id` を `stripe_events` テーブルで重複チェック
- 200 を即座に返してから非同期処理

### 4.5 Frontend

- `app/frontend/src/app/pricing/page.tsx` — 料金プラン表示 + Checkout ボタン
- `app/frontend/src/app/settings/page.tsx` — サブスク管理リンク（Stripe Customer Portal）

### 4.6 税務

- 消費税 10% — Stripe Tax 自動計算 (`automatic_tax: { enabled: true }`)
- インボイス制度対応: 適格請求書発行事業者番号を Stripe に設定

### 4.7 追加の環境変数

| 場所 | 変数 | 用途 |
|------|------|------|
| Railway | `STRIPE_SECRET_KEY` | Stripe API |
| Railway | `STRIPE_WEBHOOK_SECRET` | Webhook 署名検証 |
| Frontend (CF Pages) | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe 公開キー |

---

## Phase 5: Admin ダッシュボード拡張 [後回し OK]

### 5.1 サブスクリプション管理ビュー

- ユーザー一覧に `plan`, `subscription_status` 列追加
- プラン手動変更機能（管理者がユーザーの plan を直接変更）
- 支払い失敗ユーザーのフラグ表示

### 5.2 使用量モニタリング

- ユーザー別シグナル分析回数（日次/月次）
- ウォッチリスト使用率
- API コール数（ユーザー別、エンドポイント別）

### 5.3 収益メトリクス（課金実装後）

- MRR (Monthly Recurring Revenue)
- チャーン率
- 新規有料ユーザー / 解約数

---

## セキュリティ監査チェックリスト

### 認証・認可

- [ ] Supabase Auth JWT 署名検証の実装確認
- [ ] JWT 有効期限 + リフレッシュトークン動作確認
- [ ] `X-Proxy-Secret` による Railway 直接アクセス防止（既に実装済み）
- [ ] Admin は Cloudflare Access + ADMIN_EMAILS + TOTP MFA を維持（既に実装済み）

### API セキュリティ

- [ ] CORS 設定の確認（特定 Origin のみ許可 — 既に実装済み）
- [ ] CSRF 対策: Origin ヘッダー検証（既に `CSRFOriginMiddleware` 実装済み）
- [ ] レート制限: slowapi 60 req/min（既に実装済み → Phase 3 でプラン別に改善）
- [ ] 入力バリデーション: FastAPI Pydantic モデルの全面見直し
- [ ] SQL インジェクション: Supabase client のパラメタライズドクエリ確認

### データ保護

- [ ] HTTPS 強制（Cloudflare Pages/Workers 標準対応済み）
- [ ] Supabase SSL 接続確認
- [ ] セキュリティヘッダー（`SecurityHeaderMiddleware` 既に実装済み: X-Content-Type-Options, X-Frame-Options, HSTS 等）
- [ ] Worker のセキュリティヘッダー（既に実装済み）
- [ ] TOTP シークレットの暗号化保存（現在は平文 `secret_enc` → 要改善）

### 依存パッケージ

- [ ] `pip-audit` による Python パッケージ脆弱性スキャン
- [ ] `npm audit` による Node.js パッケージ脆弱性スキャン
- [ ] GitHub Dependabot 有効化

### 運用

- [ ] エラートラッキング導入（Sentry 推奨、ローンチ後でも可）
- [ ] 監査ログ実装（ログイン/設定変更/サブスク変更の記録）
- [ ] Supabase バックアップ確認（Pro Plan で日次自動バックアップ）

---

## やらないこと（過剰設計の回避）

| 項目 | 理由 |
|------|------|
| マルチテナント（tenant_id） | 個人向けサービス。user_id ベースのデータ分離で十分 |
| Supabase RLS | service_role key + アプリレベルの user_id フィルタで十分 |
| 新しい DB / VPS | Supabase + Railway を継続。追加契約不要 |
| Staging 環境 | Cloudflare Pages プレビュー URL + Railway dev で代用 |
| Sentry / 構造化ログ | ローンチ後に必要に応じて導入 |
| コンビニ払い / 銀行振込 | 需要が出てから Stripe で追加 |
| Enterprise プラン | ユーザー規模を見てから検討 |
| GDPR 対応 | 日本国内向けサービスとして APPI 準拠で十分。EU 展開時に検討 |

---

## 実装優先順位サマリ

| 優先度 | フェーズ | 内容 | 備考 |
|--------|---------|------|------|
| **P0** | Phase 1 | 認証移行 (Supabase Auth) | ✅ 完了 |
| **P0** | Phase 2 | ランディングページ + 利用規約 + プライバシーポリシー | ランディング・認証UI ✅ / 利用規約・プライバシーポリシー 未実施 |
| **P1** | Phase 3 | 機能制限 (Feature Gate) | 課金前でも Free 枠で制限可能 |
| **P2** | Phase 4 | Stripe 課金 | **会社承認待ち** |
| **P3** | Phase 5 | Admin 拡張 | 課金後でよい |

---

## 検証方法

### Phase 1 テスト
1. 新規登録 → メール確認 → ログイン → API アクセス → データ保存 → ログアウト → 再ログイン
2. Google OAuth での新規登録 → ログイン → 同様の動作確認
3. 既存ユーザーテスト: CF Access 時代のメールで Supabase Auth ログイン → 既存データ（holdings, watchlist 等）にアクセス可能か確認
4. パスワードリセットフロー
5. 未認証状態で API にアクセス → 401 エラー確認

### Phase 3 テスト
1. Free ユーザー: シグナル分析を4回実行 → 4回目で制限エラー
2. Free ユーザー: ウォッチリストに6銘柄追加 → 6番目で制限エラー
3. Free ユーザー: ポートフォリオ/取引にアクセス → 403 エラー
4. Pro ユーザー: 全機能利用可能

### Phase 4 テスト（将来）
1. Stripe テストモードで Checkout → 支払い完了 → Webhook → users.plan 更新 → 機能制限解除
2. 解約 → Webhook → users.plan を free に戻す → 機能制限適用

---

## 参考リソース

- [Supabase Auth ドキュメント](https://supabase.com/docs/guides/auth)
- [Supabase Auth + Next.js ガイド](https://supabase.com/docs/guides/auth/quickstarts/nextjs)
- [Stripe Checkout ドキュメント](https://docs.stripe.com/payments/checkout)
- [Stripe Webhook ベストプラクティス](https://docs.stripe.com/webhooks/best-practices)
- [FastAPI + JWT 認証パターン](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)
- [Cloudflare Pages 環境変数](https://developers.cloudflare.com/pages/configuration/build-configuration/#environment-variables)
