-- discovered_stocks: finviz Discovery スキャン結果の永続化テーブル
-- Phase B (tools/finviz/ → HTTP POST → DB → フロント表示)

CREATE TABLE IF NOT EXISTS discovered_stocks (
    scan_date        date         NOT NULL,
    ticker           text         NOT NULL,
    presets          text[]       NOT NULL,
    finviz_score     numeric(4,2) NOT NULL,
    fundament        jsonb        NOT NULL DEFAULT '{}',
    created_at       timestamptz  NOT NULL DEFAULT now(),

    -- 後追い検証カラム (Phase B+ で backfill)
    had_signal       boolean,
    signal_grade     text,
    entry_triggered  boolean,
    realized_pnl_pct numeric(6,2),
    outcome_at       timestamptz,

    PRIMARY KEY (scan_date, ticker)
);

CREATE INDEX idx_discovered_score  ON discovered_stocks (scan_date, finviz_score DESC);
CREATE INDEX idx_discovered_ticker ON discovered_stocks (ticker, scan_date DESC);
