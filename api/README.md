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
