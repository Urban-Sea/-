-- data_revisions テーブル単体作成用
-- ※ setup_all.sql に含まれているので、通常はそちらを使用

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
CREATE INDEX IF NOT EXISTS idx_data_revisions_direction
    ON data_revisions (direction);

ALTER TABLE data_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON data_revisions FOR SELECT USING (true);
