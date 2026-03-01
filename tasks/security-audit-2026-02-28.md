# Open Regime セキュリティ監査レポート

> 実施日: 2026-02-28
> 対象: システム設計_詳細.md + 全ソースコード

---

## 総合評価

基本的なセキュリティ設計は妥当（RLSの全テーブル有効化、Supabase Auth JWT検証、CORS設定、
IDOR防止のuser_idフィルタ、SQLインジェクション耐性あり）。ただし、以下の脆弱性が存在する。

| 深刻度 | 件数 |
|--------|------|
| CRITICAL | 3 |
| HIGH | 5 |
| MEDIUM | 12 |
| LOW | 8 |

---

## CRITICAL（即時対応推奨）

### C1. JWT アルゴリズム選択を攻撃者が制御可能

**場所**: `app/backend/auth.py:271-303`

JWT ヘッダーの `alg` フィールド（**未検証**）で ES256/HS256 のコードパスを分岐。
攻撃者がアルゴリズムを任意に選択できる。PyJWT >= 2.4 の `algorithms=` パラメータで
古典的 alg confusion は緩和されているが、`SUPABASE_JWT_SECRET` が漏洩した場合、
ES256 の JWKS 検証パスをバイパスして HS256 でトークン偽造が可能。

**修正案**: サーバー構成（起動時の JWKS エンドポイント確認）でアルゴリズムを決定し、
トークンヘッダーからは判断しない。

### C2. JWT issuer 検証が警告のみ（ブロックしない）

**場所**: `app/backend/auth.py:305-313`

`iss` クレームの不一致をログに記録するだけで、リクエストは通過する。
別の Supabase プロジェクトの JWT が受け入れられる可能性。

**修正案**: `pyjwt.decode()` に `issuer=f"{SUPABASE_URL}/auth/v1"` を渡して
暗号検証レイヤーで issuer を強制。

### C3. Worker のキャッシュキーに未検証の X-User-Email を使用 → クロスユーザーデータ漏洩

**場所**: `app/worker/src/index.ts:128-137`

`X-User-Email` ヘッダー（クライアント送信値）をキャッシュキーに使用。
Origin ヘッダーのチェックはブラウザ以外（curl 等）では簡単に偽装可能。

```bash
# 攻撃例：他ユーザーのキャッシュされた保有データを取得
curl -H "Origin: https://open-regime.pages.dev" \
     -H "X-User-Email: victim@example.com" \
     https://worker.example.com/api/holdings
```

**修正案**: キャッシュキーにクライアント送信ヘッダーを使わない。
JWT を Worker 側でも検証して `sub` クレームのハッシュをキャッシュキーに使用、
または per-user エンドポイントはキャッシュしない。

---

## HIGH（早期対応推奨）

### H1. 開発モードで認証が完全に無効化

**場所**: `app/backend/auth.py:364-366`

`ENVIRONMENT != "production"` の場合、認証ヘッダーなしのリクエストが
`dev@localhost` として自動認証される。
`ENVIRONMENT` 変数の設定漏れ/タイポで本番の認証が無効化される。

**修正案**: `SUPABASE_JWT_SECRET` が設定済みなら `ENVIRONMENT` の値に関わらず
JWT 検証を強制する fail-closed 設計に変更。

### H2. Origin ヘッダー偽装による認証バイパス（Worker）

**場所**: `app/worker/src/index.ts:127, 162-173`

Origin ヘッダーを信頼して `Authorization`, `X-User-Email`, `X-MFA-Token` を
バックエンドに転送。Origin はブラウザ外で自由に偽装可能。

**修正案**: Worker でも JWT 署名を検証してユーザー identity を確認。
または backend 側で `X-User-Email` を信頼せず JWT からのみ identity を取得。

### H3. `/api/auth/check` で JWT シークレットの先頭4文字が漏洩

**場所**: `app/backend/main.py:191`

認証不要のエンドポイントで `jwt_secret_prefix` としてシークレットの先頭4文字を返却。

**修正案**: `jwt_secret_prefix` フィールドを削除。本番では endpoint 自体を
admin 認証必須にするか無効化。

### H4. レガシー認証パスで開発環境ユーザー偽装

**場所**: `app/backend/auth.py:342-362`

非本番環境では `X-User-Email` ヘッダーのみで任意のユーザーになりすまし可能
（Proxy Secret チェックがスキップされる）。

### H5. メール確認なしでフルアクセス可能

**場所**: `app/backend/auth.py:332-338`

`email_confirmed_at` が null でも警告ログのみで認証が通過。
使い捨てメールでの不正アカウント作成が可能。

**修正案**: 少なくとも書き込み操作はメール確認済みユーザーに限定。

---

## MEDIUM

### M1. CORS: 不正 Origin にも許可済み Origin を返却
`app/worker/src/index.ts:62` — 不正 Origin のリクエストに対して `allowed[0]` を返す。
正しくは CORS ヘッダーを省略すべき。

### M2. CSRF 保護が非本番で無効
`app/backend/main.py:56` — `_IS_PRODUCTION` false 時に CSRF ミドルウェアがスキップ。

