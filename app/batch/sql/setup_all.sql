-- ============================================================
-- バッチシステム セットアップ SQL
-- ============================================================
-- Supabase SQL Editor にコピペして実行するだけ。
--
-- ポリシー方針:
--   読み取り → anon key で誰でも可 (FOR SELECT)
--   書き込み → service_role key のみ (RLS を自動バイパス)
--   ※ service_role は RLS を無視するので書き込みポリシー不要
--
-- 実行順序:
--   1. このSQL を Supabase SQL Editor で実行
--   2. python app/scripts/migrate_to_supabase.py  (デモデータ投入)
--   3. python app/batch/run.py --full              (最新データ取得 + 修正検知)
-- ============================================================


-- ============================================================
-- 1. data_revisions テーブル（新規作成）
-- ============================================================

CREATE TABLE IF NOT EXISTS data_revisions (
    id            SERIAL PRIMARY KEY,
    table_name    TEXT NOT NULL,
    record_date   DATE NOT NULL,
    column_name   TEXT NOT NULL,
    old_value     DECIMAL,
    new_value     DECIMAL,
    change_amount DECIMAL,
    change_pct    DECIMAL,
    direction     TEXT,
    detected_at   TIMESTAMPTZ DEFAULT NOW(),
    batch_run_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_revisions_table_date
    ON data_revisions (table_name, record_date);
CREATE INDEX IF NOT EXISTS idx_data_revisions_detected
    ON data_revisions (detected_at);
-- direction 単体インデックスはクエリで使用されないため削除済み


-- ============================================================
-- 2. 既存ポリシーを全クリア（ごちゃまぜ解消）
-- ============================================================
-- 一度全部消してから統一ルールで再作成

DO $$
DECLARE
    _tbl TEXT;
    _pol RECORD;
BEGIN
    FOR _tbl IN
        SELECT unnest(ARRAY[
            'fed_balance_sheet', 'interest_rates', 'credit_spreads',
            'market_indicators', 'bank_sector', 'srf_usage',
            'margin_debt', 'mmf_assets', 'layer_stress_history',
            'market_state_history', 'data_revisions',
            'economic_indicators', 'economic_indicator_revisions',
            'weekly_claims'
        ])
    LOOP
        -- テーブルが存在する場合のみ処理
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = _tbl AND table_schema = 'public') THEN
            -- 既存ポリシーを全削除
            FOR _pol IN
                SELECT policyname FROM pg_policies WHERE tablename = _tbl AND schemaname = 'public'
            LOOP
                EXECUTE format('DROP POLICY IF EXISTS %I ON %I', _pol.policyname, _tbl);
            END LOOP;
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 3. RLS 有効化 + 統一ポリシー（SELECT のみ）
-- ============================================================
-- 全テーブル共通:
--   cmd = SELECT のみ → anon key で読み取り可
--   書き込みは service_role key が RLS バイパスするので不要

-- 配管タブ（バッチが書き込み）
ALTER TABLE fed_balance_sheet    ENABLE ROW LEVEL SECURITY;
ALTER TABLE interest_rates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_spreads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_indicators    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_sector          ENABLE ROW LEVEL SECURITY;
ALTER TABLE srf_usage            ENABLE ROW LEVEL SECURITY;
ALTER TABLE margin_debt          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmf_assets           ENABLE ROW LEVEL SECURITY;

-- 派生テーブル
ALTER TABLE layer_stress_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_state_history ENABLE ROW LEVEL SECURITY;

-- 修正追跡
ALTER TABLE data_revisions       ENABLE ROW LEVEL SECURITY;

-- 雇用統計
ALTER TABLE economic_indicators          ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_indicator_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_claims                ENABLE ROW LEVEL SECURITY;

-- ポリシー作成（全て SELECT のみ、命名規則統一）
CREATE POLICY "anon_select" ON fed_balance_sheet    FOR SELECT USING (true);
CREATE POLICY "anon_select" ON interest_rates       FOR SELECT USING (true);
CREATE POLICY "anon_select" ON credit_spreads       FOR SELECT USING (true);
CREATE POLICY "anon_select" ON market_indicators    FOR SELECT USING (true);
CREATE POLICY "anon_select" ON bank_sector          FOR SELECT USING (true);
CREATE POLICY "anon_select" ON srf_usage            FOR SELECT USING (true);
CREATE POLICY "anon_select" ON margin_debt          FOR SELECT USING (true);
CREATE POLICY "anon_select" ON mmf_assets           FOR SELECT USING (true);
CREATE POLICY "anon_select" ON layer_stress_history  FOR SELECT USING (true);
CREATE POLICY "anon_select" ON market_state_history  FOR SELECT USING (true);
CREATE POLICY "anon_select" ON data_revisions        FOR SELECT USING (true);
CREATE POLICY "anon_select" ON economic_indicators          FOR SELECT USING (true);
CREATE POLICY "anon_select" ON economic_indicator_revisions FOR SELECT USING (true);
CREATE POLICY "anon_select" ON weekly_claims                FOR SELECT USING (true);


-- ============================================================
-- 4. 確認クエリ（実行後にこれを走らせて確認）
-- ============================================================
-- 全て cmd = SELECT, policyname = anon_select になっていれば OK

SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'fed_balance_sheet', 'interest_rates', 'credit_spreads',
    'market_indicators', 'bank_sector', 'srf_usage',
    'margin_debt', 'mmf_assets', 'layer_stress_history',
    'market_state_history', 'data_revisions',
    'economic_indicators', 'economic_indicator_revisions',
    'weekly_claims'
  )
ORDER BY tablename;
