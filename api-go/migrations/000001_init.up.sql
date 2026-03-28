-- ============================================================
-- Open Regime: Database Schema
-- Generated from Supabase export CSVs
-- ============================================================

-- NOTE: RLS policies are NOT included.
-- Authentication/authorization is handled by api-go middleware.

-- ── Helper function ──

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

-- ── admin_mfa ──

CREATE TABLE admin_mfa (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    secret_enc TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

-- ── admin_mfa_sessions ──

CREATE TABLE admin_mfa_sessions (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── bank_sector ──

CREATE TABLE bank_sector (
    date DATE PRIMARY KEY,
    kre_close NUMERIC,
    kre_52w_high NUMERIC,
    kre_52w_low NUMERIC,
    kre_52w_change NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── batch_logs ──

CREATE TABLE batch_logs (
    id SERIAL PRIMARY KEY,
    job_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    duration_seconds NUMERIC,
    records_processed INTEGER DEFAULT 0,
    error_message TEXT,
    details JSONB
);

-- ── cash_balances ──

CREATE TABLE cash_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    label TEXT NOT NULL,
    currency TEXT DEFAULT 'JPY',
    amount NUMERIC NOT NULL,
    account_type TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── credit_spreads ──

CREATE TABLE credit_spreads (
    date DATE PRIMARY KEY,
    hy_spread NUMERIC,
    ig_spread NUMERIC,
    ted_spread NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── data_revisions ──

CREATE TABLE data_revisions (
    id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_date DATE NOT NULL,
    column_name TEXT NOT NULL,
    old_value NUMERIC,
    new_value NUMERIC,
    change_amount NUMERIC,
    change_pct NUMERIC,
    direction TEXT,
    detected_at TIMESTAMPTZ DEFAULT now(),
    batch_run_id TEXT
);

-- ── economic_indicators ──

CREATE TABLE economic_indicators (
    id SERIAL PRIMARY KEY,
    indicator VARCHAR(50) NOT NULL,
    reference_period DATE NOT NULL,
    current_value NUMERIC,
    revision_count INTEGER DEFAULT 0,
    nfp_change INTEGER,
    u3_rate NUMERIC,
    u6_rate NUMERIC,
    avg_hourly_earnings NUMERIC,
    wage_mom NUMERIC,
    labor_force_participation NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (indicator, reference_period)
);

-- ── feature_flags ──

CREATE TABLE feature_flags (
    id SERIAL PRIMARY KEY,
    flag_key VARCHAR(100) NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (flag_key)
);

-- ── fed_balance_sheet ──

CREATE TABLE fed_balance_sheet (
    date DATE PRIMARY KEY,
    reserves NUMERIC,
    rrp NUMERIC,
    tga NUMERIC,
    soma_assets NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── holdings ──

CREATE TABLE holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    ticker VARCHAR(10) NOT NULL,
    shares NUMERIC NOT NULL,
    avg_price NUMERIC NOT NULL,
    entry_date DATE,
    account_type VARCHAR(20) DEFAULT 'tokutei',
    sector VARCHAR(50),
    regime_at_entry VARCHAR(20),
    rs_at_entry VARCHAR(20),
    fx_rate NUMERIC DEFAULT 150.0,
    target_price NUMERIC,
    stop_loss NUMERIC,
    thesis TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── interest_rates ──

CREATE TABLE interest_rates (
    date DATE PRIMARY KEY,
    fed_funds NUMERIC,
    treasury_2y NUMERIC,
    treasury_10y NUMERIC,
    treasury_spread NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── layer_stress_history ──

CREATE TABLE layer_stress_history (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    layer VARCHAR(20) NOT NULL,
    stress_score NUMERIC NOT NULL,
    components JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (date, layer)
);

-- ── manual_inputs ──

CREATE TABLE manual_inputs (
    id SERIAL PRIMARY KEY,
    metric TEXT NOT NULL,
    reference_date DATE NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (metric, reference_date)
);

-- ── margin_debt ──

CREATE TABLE margin_debt (
    date DATE PRIMARY KEY,
    debit_balance NUMERIC,
    free_credit NUMERIC,
    change_2y NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── market_indicators ──

CREATE TABLE market_indicators (
    date DATE PRIMARY KEY,
    vix NUMERIC,
    dxy NUMERIC,
    sp500 NUMERIC,
    nasdaq NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT now(),
    russell2000 REAL,
    usdjpy NUMERIC
);

-- ── market_state_history ──

CREATE TABLE market_state_history (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    state VARCHAR(50) NOT NULL,
    layer1_stress NUMERIC,
    layer2a_stress NUMERIC,
    layer2b_stress NUMERIC,
    credit_pressure VARCHAR(20),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (date)
);

-- ── mmf_assets ──

CREATE TABLE mmf_assets (
    date DATE PRIMARY KEY,
    total_assets NUMERIC,
    change_3m NUMERIC,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── portfolio_snapshots ──

CREATE TABLE portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    snapshot_date DATE NOT NULL,
    total_market_value_usd NUMERIC NOT NULL,
    total_cost_usd NUMERIC NOT NULL,
    unrealized_pnl_usd NUMERIC NOT NULL,
    cash_usd NUMERIC NOT NULL DEFAULT 0,
    total_assets_usd NUMERIC NOT NULL DEFAULT 0,
    fx_rate_usdjpy NUMERIC,
    holdings_count INTEGER NOT NULL DEFAULT 0,
    holdings_detail JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, snapshot_date)
);

-- ── precomputed_results ──

CREATE TABLE precomputed_results (
    key TEXT PRIMARY KEY,
    result JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── srf_usage ──

CREATE TABLE srf_usage (
    date DATE PRIMARY KEY,
    amount NUMERIC,
    source VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── stock_cache ──

CREATE TABLE stock_cache (
    ticker VARCHAR(30) PRIMARY KEY,
    data JSONB,
    fetched_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT (now() + '00:05:00'::interval)
);

-- ── stock_master ──

CREATE TABLE stock_master (
    ticker VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100),
    sector VARCHAR(50),
    industry VARCHAR(100),
    price_category VARCHAR(20),
    watchlist_category VARCHAR(50),
    market_cap BIGINT,
    exchange VARCHAR(10),
    is_active BOOLEAN DEFAULT true,
    added_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── user_settings ──

CREATE TABLE user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    display_name VARCHAR(50),
    default_account_type VARCHAR(20) DEFAULT 'tokutei',
    theme VARCHAR(20) DEFAULT 'dark',
    default_chart_period VARCHAR(10) DEFAULT '3mo',
    trading_mode VARCHAR(20) DEFAULT 'balanced',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id)
);

-- ── user_watchlists ──

CREATE TABLE user_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    name VARCHAR(50) NOT NULL,
    tickers TEXT[] NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── users ──

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    display_name TEXT,
    stripe_customer_id TEXT,
    plan TEXT DEFAULT 'free',
    auth_provider TEXT DEFAULT 'google',
    auth_provider_id TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    is_active BOOLEAN DEFAULT true,
    UNIQUE (email)
);

-- ── weekly_claims ──

CREATE TABLE weekly_claims (
    week_ending DATE PRIMARY KEY,
    initial_claims INTEGER,
    continued_claims INTEGER,
    initial_claims_4w_avg INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── admin_audit_logs ──

CREATE TABLE admin_audit_logs (
    id SERIAL PRIMARY KEY,
    admin_user_id UUID NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id TEXT,
    old_value JSONB,
    new_value JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ── economic_indicator_revisions ──

CREATE TABLE economic_indicator_revisions (
    id SERIAL PRIMARY KEY,
    indicator_id INTEGER,
    revision_number INTEGER NOT NULL,
    value NUMERIC NOT NULL,
    published_date DATE NOT NULL,
    change_from_prev NUMERIC,
    change_pct_from_prev NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (indicator_id, revision_number)
);

-- ── trades ──

CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    holding_id UUID,
    ticker VARCHAR(10) NOT NULL,
    action VARCHAR(10) NOT NULL,
    shares NUMERIC NOT NULL,
    price NUMERIC NOT NULL,
    fees NUMERIC DEFAULT 0,
    trade_date TIMESTAMPTZ NOT NULL,
    account_type VARCHAR(20),
    regime VARCHAR(20),
    rs_trend VARCHAR(20),
    reason TEXT,
    lessons_learned TEXT,
    profit_loss NUMERIC,
    profit_loss_pct NUMERIC,
    holding_days INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Foreign Keys ──

ALTER TABLE admin_audit_logs ADD CONSTRAINT admin_audit_logs_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES users(id);
ALTER TABLE economic_indicator_revisions ADD CONSTRAINT economic_indicator_revisions_indicator_id_fkey FOREIGN KEY (indicator_id) REFERENCES economic_indicators(id);
ALTER TABLE trades ADD CONSTRAINT trades_holding_id_fkey FOREIGN KEY (holding_id) REFERENCES holdings(id);

-- ── Indexes ──

CREATE INDEX idx_audit_logs_admin_user_id ON admin_audit_logs USING btree (admin_user_id);
CREATE INDEX idx_audit_logs_created ON admin_audit_logs USING btree (created_at DESC);
CREATE INDEX idx_admin_mfa_sessions_hash ON admin_mfa_sessions USING btree (token_hash);
CREATE INDEX idx_admin_mfa_sessions_user ON admin_mfa_sessions USING btree (user_id);
CREATE INDEX idx_batch_logs_started ON batch_logs USING btree (started_at DESC);
CREATE INDEX idx_data_revisions_detected ON data_revisions USING btree (detected_at);
CREATE INDEX idx_data_revisions_table_date ON data_revisions USING btree (table_name, record_date);
CREATE INDEX idx_revisions_indicator ON economic_indicator_revisions USING btree (indicator_id);
CREATE INDEX idx_snapshots_user_date ON portfolio_snapshots USING btree (user_id, snapshot_date DESC);
CREATE INDEX idx_stock_cache_expires ON stock_cache USING btree (expires_at);
CREATE INDEX idx_trades_holding_id ON trades USING btree (holding_id);
CREATE INDEX idx_users_email ON users USING btree (email);

-- ── updated_at triggers ──

CREATE TRIGGER set_updated_at_admin_mfa
    BEFORE UPDATE ON admin_mfa
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_bank_sector
    BEFORE UPDATE ON bank_sector
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_cash_balances
    BEFORE UPDATE ON cash_balances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_credit_spreads
    BEFORE UPDATE ON credit_spreads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_economic_indicators
    BEFORE UPDATE ON economic_indicators
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_feature_flags
    BEFORE UPDATE ON feature_flags
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_fed_balance_sheet
    BEFORE UPDATE ON fed_balance_sheet
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_holdings
    BEFORE UPDATE ON holdings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_interest_rates
    BEFORE UPDATE ON interest_rates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_margin_debt
    BEFORE UPDATE ON margin_debt
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_market_indicators
    BEFORE UPDATE ON market_indicators
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_mmf_assets
    BEFORE UPDATE ON mmf_assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_srf_usage
    BEFORE UPDATE ON srf_usage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_stock_master
    BEFORE UPDATE ON stock_master
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_user_settings
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_user_watchlists
    BEFORE UPDATE ON user_watchlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_users
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_weekly_claims
    BEFORE UPDATE ON weekly_claims
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
