-- ============================================================
-- RLS ポリシーなしテーブルに明示的 deny ポリシー追加
-- ============================================================
-- service_role のみアクセスするテーブル。
-- ポリシーなし = 暗黙の全拒否だが、明示的にして linter 警告を解消。

CREATE POLICY "deny_all" ON admin_mfa
    FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_all" ON admin_mfa_sessions
    FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_all" ON cash_balances
    FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_all" ON portfolio_snapshots
    FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_all" ON users
    FOR ALL USING (false) WITH CHECK (false);

-- 確認
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('admin_mfa', 'admin_mfa_sessions', 'cash_balances', 'portfolio_snapshots', 'users')
ORDER BY tablename;
