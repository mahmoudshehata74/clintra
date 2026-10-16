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

Two more, same reason, same pattern — one role per provisioning function,
sized by exposure (`docs/rls.md`'s "One role per provisioning function"):
`clintra_mint` owns `mint_activation_code(jsonb)` (CLI-only, same as
`clintra_provision`); `clintra_register` owns `register_device(jsonb)` —
the one callable by `clintra_app` itself, from a live unauthenticated HTTP
request, so it's granted only the narrow, column-exact privileges that
function's body actually uses. Needed in every environment including
production, same as `clintra_provision`.

```sql
CREATE ROLE clintra_mint NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE clintra_register NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT clintra_mint TO clintra_owner;
GRANT clintra_register TO clintra_owner;
\c clintra
GRANT CREATE ON SCHEMA public TO clintra_mint;
GRANT CREATE ON SCHEMA public TO clintra_register;
```

One more, same pattern: `clintra_staff` owns `add_staff_member(jsonb)`,
which `clintra_app` calls from the authenticated `POST /api/staff` (an
owner adding a staff member — `docs/rls.md`'s "Adding staff"). Like
`clintra_register`, it holds only the column-exact privileges that
function's body uses. Needed in every environment including production.

```sql
CREATE ROLE clintra_staff NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT clintra_staff TO clintra_owner;
\c clintra
GRANT CREATE ON SCHEMA public TO clintra_staff;
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
GRANT CREATE ON SCHEMA public TO clintra_mint;
GRANT CREATE ON SCHEMA public TO clintra_register;
GRANT CREATE ON SCHEMA public TO clintra_staff;
GRANT CONNECT ON DATABASE clintra_test TO clintra_app;
GRANT CONNECT ON DATABASE clintra_test TO clintra_fixtures;
GRANT USAGE ON SCHEMA public TO clintra_fixtures;
ALTER DEFAULT PRIVILEGES FOR ROLE clintra_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clintra_fixtures;
```

```
DB_DATABASE=clintra_test php artisan migrate --database=pgsql_owner
```

### Fresh local setup

On an empty PostgreSQL 16 server (a fresh install, say), the quickest way to
reach exactly the state CI builds is one SQL file run once as the
`postgres` superuser. `.github/workflows/ci.yml`'s "Provision Postgres roles
and databases" step is the source of truth for its contents; this file
second.

1. Write the file **outside the repository** (it holds passwords), e.g.
   `%TEMP%\clintra-local-setup.sql`, with, in order:
   - `CREATE ROLE` for every role CI creates, with the same attributes:
     `clintra_owner` and `clintra_app` (`LOGIN`), `clintra_rls`,
     `clintra_provision`, `clintra_mint`, `clintra_register`,
     `clintra_staff` (`NOLOGIN BYPASSRLS`), and the local-only
     `clintra_fixtures` (`LOGIN BYPASSRLS`) — all `NOSUPERUSER NOCREATEDB
     NOCREATEROLE`. The `LOGIN` roles take the passwords already in `.env`
     (`DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `DB_FIXTURES_PASSWORD`).
   - `GRANT` each of the five `NOLOGIN` roles `TO clintra_owner`.
   - For `clintra` and then `clintra_test`: `CREATE DATABASE … OWNER
     clintra_owner`, `\connect` to it, then the same per-database lines as
     CI — schema owner, `USAGE` for `clintra_app`, `CREATE ON SCHEMA public`
     for each of the five `NOLOGIN` roles, `CONNECT` for `clintra_app` and
     `clintra_fixtures`, `USAGE` for `clintra_fixtures`, and the default
     privileges for `clintra_fixtures`.
   No `BEGIN`/`COMMIT` around it: `CREATE DATABASE` cannot run in a
   transaction.
2. Run it, entering the `postgres` password when asked:
   `psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -f <file>`
3. Delete the file.
4. Check, as `clintra_owner` (no superuser needed): every role exists with
   its attributes, `clintra_owner` is a member of the five `NOLOGIN` roles,
   both databases exist.
5. Migrate and test:

```
php artisan migrate --database=pgsql_owner
DB_DATABASE=clintra_test php artisan migrate:fresh --database=pgsql_owner
DB_DATABASE=clintra_test php artisan migrate:fresh --database=pgsql_owner
php artisan test
```

`migrate:fresh` runs twice on purpose, as in CI ("migrate:fresh is
idempotent" in `docs/rls.md`), and only ever against `clintra_test` — never
against the dev database.

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

## Provisioning the first organization

```
php artisan clintra:provision
```

Prompts for org/location/doctor details and a PIN, then prints the created
ids and a one-time activation code — write it down, it is never shown
again. A device activates against it via `POST /api/devices/register`
(phone + activation code + a client-generated `device_id`), which returns
a Sanctum token plus the org's locations/practitioners/memberships. See
`docs/auth-plan.md`'s registration credential resolution and
`api/docs/rls.md`'s "Provisioning"/"Registration" sections for the full
reasoning.

**Run `clintra:provision` on the Linux server (or in WSL), in a UTF-8
shell.** The clinic, location and doctor names are usually Arabic, and a
Windows console reads the answers in its OEM code page, which has no
Arabic: the names are stored garbled, with no error (`docs/bug-hunt.md`,
A-07). Check with `locale` that the shell's charmap is UTF-8 before
answering the prompts.

Devices get replaced — mint a fresh code for an existing org with:

```
php artisan clintra:mint-activation-code {org_id} {location_id}
```

A device that's lost or stolen must stop reading the clinic's data —
revoke it with:

```
php artisan clintra:revoke-device {device_id}
```

Deletes the device's Sanctum token(s) and marks it permanently unusable;
its very next request fails authentication regardless of whether it still
holds the plaintext token. Safe to re-run against an already-revoked
device — it reports the existing revocation rather than erroring.

## Conventions
- IDs are UUID v4, always generated on the client — Laravel never generates
  its own (`config('app.client_generated_ids')`).
- Money is integer piastres, never floats.
- Timezone is `Africa/Cairo`; locale is `ar` with `en` fallback.
- Auth is Sanctum device tokens, not sessions.
- Every response is JSON — there are no HTML error pages.

## Cross-origin access

The web app is a separate deployment from this API — set
`CORS_ALLOWED_ORIGINS` (`.env`, comma-separated) to its real origin(s).
`http://localhost:5173`/`http://127.0.0.1:5173` (Vite's dev server) are
always allowed on top of that. See `config/cors.php` for why
`allowed_headers` lists `Authorization` explicitly rather than `*` — the
CORS spec's wildcard never covers that header. Full deployment picture,
including running this behind a reverse proxy, is in
`docs/deployment.md`.

## Tests

```
php artisan test
```
