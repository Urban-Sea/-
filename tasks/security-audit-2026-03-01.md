# セキュリティ監査レポート — システム設計_詳細2.md

> 実施日: 2026-03-01
> 対象: システム設計_詳細2.md + Worker / Backend / CI/CD 全ソースコード
> 前回監査: 2026-02-28（未修正の脆弱性も含めて記載）

---

## 総合評価

アーキテクチャ設計は堅実（WIF キーレス認証、RLS 有効、CORS、3 層 Admin 認証、MFA）。

### 修正ステータス（2026-03-01 実施）

| 深刻度 | 発見数 | 修正済み | 残存 |
|--------|--------|---------|------|
| CRITICAL | 4 | 4 (C1 修正, C2/C3 移行時修正, C4 緩和) | 0 |
| HIGH | 8 | 4 (H2, H3 新規修正, H3旧 移行時修正, H5 Redis化) | 4 |
| MEDIUM | 10 | 1 (M9 Dockerfile) | 9 |
| LOW | 6 | 1 (L1 HSTS preload) | 5 |

---

## CRITICAL（即時対応）

### C1. ✅ 修正済み — JWT アルゴリズム混乱防止（JWKS 専用モード）

**場所**: `app/backend/auth.py:205-212`, `app/worker/src/middleware/auth.ts:268-272`
**修正内容**: 本番環境で JWKS が設定済みの場合、`kid` なしトークン（HMAC パス）を拒否。
Supabase ES256 トークンは必ず `kid` を持つため正規トークンは影響なし。
開発環境の HMAC フォールバックは維持。

### C2. ✅ 移行時修正済み — JWT issuer 検証

**場所**: `app/backend/auth.py:188-190,203,219`
**確認**: `pyjwt.decode()` に `issuer=` を渡しており、`InvalidIssuerError` は 401 を返す。

### C3. ✅ 移行時修正済み — キャッシュキー

**場所**: `app/worker/src/routes/proxy.ts:22`
**確認**: `url.toString()` を使用。X-User-Email はキャッシュキーに含まれない。

### C4. 緩和済み — Cloud Run `--allow-unauthenticated`

**場所**: `.github/workflows/deploy.yml:160`
**状態**: `--allow-unauthenticated` は残存（Worker から IAM 認証は CF Workers で困難）。
**緩和策**: CSRF ミドルウェアで本番の全 mutating リクエストに PROXY_SECRET を必須化。
JWT + PROXY_SECRET の二重検証で防御。完全修正には Cloud Run Ingress 制限が必要。

---

## HIGH（1 週間以内に対応）

### H1. 【未修正】開発モードで認証バイパス

**場所**: `app/worker/src/middleware/auth.ts`

`ENVIRONMENT !== 'production'` のとき `dev@localhost` で認証をスキップ。
誤って非 production 設定でデプロイすると全認証が無効化。

**修正案**: 開発モード認証バイパスを明示的な `DEV_AUTH_BYPASS=true` フラグに変更。

### H2. 【未修正】`/api/auth/check` が JWT シークレットの先頭 4 文字を漏洩

**場所**: `app/backend/main.py`

認証不要のデバッグエンドポイントがJWT検証の詳細ステップを返却。

**修正案**: 本番環境では無効化、または認証必須にする。

### H3. PROXY_SECRET 検証が本番でも任意

**場所**: `app/backend/main.py:53-70`

`_PROXY_SECRET` 未設定時、`_ALLOWED_ORIGINS` からのリクエストなら通過。
本番環境では PROXY_SECRET 検証を必須にすべき。

```python
# 現状: Origin が許可リストにあれば PROXY_SECRET なしでも通過
if not has_valid_proxy and origin not in _ALLOWED_ORIGINS:
    return JSONResponse(status_code=403, ...)

# 修正案: 本番では PROXY_SECRET を必須に
if _IS_PRODUCTION and not has_valid_proxy:
    return JSONResponse(status_code=403, ...)
```

### H4. Email ベースのアカウントリンクで乗っ取り可能

