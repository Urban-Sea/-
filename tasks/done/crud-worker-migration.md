# Step 1: CRUD エンドポイントを Cloudflare Workers に移行

> 完了日: 2026-03-01
> ステータス: 完了・本番稼働中

---

## 概要

49 個の CRUD エンドポイントを Python/Railway 経由から Cloudflare Workers (TypeScript) 内で直接処理するように移行。Worker が Supabase に直接クエリを発行し、Railway を経由しなくなった。

**効果:**
- レイテンシ: ~400ms → ~100ms (CRUD エンドポイント)
- Railway 負荷: 84 → 35 エンドポイント (58% 削減)
- バンドルサイズ: 564KB (gzip 114KB) — Workers 無料枠 1MB 以内

---

## 作成ファイル (~20 ファイル, ~2,500行)

### ミドルウェア (`src/middleware/`)
| ファイル | 内容 |
|---------|------|
| `auth.ts` | JWT 検証 (jose) + レガシー X-User-Email 認証 + ユーザー自動作成 |
| `admin-auth.ts` | Admin 認証 (ADMIN_EMAILS チェック) + MFA セッション検証 |
| `cors.ts` | CORS ヘッダー生成 (index.ts から抽出) |
| `rate-limit.ts` | IP レートリミッター (index.ts から抽出) |
| `security-headers.ts` | セキュリティヘッダー定数 (index.ts から抽出) |

### ライブラリ (`src/lib/`)
| ファイル | 内容 |
|---------|------|
| `supabase.ts` | Supabase クライアント初期化 + `.table()` ラッパー |
| `response.ts` | jsonResponse / errorResponse ヘルパー |
| `validation.ts` | ticker, shares, 日付バリデーション |
| `totp.ts` | TOTP (RFC 6238) — Web Crypto API で実装 |
| `crypto.ts` | AES-256-GCM 暗号化/復号 (crypto.subtle) |

### ルート (`src/routes/`)
| ファイル | エンドポイント数 | ポート元 |
|---------|----------------|---------|
| `me.ts` | 2 | users.py (62行) |
| `holdings.ts` | 12 | holdings.py (632行) |
| `trades.ts` | 6 | trades.py (444行) |
| `watchlist.ts` | 6 | watchlist.py (227行) |
| `stocks.ts` | 3 | stocks.py (125行) |
| `market-state.ts` | 3 | market_state.py (163行) |
| `fx.ts` | 1 | fx.py (52行) |
| `employment-crud.ts` | 5 | employment.py (CRUD 部分) |
| `liquidity-crud.ts` | 5 | liquidity.py (CRUD 部分) |
| `admin.ts` | 8 | admin.py (423行) |
| `admin-mfa.ts` | 6 | admin_mfa.py (398行) |
| `proxy.ts` | — | 計算エンドポイントの Railway プロキシ |

### 変更ファイル
| ファイル | 変更内容 |
|---------|---------|
| `src/index.ts` | ルーティングディスパッチャーに全面改修。`CRUD_IN_WORKER` フラグで分岐 |
| `src/env.ts` | SUPABASE_URL, SUPABASE_KEY 等の型定義追加 |
| `wrangler.jsonc` | `CRUD_IN_WORKER`, `ENVIRONMENT` 環境変数追加 |
| `package.json` | `@supabase/supabase-js`, `jose` 依存追加 |

---

## アーキテクチャ

```
CRUD_IN_WORKER=true の場合:

  ブラウザ
    → Worker
      ├── CRUD パス (/api/holdings, /api/trades 等)
      │     → Worker 内で JWT 検証 → Supabase 直接クエリ → レスポンス
      │
      └── 計算パス (/api/signal/*, /api/regime 等)
            → Railway にプロキシ (従来通り)
```

### Worker 内で処理するパス (CRUD)
- `/api/me`, `/api/holdings/*`, `/api/trades/*`, `/api/watchlist/*`
- `/api/stocks/*`, `/api/market-state/*`, `/api/fx/usdjpy`
- `/api/employment/` (overview, indicators, weekly-claims, revisions)
- `/api/liquidity/` (fed-balance-sheet, interest-rates, credit-spreads, market-indicators, margin-debt)
- `/api/admin/*`, `/api/admin/mfa/*`

### Railway にプロキシするパス (計算)
- `/api/signal/*`, `/api/regime`, `/api/exit/*`
- `/api/stock/*` (株価分析)
- `/api/liquidity/` (overview, plumbing-summary, events, policy-regime, history-charts, backtest-states)
- `/api/employment/` (risk-score, risk-history)

---

## Wrangler Secrets (登録済み)

| シークレット | 用途 |
|-------------|------|
| `PROXY_SECRET` | Railway プロキシ認証 (既存) |
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_KEY` | service_role key |
| `SUPABASE_JWT_SECRET` | JWT 署名検証 |
| `ADMIN_EMAILS` | 管理者メールアドレス |
| `MFA_ENCRYPTION_KEY` | MFA シークレット暗号化 |

---

## ロールバック手順

`wrangler.jsonc` の `CRUD_IN_WORKER` を `"false"` に変更して `wrangler deploy` するだけで、全リクエストが Railway にプロキシされる従来の動作に戻る。

---

## 技術的な注意点

- **supabase-js v2**: `.from()` メソッドを使うが、Python ポート元との一貫性のため `.table()` ラッパーを追加 (`lib/supabase.ts`)
- **型**: `AppSupabase = ReturnType<typeof getSupabase>` で `.table()` 付きの型を全ルートで使用
- **JWT 検証**: `jose` ライブラリで HS256 (SUPABASE_JWT_SECRET) と ES256 (JWKS) の両方に対応。kid ヘッダーの有無で分岐
- **MFA**: Web Crypto API で TOTP と AES-256-GCM を実装。Python の pyotp / cryptography と互換
