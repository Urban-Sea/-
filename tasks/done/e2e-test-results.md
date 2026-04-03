# E2E Test Results - Docker VPS Migration

> Tested: 2026-04-04
> Environment: Docker Compose (localhost)
> Containers: postgres:16-alpine, redis:7-alpine, nginx:alpine, api-python, api-go, frontend, admin-frontend

## Summary

| Category | Pass | Fail | Notes |
|----------|------|------|-------|
| Infrastructure (3-A) | 1/1 | 0 | |
| Python API (3-B) | 4/4 | 0 | yfinance OK, Redis cache OK |
| Go API Public (3-C) | 8/8 | 0 | employment/overview は DateOnly 修正後に PASS |
| Auth Flow (3-D) | 2/2 | 0 | client_id 空 (GOOGLE_CLIENT_ID 未設定) |
| Frontend (3-E) | 4/4 | 0 | SSR OK, prod API URL 漏れなし |
| Negative Tests (3-F) | 1/2 | 1 | /api/nonexistent が 404 ではなく 401 |
| **Total** | **20/21** | **1** | |

## Step 3 Results

### 3-A Infrastructure
- [x] `/health` → 200 `ok`

### 3-B Python API (yfinance 依存)
- [x] `/api/regime` → 200 (1.3s) — regime=WEAKENING, benchmark=SPY $655.83
- [x] `/api/signal/SPY` → 200 (0.5s) — combined_ready=true, bos_grade=NONE
- [x] `/api/stock/SPY` → 200 (0.4s) — price=$655.83, market_cap=601B
- [x] `/api/exit/SPY?entry_price=400` → 200 (0.04s) — should_exit=true, PROFIT_T1

### 3-C Go API (DB クエリ)
- [x] `/api/stocks` → 200 — total=23, `{"stocks":[...],"total":23}` 形式
- [x] `/api/stocks/categories/list` → 200 — price_categories: large/mid/penny
- [x] `/api/fx/usdjpy` → 200 — rate=159.57
- [x] `/api/market-state/latest` → 200 — state=POLICY_TIGHTENING, date=2026-03-20
- [x] `/api/liquidity/overview` → 200 — credit_spreads/fed_balance_sheet/interest_rates 含む
- [x] `/api/liquidity/plumbing-summary` → 200 — credit_pressure=Low, pressure_count=1
- [x] `/api/employment/risk-score` → 200 — total_score=20, phase=EXPANSION
- [x] `/api/employment/overview` → 200 — alert_level=Medium, NFP negative

### 3-D Auth Flow
- [x] `/api/auth/google` → 307 redirect to accounts.google.com
- [x] redirect_uri = `http://localhost/api/auth/google/callback` (正しい)
- **注意**: `client_id=` が空 (GOOGLE_CLIENT_ID 未設定)。Step 4 で設定要

### 3-E Frontend HTML
- [x] `/` → 200 — SSR HTML (meta charset, viewport 確認)
- [x] prod API URL 漏れチェック → count=0 (安全)
- [x] `/admin/` → 200 — SSR HTML

### 3-F Negative Tests
- [x] `/api/me` (no auth) → 401 `{"detail":"authentication required"}`
- [ ] `/api/nonexistent` → 401 (期待: 404)
  - 原因: nginx が `/api/*` を全て api-go に転送 → Go の auth middleware が 401 を返す
  - 影響: 低 (セキュリティ的にはむしろ良い。未認証ユーザーにルート存在の有無を漏らさない)

## Issues Found

### 1. [FIXED] employment/overview DateOnly 型不一致

**問題**: `/api/employment/overview` が 500 を返した
**原因**: `EconomicIndicator.ReferencePeriod` と `WeeklyClaims.WeekEnding` が Go `string` 型だが、PostgreSQL の `DATE` 列を pgx でスキャンできなかった
**修正**: `api-go/internal/model/employment.go` の3フィールドを `DateOnly` 型に変更
- `EconomicIndicator.ReferencePeriod`: `string` → `DateOnly`
- `WeeklyClaims.WeekEnding`: `string` → `DateOnly`
- `EconomicIndicatorRevision.PublishedDate`: `*string` → `*DateOnly`

### 2. [PENDING] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 未設定

**影響**: OAuth redirect の client_id が空。Google ログインが動作しない
**対処**: Step 4 で設定予定

### 3. [LOW] /api/nonexistent が 401 (404 ではない)

**原因**: nginx `/api/*` → api-go → auth middleware → 401
**影響**: 低。ルート存在の情報漏洩を防ぐ副作用あり

## Step 4 Results

