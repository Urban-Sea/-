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
