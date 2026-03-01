# Lessons Learned

## 2026-02-28: Supabase JWT uses ES256, not HMAC

**Problem**: `require_auth` was using `SUPABASE_JWT_SECRET` (HMAC shared secret) to verify JWTs, but Supabase signs JWTs with **ES256 (ECDSA)** — an asymmetric algorithm that uses a public/private key pair.

**Symptoms**: `InvalidAlgorithmError: The specified alg value is not allowed` when the backend tried to verify any JWT from Supabase Auth. This caused 401 responses on all `require_auth` endpoints, triggering the frontend's signOut→redirect loop.

**Root cause**: The `SUPABASE_JWT_SECRET` in Supabase Dashboard is the HMAC secret for legacy compatibility. Modern Supabase projects use ES256 by default. The JWT header's `alg` field is `"ES256"`, not `"HS256"`.

**Fix**: Use `PyJWKClient` to fetch the public key from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` for asymmetric algorithms (ES/RS/PS), with HMAC fallback for HS256.

**Rule**: Always check the JWT header `alg` field before choosing a verification strategy. Never assume HMAC — Supabase (and many identity providers) use asymmetric algorithms by default.

## 2026-02-28: 401 redirect loops need circuit breakers

**Problem**: Frontend SWR fetcher and fetchAPI both had `if (response.status === 401) { signOut(); redirect('/login/') }` without any loop prevention. If the JWT is permanently invalid, every API call triggers signOut+redirect endlessly.

**Fix**: Added module-level `_isRedirecting` flag in `auth-store.ts`. Once a 401 redirect is initiated, further 401s are suppressed until the next successful login sets a new token.

**Rule**: Any automatic redirect triggered by auth failure MUST have a circuit breaker to prevent infinite loops.

## 2026-03-01: セキュリティ修正は段階的にリスクゼロから

**Problem**: 前回の JWT 修正で全認証が壊れた。セキュリティ修正は「正しいこと」を
していても、既存の動作フローを壊すリスクが高い。

**Approach**: 修正をリスクレベルで分類して実装順序を決定:
1. リスクゼロ（情報漏洩防止、ヘッダー追加） → 先に
2. 中リスク（ミドルウェア強化） → 次に
3. 高リスク（認証ロジック変更） → 最後に、最小差分で

**Rule**: セキュリティ修正は「else if 1 ブロック追加」のような最小差分を心がける。
既存のコードパスを変更するのではなく、新しい分岐を追加して拒否する。

## 2026-03-01: 監査レポートの鮮度に注意

**Problem**: 2/28 監査で C2（issuer）と C3（キャッシュキー）を Critical と報告したが、
3/1 の移行時にすでに修正されていた。古い監査結果をそのまま信じて
「修正が必要」と判断すると、不要な変更で壊すリスクがある。

**Rule**: セキュリティ修正前に必ず実コードを読んで現状を確認する。
監査レポートの指摘箇所を実際のコードと照合し、修正済みかどうか判定してから着手。