- Login email used: ryu3ta.ke.mo100307@gmail.com
- Matched seed user: yes (user_id: 29d6b2a8-50e7-4e0d-b097-9bbc7ed397f4)
- Path taken: **Path 2** (FindByEmail match, auth_provider_id not updated)
- User count before: 5, after: 5 (新規作成なし)
- auth_provider: `supabase` のまま (Google sub への更新はされなかった)
- auth_provider_id: 旧 Supabase UUID のまま

### 認証付きエンドポイント
- [x] `/api/auth/me` → 200 — user_id, email, plan=pro 確認
- [x] `/api/holdings` → 200 — seed データの holdings が正しく返却 (9432, 9434 等)

### auth_provider_id に関する所見
- `findOrCreateUser` (auth.go:246) は `auth_provider_id != nil` の場合、Google sub への更新をスキップ
- 結果: ログインは毎回 FindByAuthProviderID (miss) → FindByEmail (hit) の2段階
- 機能的に問題なし。パフォーマンスへの影響は軽微 (email に INDEX あり)
- 本番移行時に auth_provider_id を Google sub に一括更新するスクリプトが必要

## 提案: findOrCreateUser の auth_provider_id 自動更新

### 背景

E2E テストで判明した事実:
- seed ユーザーの `auth_provider_id` は Supabase UUID (例: `5c8b3544-...`)
- Google OAuth ログイン時、`findOrCreateUser` (auth.go:235-271) は以下の順で検索:
  1. `FindByAuthProviderID(googleSub)` → Supabase UUID と不一致 → miss
  2. `FindByEmail(email)` → hit → ユーザー返却
- ただし auth.go:246 の条件 `if user.AuthProviderID == nil` により、既に値がある場合は Google sub への更新がスキップされる
- 結果: ログインは成功するが、`auth_provider_id` は旧 Supabase UUID のまま残り続ける
- 以後のログインも毎回 FindByAuthProviderID (miss) → FindByEmail (hit) の2段階を通る

### 問題

1. **毎回2段階の DB ルックアップ** — email に INDEX があるので実害は軽微だが無駄
2. **手動移行スクリプトが必要になる** — Google sub を別途取得して SQL UPDATE する必要がある
3. **api-go は Google sub をログに出力しない** — 手動取得の手段がない

### 提案する変更

`api-go/internal/handler/auth.go` の `findOrCreateUser` 内:

```go
// 現在 (auth.go:246-249)
if user.AuthProviderID == nil {
    if bindErr := h.userRepo.UpdateAuthProvider(ctx, user.ID, "google", info.ID); bindErr != nil {
        return nil, fmt.Errorf("bind auth provider: %w", bindErr)
    }
}

// 提案: auth_provider が google 以外の場合も更新 (supabase → google 移行)
if user.AuthProviderID == nil || (user.AuthProvider != nil && *user.AuthProvider != "google") {
    if bindErr := h.userRepo.UpdateAuthProvider(ctx, user.ID, "google", info.ID); bindErr != nil {
        return nil, fmt.Errorf("bind auth provider: %w", bindErr)
    }
}
```

### 効果

- 既存ユーザーが Google ログインするだけで `auth_provider_id` が自動的に Google sub に更新される
- 手動移行スクリプト不要
- 以後のログインは FindByAuthProviderID で1発ヒット
- 新規ユーザーには影響なし (既存の Create パスはそのまま)

### レビュー観点

- `UpdateAuthProvider` は `auth_provider` と `auth_provider_id` の両方を更新する。既存データへの影響を確認
- Supabase UUID が他のテーブルで参照されていないか (→ `auth_provider_id` は FK ではないので問題なし)
- ロールバック: 万が一問題があっても、auth_provider_id の変更はログイン動作に影響しない (FindByEmail フォールバックがある)

### 実装・検証結果 [DONE]

**変更**: `auth.go:246` の条件を修正
```go
// Before
if user.AuthProviderID == nil {
// After
if user.AuthProviderID == nil || user.AuthProvider != "google" {
```
注: `AuthProvider` は `string` 型 (ポインタではない) のため、cowork レビューの `*user.AuthProvider` ではなく直接比較。

**検証**: 再ログイン後に DB を確認
- `auth_provider`: `supabase` → `google` に更新
- `auth_provider_id`: Supabase UUID → Google sub (`106510404751477260207`) に更新
- 手動移行スクリプト不要になった

## Deferred Items

- [ ] Liquidity/employment 計算精度の Go vs Python 比較検証
- [ ] Stripe webhook テスト (stripe CLI 必要)
- [ ] Admin MFA フロー (MFA セットアップ必要)
- [ ] GitHub Actions batch テスト (SUPABASE_URL 参照問題)
