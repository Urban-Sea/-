-- ============================================================
-- Admin MFA (TOTP) テーブル
-- Supabase SQL Editor で実行してください
-- ============================================================

-- 1. admin_mfa: TOTP シークレット管理
CREATE TABLE IF NOT EXISTS admin_mfa (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL UNIQUE,
    secret_enc  TEXT NOT NULL,          -- 暗号化された TOTP シークレット
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: service_role のみアクセス（フロントエンドから直接アクセス不可）
ALTER TABLE admin_mfa ENABLE ROW LEVEL SECURITY;
-- anon/authenticated ユーザーには一切アクセスさせない
-- Backend は service_role キーで RLS をバイパスする
CREATE POLICY "deny_all" ON admin_mfa
    FOR ALL USING (false) WITH CHECK (false);

-- 2. admin_mfa_sessions: MFA セッショントークン管理
CREATE TABLE IF NOT EXISTS admin_mfa_sessions (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL,
    token_hash  TEXT NOT NULL,           -- SHA-256 ハッシュ
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_sessions_user
    ON admin_mfa_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_admin_mfa_sessions_hash
    ON admin_mfa_sessions (token_hash);

-- RLS: service_role のみ
ALTER TABLE admin_mfa_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON admin_mfa_sessions
    FOR ALL USING (false) WITH CHECK (false);

-- 期限切れセッション自動クリーンアップ用（オプション: pg_cron で定期実行）
-- DELETE FROM admin_mfa_sessions WHERE expires_at < NOW();
