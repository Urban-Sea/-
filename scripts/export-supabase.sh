#!/usr/bin/env bash
# =============================================================
# Supabase REST API -> SQL INSERT statements
# =============================================================
# Usage:
#   ./scripts/export-supabase.sh
#
# Requires: curl, jq
# Reads SUPABASE_URL and SUPABASE_KEY from .env
# Output: db/seed/seed_data.sql
# =============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env
if [ -f "$ROOT_DIR/.env" ]; then
    export $(grep -v '^#' "$ROOT_DIR/.env" | grep -v '^$' | xargs)
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_KEY:-}" ]; then
    echo "ERROR: SUPABASE_URL and SUPABASE_KEY must be set in .env"
    exit 1
fi

# Check dependencies
for cmd in curl jq; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: $cmd is required but not installed"
        exit 1
    fi
done

SEED_DIR="$ROOT_DIR/db/seed"
mkdir -p "$SEED_DIR"
OUTPUT="$SEED_DIR/seed_data.sql"

API="${SUPABASE_URL}/rest/v1"
HEADERS=(-H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" -H "Accept: application/json")

# Tables to export (ordered by FK dependencies)
TABLES=(
    users
    user_settings
    holdings
    trades
    cash_balances
    user_watchlists
    portfolio_snapshots
    stock_master
    fed_balance_sheet
    interest_rates
    credit_spreads
    market_indicators
    bank_sector
    srf_usage
    margin_debt
    mmf_assets
    layer_stress_history
    market_state_history
    economic_indicators
    economic_indicator_revisions
    weekly_claims
    manual_inputs
    admin_audit_logs
    admin_mfa
    admin_mfa_sessions
    batch_logs
    feature_flags
    data_revisions
    precomputed_results
    stock_cache
)

echo "-- Seed data exported from Supabase on $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUTPUT"
echo "-- Tables: ${#TABLES[@]}" >> "$OUTPUT"
echo "" >> "$OUTPUT"

for table in "${TABLES[@]}"; do
    echo -n "Exporting $table... "

    # Fetch all rows (Supabase paginates at 1000 by default)
    offset=0
    limit=1000
    total=0

    echo "-- $table" >> "$OUTPUT"

    while true; do
        response=$(curl -s "${API}/${table}?select=*&offset=${offset}&limit=${limit}" "${HEADERS[@]}")

        # Check for error
        if echo "$response" | jq -e '.message' &>/dev/null 2>&1; then
            echo "ERROR: $(echo "$response" | jq -r '.message')"
            echo "-- ERROR exporting $table: $(echo "$response" | jq -r '.message')" >> "$OUTPUT"
            break
        fi

        count=$(echo "$response" | jq 'length')

        if [ "$count" -eq 0 ]; then
            break
        fi

        # Convert JSON rows to INSERT statements
        echo "$response" | jq -r --arg table "$table" '
            def escape_val:
                if . == null then "NULL"
                elif type == "boolean" then (if . then "TRUE" else "FALSE" end)
                elif type == "number" then tostring
                elif type == "array" then "ARRAY[" + (map("$$" + tostring + "$$") | join(",")) + "]::text[]"
                elif type == "object" then "$$" + tojson + "$$::jsonb"
                else "$$" + gsub("\\$\\$"; "$ $") + "$$"
                end;
            .[] |
            "INSERT INTO \($table) (" + (keys_unsorted | join(", ")) + ") VALUES (" + ([.[] | escape_val] | join(", ")) + ") ON CONFLICT DO NOTHING;"
        ' >> "$OUTPUT"

        total=$((total + count))
        offset=$((offset + limit))

        if [ "$count" -lt "$limit" ]; then
            break
        fi
    done

    echo "$total rows"
    echo "" >> "$OUTPUT"
done

echo ""
echo "Done! Output: $OUTPUT"
echo "To load: docker compose exec -T postgres psql -U app open_regime < db/seed/seed_data.sql"