**場所**: `app/backend/auth.py:103-136`

CF Access → Supabase Auth 移行時、メールアドレスだけで `auth_provider_id` を
上書きリンクする。攻撃者が同じメールの JWT を取得できれば既存アカウントを乗っ取れる。

**修正案**: 移行フロー完了後はこのロジックを削除。または手動確認を必須に。

### H5. ~~レート制限がインメモリのみ~~ ✅ 修正済み (2026-03-01)

**場所**: `app/worker/src/middleware/rate-limit.ts`

**修正内容**: Upstash Redis INCR+EXPIRE で分散レート制限を実装。
Worker の複数インスタンス間で共有され、再デプロイ時もリセットされない。
Redis 障害時はインメモリにフォールバック。コミット: `779ac1c`

### H6. Supabase service_role key で全 DB 操作 → RLS バイパス

**場所**: `app/worker/src/lib/supabase.ts`, `app/backend/main.py`

全クエリが service_role key を使用し RLS をバイパス。
アプリコードのバグがあれば他ユーザーのデータにアクセス可能。

**修正案**:
- CRUD 操作は anon key + RLS を活用
- service_role はバッチ処理・管理操作のみに限定

### H7. MFA セッショントークンの SHA-256 ハッシュが不十分

**場所**: `app/backend/admin_mfa.py`, `app/worker/src/routes/admin-mfa.ts`

セッショントークンを SHA-256 でハッシュ保存。DB 漏洩時にレインボーテーブル攻撃が可能。

**修正案**: bcrypt または PBKDF2 でハッシュ。

### H8. email 未確認ユーザーが Backend で書き込みアクセス可能

**場所**: `app/backend/auth.py`
**前回**: 2026-02-28 H5

`email_confirmed_at` チェックがあるが、Worker 側の CRUD パスでは未検証の可能性。

**修正案**: Worker の JWT 検証でも `email_confirmed_at` を確認。

---

## MEDIUM（2 週間以内に対応）

### M1. キャッシュポイズニングリスク

**場所**: `app/worker/src/routes/proxy.ts`

キャッシュキーに URL 全体を使用。認証状態がキーに含まれない。
攻撃者がキャッシュを汚染すると他ユーザーに不正データが返る可能性。

**修正案**: キャッシュキーにユーザー ID を含めるか、認証済みレスポンスはキャッシュしない。

### M2. エラーメッセージで情報漏洩

**場所**: 複数のルートファイル

`Trade ${tradeId} not found` のようなエラーで有効な ID を列挙可能。

**修正案**: 認可エラーは全て "Not Found" で統一。

### M3. リクエストサイズ制限なし

**場所**: `app/worker/src/index.ts`

Content-Length 検証がない。大容量ペイロードでメモリ枯渇の可能性。

**修正案**: POST/PATCH で Content-Length 上限（例: 1MB）を検証。

### M4. TOTP 検証ウィンドウが広すぎ

**場所**: `app/worker/src/lib/totp.ts`

`validWindow=1` で前後 30 秒（計 90 秒）を許容。ブルートフォース成功確率が上がる。

### M5. MFA ブルートフォース制限がインメモリのみ

**場所**: `app/backend/admin_mfa.py:64-88`

再起動でリセット。スケールアウト時にバイパス可能。

**修正案**: DB ベースの試行回数記録に変更。

### M6. /health エンドポイントが Supabase 接続状態を漏洩

**場所**: `app/backend/main.py`

認証不要で `"supabase": "connected"` を返却。偵察に利用される。

**修正案**: `"status": "ok"` のみ返却。

### M7. auth_provider 移行時の監査ログ不足

**場所**: `app/backend/auth.py:116-135`

認証プロバイダの変更が `admin_audit_logs` に記録されない。

### M8. 依存パッケージの古いバージョン

**場所**: `app/backend/requirements.txt`

FastAPI 0.109.2（2024 年 1 月）は古い。セキュリティパッチが適用されていない可能性。

