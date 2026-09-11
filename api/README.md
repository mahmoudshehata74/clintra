# Clintra API

Laravel backend for Clintra. Standalone JSON API — the web app (and later
Android) are clients of these endpoints, never the source of truth.

## Requirements
- PHP 8.3+ with the `pdo_pgsql` and `pgsql` extensions enabled
- Composer 2.7+
- PostgreSQL 16+

## Database setup

Two Postgres roles, on purpose — see `docs/rls.md` for why. Run this once
per environment, as a superuser (adjust the passwords; `clintra_owner` and
`clintra_app` must be different from each other):

```sql
CREATE ROLE clintra_owner LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE clintra_app LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE clintra_rls NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT clintra_rls TO clintra_owner;

CREATE DATABASE clintra OWNER clintra_owner;
\c clintra
ALTER SCHEMA public OWNER TO clintra_owner;
GRANT USAGE ON SCHEMA public TO clintra_app;
GRANT CREATE ON SCHEMA public TO clintra_rls;
GRANT CONNECT ON DATABASE clintra TO clintra_app;
```

A fourth role, needed in **every** environment including production (unlike
`clintra_fixtures` below, which is local/CI only): `clintra_provision`
(`NOLOGIN`, `BYPASSRLS`) owns `provision_organization(jsonb)`, the one
`SECURITY DEFINER` function that can create the very first organization —
`clintra_app` and `clintra_owner` are both fully RLS-bound and can never
create one themselves. See `docs/rls.md`'s "Provisioning: the one door
into an empty database".

```sql
CREATE ROLE clintra_provision NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT clintra_provision TO clintra_owner;
\c clintra
GRANT CREATE ON SCHEMA public TO clintra_provision;
```

A fourth role, **local and CI only**: the RLS isolation suite
(`tests/Feature/Rls`) needs to insert fixture data (an organization, a
membership, ...) without a membership already in place to grant RLS scope —
something neither `clintra_app` (RLS via `ENABLE`) nor `clintra_owner` (RLS
via `FORCE`) can do. `clintra_fixtures` exists only for that: `BYPASSRLS`,
used exclusively by the test suite's fixtures connection
(`DB_FIXTURES_USERNAME`/`DB_FIXTURES_PASSWORD`, `config/database.php`'s
`pgsql_fixtures`), never by application code. **This role must never be
created in a production environment, and the application must never be
configured to connect as it** — `BYPASSRLS` defeats every guarantee in
`docs/rls.md` outright for whoever holds it. Nothing in `config/database.php`
defaults these credentials to anything; a production `.env` that simply
never sets `DB_FIXTURES_USERNAME`/`DB_FIXTURES_PASSWORD` never has a working
`pgsql_fixtures` connection at all.

```sql
CREATE ROLE clintra_fixtures LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT CONNECT ON DATABASE clintra TO clintra_fixtures;
\c clintra
GRANT USAGE ON SCHEMA public TO clintra_fixtures;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clintra_fixtures;
ALTER DEFAULT PRIVILEGES FOR ROLE clintra_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clintra_fixtures;
```

The `ALTER DEFAULT PRIVILEGES` line means every future table a migration
creates (always as `clintra_owner`) is automatically granted to
`clintra_fixtures` too — no need to touch this setup again when the schema
grows.

### Test database

Tests never run against the dev database — `phpunit.xml` points
`DB_DATABASE` at a separate `clintra_test` database, which needs the same
roles/grants as `clintra` above, then its own migration run. CI provisions
and migrates this same database name (`.github/workflows/ci.yml`); do the
same locally, once:

```sql
CREATE DATABASE clintra_test OWNER clintra_owner;
\c clintra_test
ALTER SCHEMA public OWNER TO clintra_owner;
GRANT USAGE ON SCHEMA public TO clintra_app;
GRANT CREATE ON SCHEMA public TO clintra_rls;
GRANT CREATE ON SCHEMA public TO clintra_provision;
GRANT CONNECT ON DATABASE clintra_test TO clintra_app;
GRANT CONNECT ON DATABASE clintra_test TO clintra_fixtures;
GRANT USAGE ON SCHEMA public TO clintra_fixtures;
ALTER DEFAULT PRIVILEGES FOR ROLE clintra_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clintra_fixtures;
```

```
DB_DATABASE=clintra_test php artisan migrate --database=pgsql_owner
```

## Setup

```
cd api
composer install
cp .env.example .env
php artisan key:generate
```

Fill in `DB_APP_PASSWORD` and `DB_OWNER_PASSWORD` in `.env` with the
passwords you set above, then run migrations as `clintra_owner` — the
normal `php artisan migrate` uses the app's own least-privilege connection
and cannot create tables:

```
php artisan migrate --database=pgsql_owner
php artisan serve
```

The server listens on `http://localhost:8000` by default. Health check:

```
curl http://localhost:8000/api/health
```

## Conventions
- IDs are UUID v4, always generated on the client — Laravel never generates
  its own (`config('app.client_generated_ids')`).
- Money is integer piastres, never floats.
- Timezone is `Africa/Cairo`; locale is `ar` with `en` fallback.
- Auth is Sanctum device tokens, not sessions.
- Every response is JSON — there are no HTML error pages.

## Tests

```
php artisan test
```
