#!/usr/bin/env bash
# รัน migration + seed + DB tests บน Postgres เปล่า (ไม่ต้องใช้ Supabase CLI)
#   PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-workingrun_test}"
P=(psql -v ON_ERROR_STOP=1 -q -X)
"${P[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${P[@]}" -d "$DB" -f tests/00_local_supabase_shim.sql 2>/dev/null
for f in migrations/*.sql; do "${P[@]}" -d "$DB" -f "$f"; done
"${P[@]}" -d "$DB" -f seed.sql > /dev/null
"${P[@]}" -d "$DB" -f tests/01_business_rules.sql