### M3. HMAC アルゴリズムが常に全バリアント許可
`app/backend/auth.py:294` — `allowed_algs` が常に `{HS256, HS384, HS512}` になる。

### M4. HoldingUpdate で負の shares/avg_price を許容
`app/backend/routers/holdings.py:87-96` — バリデータなし。ポートフォリオ計算の破壊可能。

### M5. trade_date の日付形式バリデーションなし
`app/backend/routers/trades.py:29, 48` — 任意文字列が DB に格納される。

### M6. create_trade で holding_id の所有者チェックなし
`app/backend/routers/trades.py:53, 269` — 他ユーザーの holding_id を参照可能。

### M7. sell_from_holding の非原子性（レースコンディション）
`app/backend/routers/trades.py:310-383` — 同時売却で負の shares やデータ不整合。

### M8. シグナル計算エンドポイントにレート制限なし
`app/backend/routers/signal.py:133, 299, 366, 450` — 重い計算を無制限に実行可能（DoS）。

### M9. Implicit OAuth フローで URL ハッシュにトークン露出
`app/frontend/src/lib/supabase.ts:10` — `flowType: 'implicit'`。
PKCE への切り替えでトークン露出を完全に排除可能。

### M10. Content-Security-Policy ヘッダーなし
`app/frontend/next.config.ts` — CSP, X-Frame-Options, X-Content-Type-Options 未設定。
XSS 発生時に localStorage のトークンが窃取される。

### M11. localStorage にトークンが永続化
`app/frontend/src/lib/supabase.ts:11` — `persistSession: true` により Supabase SDK が
localStorage にアクセストークン+リフレッシュトークンを保存。XSS で窃取リスク。

### M12. SSRF: Worker が /api/* 全パスをバックエンドにプロキシ
`app/worker/src/index.ts:156` — 許可リストなく全 `/api/*` パスを転送。

---

## LOW

### L1. 例外メッセージの漏洩（holdings cash）
`holdings.py:293, 322` — `detail=str(e)` で内部情報が露出。

### L2. account_type のバリデーションなし
`holdings.py:20, 38, 57` — `_ACCOUNT_TYPES` セットを定義済みだが未使用。

### L3. CashBalanceCreate の制約なし
`holdings.py:259-263` — label の最大長、currency の許可値、amount の下限なし。

### L4. 管理者判定がメールマッチング
`admin.py:20-54` — `ADMIN_EMAILS` 環境変数でメール照合。DB のメール改竄で権限昇格。

### L5. ユーザー無効化後の 5 分キャッシュ
`auth.py:50-53` — TTLCache で無効化ユーザーが最大 5 分間アクセス可能。

### L6. sub クレームの形式バリデーションなし
`auth.py:327-330` — UUID 形式を検証しておらず任意文字列が通過。

### L7. batch limit 不整合
`stock.py:179-202` — GET は 20, POST は 50 と表示するが実際は 20 に切り詰め。

### L8. キャッシュキーのメールサニタイズなし
`worker/src/index.ts:136` — URL特殊文字を含むメールでキャッシュキー操作の可能性。

---

## 設計上のポジティブ評価

| 項目 | 評価 |
|------|------|
| IDOR 防止 | 全 CRUD で `.eq("user_id", uuid)` → 他ユーザーデータへのアクセス不可 |
| SQL インジェクション耐性 | Supabase クライアントのパラメタライズドクエリ使用 |
| Mass Assignment 防止 | Create/Update で明示的フィールド指定、user_id は認証から設定 |
| RLS 全テーブル有効 | service_role でバイパスするが anon キーでの直アクセスは制限 |
| XSS 防止（React） | `dangerouslySetInnerHTML` 不使用 |
| Admin MFA | TOTP + SHA-256 セッショントークン + 1 時間有効期限 |
| ロジック保護 | 計算ロジックはサーバーサイドのみ、フロントに露出なし |

---

## 優先対応リスト（推奨順）

| 優先度 | ID | 対応 | 工数目安 |
|--------|-----|------|---------|
| 1 | C3 | Worker キャッシュキーから X-User-Email を排除 | 小 |
| 2 | C1 | JWT アルゴリズムをサーバー構成で決定 | 小 |
| 3 | C2 | JWT issuer 検証を強制に変更 | 小 |
| 4 | H3 | `/api/auth/check` から jwt_secret_prefix 削除 | 小 |
| 5 | H1 | 開発モード認証バイパスの fail-closed 化 | 小 |
| 6 | H2 | Worker の Origin 信頼を排除 | 中 |
| 7 | H5 | メール未確認ユーザーの書き込み制限 | 小 |
| 8 | M4 | HoldingUpdate にバリデータ追加 | 小 |
| 9 | M6 | create_trade の holding_id 所有者チェック | 小 |
| 10 | M7 | sell_from_holding のアトミック化 | 中 |
| 11 | M8 | シグナルエンドポイントにレート制限追加 | 中 |
| 12 | M9 | OAuth フローを PKCE に切り替え | 中 |
| 13 | M10 | CSP ヘッダー追加（Cloudflare Pages _headers） | 小 |
