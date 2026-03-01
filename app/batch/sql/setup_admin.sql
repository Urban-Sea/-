-- =====================================================
-- Admin テーブル: batch_logs, admin_audit_logs, feature_flags
-- 実行: Supabase SQL Editor で実行
-- =====================================================

-- =====================================================
-- 1. batch_logs — バッチ実行ログ
-- =====================================================
CREATE TABLE IF NOT EXISTS batch_logs (
    id SERIAL PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_seconds NUMERIC,
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    details JSONB
);

CREATE INDEX IF NOT EXISTS idx_batch_logs_started
    ON batch_logs (started_at DESC);

ALTER TABLE batch_logs ENABLE ROW LEVEL SECURITY;

-- anon key は SELECT のみ。書き込みは service_role が RLS バイパスするので不要。
CREATE POLICY "batch_logs_select" ON batch_logs
    FOR SELECT USING (true);


-- =====================================================
-- 2. admin_audit_logs — 管理者操作ログ
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id SERIAL PRIMARY KEY,
    admin_user_id TEXT NOT NULL,
    admin_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
    ON admin_audit_logs (created_at DESC);

-- FK カバリングインデックス
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_user_id
    ON admin_audit_logs (admin_user_id);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- anon key は SELECT のみ。書き込みは service_role が RLS バイパスするので不要。
CREATE POLICY "audit_logs_select" ON admin_audit_logs
    FOR SELECT USING (true);


-- =====================================================
-- 3. feature_flags — 機能フラグ
-- =====================================================
CREATE TABLE IF NOT EXISTS feature_flags (
    id SERIAL PRIMARY KEY,
    flag_key TEXT NOT NULL UNIQUE,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- anon key は SELECT のみ。書き込みは service_role が RLS バイパスするので不要。
CREATE POLICY "feature_flags_select" ON feature_flags
    FOR SELECT USING (true);
