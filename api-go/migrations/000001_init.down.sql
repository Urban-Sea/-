-- Drop triggers
DROP TRIGGER IF EXISTS set_updated_at_weekly_claims ON weekly_claims;
DROP TRIGGER IF EXISTS set_updated_at_users ON users;
DROP TRIGGER IF EXISTS set_updated_at_user_watchlists ON user_watchlists;
DROP TRIGGER IF EXISTS set_updated_at_user_settings ON user_settings;
DROP TRIGGER IF EXISTS set_updated_at_stock_master ON stock_master;
DROP TRIGGER IF EXISTS set_updated_at_srf_usage ON srf_usage;
DROP TRIGGER IF EXISTS set_updated_at_mmf_assets ON mmf_assets;
DROP TRIGGER IF EXISTS set_updated_at_market_indicators ON market_indicators;
DROP TRIGGER IF EXISTS set_updated_at_margin_debt ON margin_debt;
DROP TRIGGER IF EXISTS set_updated_at_interest_rates ON interest_rates;
DROP TRIGGER IF EXISTS set_updated_at_holdings ON holdings;
DROP TRIGGER IF EXISTS set_updated_at_fed_balance_sheet ON fed_balance_sheet;
DROP TRIGGER IF EXISTS set_updated_at_feature_flags ON feature_flags;
DROP TRIGGER IF EXISTS set_updated_at_economic_indicators ON economic_indicators;
DROP TRIGGER IF EXISTS set_updated_at_credit_spreads ON credit_spreads;
DROP TRIGGER IF EXISTS set_updated_at_cash_balances ON cash_balances;
DROP TRIGGER IF EXISTS set_updated_at_bank_sector ON bank_sector;
DROP TRIGGER IF EXISTS set_updated_at_admin_mfa ON admin_mfa;

-- Drop tables (reverse dependency order)
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS economic_indicator_revisions;
DROP TABLE IF EXISTS admin_audit_logs;
DROP TABLE IF EXISTS weekly_claims;
DROP TABLE IF EXISTS user_watchlists;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS stock_cache;
DROP TABLE IF EXISTS srf_usage;
DROP TABLE IF EXISTS precomputed_results;
DROP TABLE IF EXISTS portfolio_snapshots;
DROP TABLE IF EXISTS mmf_assets;
DROP TABLE IF EXISTS market_state_history;
DROP TABLE IF EXISTS market_indicators;
DROP TABLE IF EXISTS margin_debt;
DROP TABLE IF EXISTS manual_inputs;
DROP TABLE IF EXISTS layer_stress_history;
DROP TABLE IF EXISTS interest_rates;
DROP TABLE IF EXISTS holdings;
DROP TABLE IF EXISTS fed_balance_sheet;
DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS economic_indicators;
DROP TABLE IF EXISTS data_revisions;
DROP TABLE IF EXISTS credit_spreads;
DROP TABLE IF EXISTS cash_balances;
DROP TABLE IF EXISTS batch_logs;
DROP TABLE IF EXISTS bank_sector;
DROP TABLE IF EXISTS admin_mfa_sessions;
DROP TABLE IF EXISTS admin_mfa;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS stock_master;

-- Drop function
DROP FUNCTION IF EXISTS update_updated_at();
