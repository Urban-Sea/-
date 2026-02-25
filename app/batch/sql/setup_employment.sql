-- ============================================================
-- 雇用データ バッチ用セットアップ
-- ============================================================
-- Supabase SQL Editor で実行。
-- テーブルが既に存在する前提で unique constraint を確認・追加。
--
-- 実行後:
--   python app/batch/run.py --employment --verbose
-- ============================================================


-- ============================================================
-- 1. economic_indicators: UNIQUE(indicator, reference_period) 確認
-- ============================================================
-- upsert の conflict key に必要。
-- IF NOT EXISTS がないので DO ブロックで存在チェック。

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'economic_indicators_indicator_reference_period_key'
          AND conrelid = 'public.economic_indicators'::regclass
    ) THEN
        ALTER TABLE economic_indicators
            ADD CONSTRAINT economic_indicators_indicator_reference_period_key
            UNIQUE (indicator, reference_period);
        RAISE NOTICE 'UNIQUE constraint added: economic_indicators(indicator, reference_period)';
    ELSE
        RAISE NOTICE 'UNIQUE constraint already exists: economic_indicators(indicator, reference_period)';
    END IF;
END $$;


-- ============================================================
-- 2. weekly_claims: PRIMARY KEY 確認
-- ============================================================
-- week_ending が PRIMARY KEY なら upsert conflict に使える。

SELECT
    c.column_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage c
    ON c.constraint_name = tc.constraint_name
WHERE tc.table_name = 'weekly_claims'
  AND tc.table_schema = 'public'
ORDER BY tc.constraint_type;


-- ============================================================
-- 3. economic_indicators: constraint 確認
-- ============================================================

SELECT
    c.column_name,
    tc.constraint_type,
    tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage c
    ON c.constraint_name = tc.constraint_name
WHERE tc.table_name = 'economic_indicators'
  AND tc.table_schema = 'public'
ORDER BY tc.constraint_type;
