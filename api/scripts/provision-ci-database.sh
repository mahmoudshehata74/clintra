#!/usr/bin/env bash
set -euo pipefail
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_owner LOGIN PASSWORD 'ci_owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;"
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_app LOGIN PASSWORD 'ci_app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;"
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_rls NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;"
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_provision NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;"
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_mint NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;"
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_register NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;"
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_staff NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;"
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;"
psql -h 127.0.0.1 -U postgres -c "CREATE ROLE clintra_fixtures LOGIN PASSWORD 'ci_fixtures_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;"
psql -h 127.0.0.1 -U postgres -c "GRANT clintra_rls TO clintra_owner;"
psql -h 127.0.0.1 -U postgres -c "GRANT clintra_provision TO clintra_owner;"
psql -h 127.0.0.1 -U postgres -c "GRANT clintra_mint TO clintra_owner;"
psql -h 127.0.0.1 -U postgres -c "GRANT clintra_register TO clintra_owner;"
psql -h 127.0.0.1 -U postgres -c "GRANT clintra_staff TO clintra_owner;"
psql -h 127.0.0.1 -U postgres -c "GRANT clintra_auth TO clintra_owner;"

for db in clintra clintra_test; do
  psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE $db OWNER clintra_owner;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "ALTER SCHEMA public OWNER TO clintra_owner;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "GRANT USAGE ON SCHEMA public TO clintra_app;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "GRANT CREATE ON SCHEMA public TO clintra_rls;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "GRANT CREATE ON SCHEMA public TO clintra_provision;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "GRANT CREATE ON SCHEMA public TO clintra_mint;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "GRANT CREATE ON SCHEMA public TO clintra_register;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "GRANT CREATE ON SCHEMA public TO clintra_staff;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "GRANT CREATE ON SCHEMA public TO clintra_auth;"
  psql -h 127.0.0.1 -U postgres -c "GRANT CONNECT ON DATABASE $db TO clintra_app;"
  psql -h 127.0.0.1 -U postgres -c "GRANT CONNECT ON DATABASE $db TO clintra_fixtures;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "GRANT USAGE ON SCHEMA public TO clintra_fixtures;"
  psql -h 127.0.0.1 -U postgres -d "$db" -c "ALTER DEFAULT PRIVILEGES FOR ROLE clintra_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clintra_fixtures;"
  psql -h 127.0.0.1 -U postgres -d "$db" --set=admin_app_password=ci_admin_app_pw -f api/scripts/provision-admin-roles.sql
done
