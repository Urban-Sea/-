# セキュリティ修正 TODO

## Batch 1 — ゼロリスク（情報漏洩 / バリデーション追加のみ）
- [x] H3: `/api/auth/check` から jwt_secret_prefix 削除
- [x] L1: holdings cash の `detail=str(e)` を修正
- [x] M4: HoldingUpdate に shares/avg_price のバリデータ追加
- [x] M5: TradeCreate に trade_date の日付形式バリデーション追加
- [x] M6: create_trade で holding_id の所有者チェック追加

## Batch 2 — 低リスク（認証の厳格化、追加チェックのみ）
- [x] C2: JWT issuer 検証を強制（decode に issuer= 追加）
- [x] M3: allowed_algs を token_alg のみに限定
- [x] C1: `kid` ヘッダーの有無でアルゴリズムパス分岐（attacker 制御を排除）

## Batch 3 — 中リスク（Worker 変更）
- [x] C3: per-user エンドポイントのキャッシュを無効化（cache poisoning 排除）
- [x] H2: Authorization ヘッダーは Origin に関係なく常に転送
- [x] M1: 不正 Origin に CORS ヘッダーを返さない

## Batch 4 — DB Linter 指摘修正
- [x] 重複インデックス削除: `idx_audit_logs_created_at`, `idx_batch_logs_started_at`
- [x] FK カバリングインデックス追加: `admin_audit_logs.admin_user_id`, `trades.holding_id`
- [x] `update_updated_at` 関数の search_path 固定
- [x] 過剰 RLS ポリシー削除: `audit_logs_insert`, `batch_logs_insert/update`, `feature_flags_insert/update`
- [x] 未使用インデックス削除: `idx_revisions_date`, `idx_data_revisions_direction`
- [x] セットアップ SQL 整合性修正 (`setup_admin.sql`, `setup_all.sql`)
- [x] RLS ポリシーなしテーブルに deny_all 追加: `admin_mfa`, `admin_mfa_sessions`, `cash_balances`, `portfolio_snapshots`, `users`
- [ ] Supabase Auth: Leaked Password Protection 有効化（Dashboard → Auth → Settings）
