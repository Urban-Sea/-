-- ============================================================
-- RLS 修正: 不足テーブルの RLS 有効化 + ポリシー作成
-- ============================================================
-- setup_all.sql でカバーされていない5テーブルを修正
--
-- ポリシー方針:
--   読み取り専用テーブル → SELECT のみ (anon key)
--   CRUD テーブル → SELECT + INSERT + UPDATE + DELETE (anon key)
--   ※ バックエンドが anon key を使用しているため、全操作を許可
--   ※ Cloudflare Access でアプリ全体のアクセス制御済み
-- ============================================================


-- 0. user_id カラムを uuid → TEXT に変更
-- Cloudflare Access のメールアドレスを user_id として使用するため
-- 先に auth.users への外部キー制約を削除
ALTER TABLE holdings DROP CONSTRAINT IF EXISTS holdings_user_id_fkey;
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_user_id_fkey;
ALTER TABLE holdings ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE trades ALTER COLUMN user_id TYPE TEXT;


-- 1. holdings テーブル
-- 既存の壊れたポリシー（auth.uid()使用、RLS未有効）を修正
DO $$
DECLARE _pol RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'holdings' AND table_schema = 'public') THEN
        FOR _pol IN SELECT policyname FROM pg_policies WHERE tablename = 'holdings' AND schemaname = 'public'
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON holdings', _pol.policyname);
        END LOOP;
    END IF;
END $$;

ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON holdings FOR ALL USING (true) WITH CHECK (true);


-- 2. trades テーブル
DO $$
DECLARE _pol RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trades' AND table_schema = 'public') THEN
        FOR _pol IN SELECT policyname FROM pg_policies WHERE tablename = 'trades' AND schemaname = 'public'
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON trades', _pol.policyname);
        END LOOP;
    END IF;
END $$;

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON trades FOR ALL USING (true) WITH CHECK (true);


-- 3. manual_inputs テーブル（バッチ書き込み + バックエンド読み取り）
DO $$
DECLARE _pol RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manual_inputs' AND table_schema = 'public') THEN
        FOR _pol IN SELECT policyname FROM pg_policies WHERE tablename = 'manual_inputs' AND schemaname = 'public'
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON manual_inputs', _pol.policyname);
        END LOOP;
    END IF;
END $$;

ALTER TABLE manual_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON manual_inputs FOR SELECT USING (true);


-- 4. precomputed_results テーブル（テーブル作成 + RLS）
CREATE TABLE IF NOT EXISTS precomputed_results (
    key TEXT PRIMARY KEY,
    result JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE _pol RECORD;
BEGIN
    FOR _pol IN SELECT policyname FROM pg_policies WHERE tablename = 'precomputed_results' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON precomputed_results', _pol.policyname);
    END LOOP;
END $$;

ALTER TABLE precomputed_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON precomputed_results FOR SELECT USING (true);


-- 5. stock_master テーブル（読み取り専用）
DO $$
DECLARE _pol RECORD;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_master' AND table_schema = 'public') THEN
        FOR _pol IN SELECT policyname FROM pg_policies WHERE tablename = 'stock_master' AND schemaname = 'public'
        LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON stock_master', _pol.policyname);
        END LOOP;
    END IF;
END $$;

ALTER TABLE stock_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON stock_master FOR SELECT USING (true);


-- ============================================================
-- 確認クエリ
-- ============================================================
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('holdings', 'trades', 'manual_inputs', 'precomputed_results', 'stock_master')
ORDER BY tablename;
