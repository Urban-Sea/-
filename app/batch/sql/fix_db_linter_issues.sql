-- ============================================================
-- DB Linter 指摘修正 (2026-02-28)
-- ============================================================
-- Supabase Linter で検出された問題を一括修正。
-- Supabase SQL Editor で実行。
--
-- 修正内容:
--   1. 重複インデックス削除 (admin_audit_logs, batch_logs)
--   2. FK カバリングインデックス追加 (admin_audit_logs, trades)
--   3. update_updated_at 関数の search_path 固定
--   4. 過剰な RLS INSERT ポリシー削除 (admin_audit_logs)
--   5. 未使用インデックス削除 (data_revisions)
--   6. RLS ポリシーなしテーブルに明示的 deny ポリシー追加
-- ============================================================


-- ============================================================
-- 1. 重複インデックス削除
-- ============================================================
-- admin_audit_logs: idx_audit_logs_created と idx_audit_logs_created_at が重複
-- → idx_audit_logs_created_at を削除（idx_audit_logs_created を残す）
DROP INDEX IF EXISTS idx_audit_logs_created_at;

-- batch_logs: idx_batch_logs_started と idx_batch_logs_started_at が重複
-- → idx_batch_logs_started_at を削除（idx_batch_logs_started を残す）
DROP INDEX IF EXISTS idx_batch_logs_started_at;


-- ============================================================
-- 2. FK カバリングインデックス追加
-- ============================================================
-- admin_audit_logs.admin_user_id → FK に対応するインデックスがない
-- JOIN / CASCADE DELETE 時の全件スキャンを回避
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_user_id
    ON admin_audit_logs (admin_user_id);

-- trades.holding_id → FK に対応するインデックスがない
-- holding 削除時の CASCADE / JOIN パフォーマンス改善
CREATE INDEX IF NOT EXISTS idx_trades_holding_id
    ON trades (holding_id);


-- ============================================================
-- 3. update_updated_at 関数の search_path 固定
-- ============================================================
-- Linter: "Function has a mutable search_path"
-- search_path を空文字列に固定し、スキーマ解決を明示的にする
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


-- ============================================================
-- 4. 過剰な RLS INSERT ポリシー削除
-- ============================================================
-- admin_audit_logs の audit_logs_insert は WITH CHECK (true) で無制限。
-- バックエンドは service_role key を使用 → RLS を自動バイパスするので
-- INSERT ポリシー自体が不要。削除して anon key からの INSERT を拒否。
DROP POLICY IF EXISTS "audit_logs_insert" ON admin_audit_logs;

-- batch_logs も同様: INSERT / UPDATE ポリシーが WITH CHECK (true) で無制限。
-- service_role がバイパスするので不要。
DROP POLICY IF EXISTS "batch_logs_insert" ON batch_logs;
DROP POLICY IF EXISTS "batch_logs_update" ON batch_logs;

-- feature_flags も同パターン
DROP POLICY IF EXISTS "feature_flags_insert" ON feature_flags;
DROP POLICY IF EXISTS "feature_flags_update" ON feature_flags;


-- ============================================================
-- 5. 未使用インデックス削除
-- ============================================================
-- idx_audit_logs_created_at は手順1で削除済み

-- data_revisions テーブル
-- idx_revisions_date: 使用されていない
DROP INDEX IF EXISTS idx_revisions_date;

-- idx_data_revisions_direction: direction カラム単体のインデックスは
-- クエリで使われていない（direction は WHERE 条件で稀にしか使わない）
DROP INDEX IF EXISTS idx_data_revisions_direction;


-- ============================================================
-- 6. RLS 有効 + ポリシーなしテーブルに明示的 deny ポリシー追加
-- ============================================================
-- これらのテーブルは service_role key のみでアクセスされる。
-- service_role は RLS を自動バイパスするので、ポリシーの有無に関わらず動作する。
-- ポリシーなし = 暗黙の全拒否だが、明示的 deny ポリシーで意図を明確にする。

-- admin_mfa: TOTP シークレット格納。service_role のみ。
CREATE POLICY "deny_all" ON admin_mfa
    FOR ALL USING (false) WITH CHECK (false);

-- admin_mfa_sessions: MFA セッショントークン。service_role のみ。
CREATE POLICY "deny_all" ON admin_mfa_sessions
    FOR ALL USING (false) WITH CHECK (false);

-- cash_balances: ユーザー現金残高。バックエンドが user_id で所有者フィルタ。
CREATE POLICY "deny_all" ON cash_balances
    FOR ALL USING (false) WITH CHECK (false);

-- portfolio_snapshots: 日次スナップショット。バックエンドが user_id で所有者フィルタ。
CREATE POLICY "deny_all" ON portfolio_snapshots
    FOR ALL USING (false) WITH CHECK (false);

-- users: ユーザーマスタ。認証・プロフィール管理で service_role のみ。
CREATE POLICY "deny_all" ON users
    FOR ALL USING (false) WITH CHECK (false);


-- ============================================================
-- 確認クエリ
-- ============================================================
-- 残るべきインデックス:
--   admin_audit_logs: PK + idx_audit_logs_created + idx_audit_logs_admin_user_id
--   batch_logs: PK + idx_batch_logs_started
--   trades: 既存 + idx_trades_holding_id
--   data_revisions: PK + idx_data_revisions_table_date + idx_data_revisions_detected

SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('admin_audit_logs', 'batch_logs', 'trades', 'data_revisions')
ORDER BY tablename, indexname;

-- RLS ポリシー確認
-- admin テーブル: SELECT のみ
-- service_role only テーブル: deny_all
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'admin_audit_logs', 'batch_logs', 'feature_flags',
    'admin_mfa', 'admin_mfa_sessions',
    'cash_balances', 'portfolio_snapshots', 'users'
  )
ORDER BY tablename, policyname;