**修正案**: FastAPI 0.115+ に更新。cryptography も最新に固定。

### M9. Dockerfile が root で実行

**場所**: `app/backend/Dockerfile`

`USER` ディレクティブがない。コンテナ内で root 実行。

```dockerfile
# 追加すべき行
RUN useradd -m -u 1000 appuser
USER appuser
```

### M10. CI/CD に Supabase URL・プロジェクト ID がハードコード

**場所**: `.github/workflows/deploy.yml`, `app/worker/wrangler.jsonc`

Cloudflare Account ID、GCP プロジェクト番号が平文で記載。
攻撃者がサービスを特定・列挙できる。

---

## LOW（1 ヶ月以内に対応）

### L1. HSTS に `preload` ディレクティブがない

**場所**: `app/worker/src/middleware/security-headers.ts`

`max-age=31536000; includeSubDomains` に `; preload` を追加推奨。

### L2. Content-Security-Policy (CSP) ヘッダーがない

Worker のセキュリティヘッダーに CSP が含まれていない。XSS 防御が不完全。

### L3. Admin IP 制限がない

管理エンドポイントに IP ベースのアクセス制限がない。
CF Access がカバーしているが、多層防御として有効。

### L4. ログのメールアドレス部分露出

**場所**: `app/backend/auth.py`

`email[:3] + "***"` で先頭 3 文字が露出。ハッシュに変更推奨。

### L5. 通常ユーザー操作の監査ログがない

Admin 操作のみログ記録。ユーザーの CRUD 操作は記録されていない。

### L6. Cache-Control ヘッダーが認証済みエンドポイントに未設定

ブラウザやプロキシがセンシティブなレスポンスをキャッシュする可能性。

---

## ドキュメントとの乖離

| 設計書の記載 | 実装の実態 | リスク |
|-------------|-----------|--------|
| 「X-User-Email は廃止済み」 | Admin ダッシュボードでは依然使用中 | 混乱・脆弱性の温床 |
| 「RLS 有効」 | service_role key で全バイパス | RLS が実質無効 |
| 「レート制限 120 req/min」 | インメモリのみ、再起動でリセット | 容易にバイパス |
| 「CSRF: X-Proxy-Secret HMAC 検証」 | 本番でも未設定時は Origin チェックのみ | 防御が不完全 |

---

## 優先対応マトリクス

### 今すぐ（24 時間以内）
| # | 対応 | 工数 |
|---|------|------|
| 1 | C1: JWT アルゴリズム固定 | 2h |
| 2 | C2: JWT issuer 検証を強制 | 1h |
| 3 | C3: キャッシュキーを JWT sub に変更 | 2h |
| 4 | C4: Cloud Run を `--no-allow-unauthenticated` に変更 | 1h |

### 1 週間以内
| # | 対応 | 工数 |
|---|------|------|
| 5 | H2: `/api/auth/check` を本番で無効化 | 30m |
| 6 | H3: 本番で PROXY_SECRET を必須に | 1h |
| 7 | H4: Email ベースのアカウントリンクを削除 | 1h |
| 8 | H6: CRUD を anon key + RLS に切り替え | 4h |
| 9 | M9: Dockerfile に USER 追加 | 15m |

### 2 週間以内
| # | 対応 | 工数 |
|---|------|------|
| ~~10~~ | ~~H5: Upstash Redis で分散レート制限~~ | ✅ 完了 |
| 11 | M1: キャッシュキーにユーザー ID 追加 | 2h |
| 12 | M8: FastAPI 更新 | 1h |
| 13 | M5: MFA 試行回数を DB に記録 | 2h |

---

## 前回監査（2026-02-28）からの改善点

- ✅ Railway → Cloud Run 移行完了（インフラ改善）
- ✅ X-User-Email → JWT 認証への移行（一般ユーザー向け）
- ✅ WIF キーレス認証の導入（CI/CD セキュリティ向上）
- ✅ CRUD の Worker 内処理（攻撃面の削減）
- ❌ Critical 3 件は未修正のまま
