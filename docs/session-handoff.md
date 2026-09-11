# Session handoff

## Phase
v1 web app (React + Vite PWA, offline-first, IndexedDB via Dexie), shipped:
day screen (slots + queue), booking sheet, invoice/payment/receipt, audit
sheet, day sheet, Playwright e2e + screenshot layer, Layer 1 device
identity, Layer 2 staff PIN + lock screen, owner-scoped settings.

Plus, new this session: the Laravel API's foundation is real. `api/`
scaffolded (commit `81ecfb8`), then the full Postgres schema and row-level
isolation landed (commit `288c7b9`) — every table from `docs/schema.md`
(v1 through v11 additions), `FORCE ROW LEVEL SECURITY` on all of them, and
working policies. No real entity endpoints exist yet; the web app still
ships against `FakeTransport`, untouched.

## Last commit
`288c7b9` — feat(api): postgres schema and row-level isolation.

## The three-role model
`clintra_owner` owns every table and is the only role migrations run as
(`php artisan migrate --database=pgsql_owner`). `clintra_app` is what
Laravel connects as at request time (`DB_CONNECTION` default) and owns
nothing, so RLS always applies to it. A third role, `clintra_rls`
(NOLOGIN, `BYPASSRLS`), exists only because the RLS helper functions
(`current_org()`, `allowed_locations()`, `allowed_practitioners()`) need to
read `memberships`/`locations`/`practitioners` — tables that are
themselves RLS-protected by policies depending on those same functions.
That's a real circular dependency; `clintra_rls` breaks it via
`SECURITY DEFINER` functions it owns, while `clintra_owner` and
`clintra_app` both stay fully RLS-bound for every direct query. Full
model, the three RLS traps defended against, and the "add a new table"
checklist: `api/docs/rls.md`.

## Open WIP / deferred
- No entity endpoints (patients, visits, invoices, ...) — that's the next
  phase after auth.
- Real device registration + staff PIN auth via Sanctum not built. Web's
  existing Layer 1/Layer 2 auth is local-only (IndexedDB), unrelated to
  the API's Sanctum scaffold.
- `contract/` does not exist yet. The visit status state machine lives only
  in `web/src/domain/transitions.ts` — not yet duplicated/shared with the
  API, so nothing stops the two from drifting apart.

## Gotchas any future session must know

### Web / local store (carried over)
- `?seedDay=1` pins the screen to a fixed past Monday, but new rows are
  stamped with the real now — so audit/day-scoped views look empty for
  freshly-created rows under seedDay. Use `/` (no seedDay) when reading
  back today's writes.
- Vercel Root Directory must be `web`, not the repo root.
- `resolveActingMembership()` THROWS when no PIN session is active — no
  fallback in production. `src/test/setupIndexedDb.ts` registers a
  test-actor resolver for unit tests; a real session is set via
  `auth/session.ts`.
- `src/auth/devPins.ts` holds the dev seed PINs (assistant 1234, owner
  5678). DELETE it (and its seed/e2e uses) when the real setup flow ships.
- The overbook uniqueness field is `visits.unique_scheduled_at` — derived,
  only ever set/removed by the visit write helpers. Never assign by hand.
- e2e: `pnpm exec playwright test` does NOT rebuild; run `pnpm --dir web
  test:e2e` (builds first) or `pnpm --dir web build` before.
- Dexie `useLiveQuery` async-then-`.filter()` queriers may not re-emit; use
  the plain `() => db.table.toArray()` querier and filter in render.
- Digits are Western everywhere (Decision B); money via
  `formatPiastresForDisplay`, phone via `domain/phone` (E.164).

### API / Postgres (new this session)
- Isolation is carried via `set_config('app.membership_id', ?, true)`,
  never a literal `SET LOCAL app.membership_id = ?` with a bound
  parameter — Postgres treats `SET` as a utility statement and rejects a
  placeholder there ("syntax error at or near $1"), confirmed by testing.
  `set_config()`'s third argument (`is_local => true`) is exactly as
  transaction-scoped as `SET LOCAL`. See `App\Support\DatabaseSession`.
- Self-referencing foreign keys (`visits.rescheduled_from`,
  `care_plan_items.depends_on_item_id`) cannot be added in the same
  `Schema::create()` blueprint as the primary key — Laravel's Postgres
  grammar adds `PRIMARY KEY` *after* foreign keys, so a self-FK in the same
  batch fails ("no unique constraint matching given keys"). Both are added
  via a second `Schema::table()` call, after the table (and its primary
  key) already exists.
- `personal_access_tokens` uses `uuidMorphs('tokenable')`, not `morphs()` —
  our `User` model has a uuid primary key. `password_reset_tokens` was
  dropped entirely (Clintra has no password-based login; device + PIN per
  membership only). `sessions` was kept (the default `web` middleware
  group still starts one).
- `users.phone` is globally unique; `users` has no `org_id` column at all
  (a user's organizations are its memberships) — this matches
  `docs/schema.md`'s v4 additions, which deliberately supersedes the older
  CLI brief's `UNIQUE (org_id, phone)` line.
- Migrations always run with `--database=pgsql_owner`
  (`php artisan migrate --database=pgsql_owner`). The app's default
  connection (`php artisan serve`, everyday queries) is `clintra_app` and
  cannot create or alter tables — it doesn't have `CREATE` on the schema.
- `payments`, `cash_close`, and `day_state` have no `org_id` column in
  `docs/schema.md` — only `location_id` (and `practitioner_id` for
  `day_state`). Their RLS policies scope on `location_id` through
  `allowed_locations()`, which is itself already org-scoped, so this is
  not a weaker isolation guarantee than the org_id+location_id tables.
- Local `psql` sessions use a `.pgpass` file kept outside the repo (in the
  session scratchpad, not committed) — never pass a password in a Bash
  command string; the harness flags that as credential exposure, correctly.
  Generate a new `.pgpass` locally if you need direct `psql` access again.
- `pdo_pgsql`/`pgsql` PHP extensions had to be enabled in this machine's
  `php.ini` (were present but commented out) — a local environment change,
  not part of the repo, but needed for `artisan migrate` to work at all
  here.

## Known gaps (deferred on purpose, not bugs to fix reflexively)
- `ApplyMembership` (`app/Http/Middleware`) trusts a client-supplied
  `X-Membership-Id` header. This is an explicit, commented TODO bridge —
  it MUST be replaced by reading the membership from the authenticated
  Sanctum token before this API is reachable from anywhere but local dev.
- `bootstrap/app.php`'s generic `Throwable` exception handler checks
  `method_exists($e, 'getStatusCode')` to pick a status code, defaulting to
  500 otherwise. Neither `ValidationException` nor `AuthenticationException`
  has that method, so both currently render as a generic 500 `server_error`
  instead of 422/401 with any useful detail. No validation or auth
  endpoints exist yet, so this hasn't bitten anything — but it will need a
  real case for at least those two exception types before endpoints ship.
- The five RLS verification checks from the schema commit are now automated
  (Pest, `api/tests/Feature/Rls`) and run in CI — see the next bullet for
  what building that suite found and fixed. `php artisan test` uses Pest
  (`pestphp/pest` + `pestphp/pest-plugin-laravel`) against a separate,
  already-migrated `clintra_test` database (`api/README.md`), never the dev
  database, via a fourth Postgres role (`clintra_fixtures`, `BYPASSRLS`,
  test-only — see `api/docs/rls.md`).
- Building that suite found a real cross-tenant hole:
  `specialty_templates`/`form_definitions`' original policies used one
  expression for both `USING` and `WITH CHECK`
  (`org_id = current_org() OR org_id IS NULL`), so any org's membership
  could read AND write (`INSERT`/`UPDATE`/`DELETE`) system-wide rows, not
  just its own org's. Fixed by
  `2026_09_11_170030_split_specialty_template_write_policies.php` (see
  `api/docs/rls.md`'s "A worked failure" section) — but the fix means
  `clintra_app` now has **no path at all** to write an `org_id IS NULL` row.
  Seeding system-wide reference data (e.g. the "general" specialty
  template every v1 practitioner points at, per `docs/schema.md`) needs a
  separate, owner-run bootstrap step that does not exist yet. Nothing seeds
  it today, so this hasn't bitten anything yet — but the first real
  `practitioners` endpoint will need that bootstrap in place first.
- `contract/` (OpenAPI + shared enums, per the CLI brief's repo layout)
  does not exist. The visit state machine is defined once, in
  `web/src/domain/transitions.ts`, and nowhere else — the API has no
  independent copy to enforce or drift against yet.

## Verify
Web: `pnpm --dir web test` · `pnpm exec tsc -b --noEmit` · `pnpm --dir web
build` · `pnpm --dir web test:e2e`. API: `cd api && composer install`,
`php artisan migrate --database=pgsql_owner`, `php artisan test`,
`./vendor/bin/pint --test`. `php artisan test` needs the separate
`clintra_test` database set up per `api/README.md` first (one-time, local
only — CI provisions it itself). CI has four jobs: `build`, `e2e`, `api`
(spins up a throwaway `postgres:16` service, provisions all four roles and
both databases, runs migrations against both, then the test suite —
`api/tests/Feature/Rls` is what actually verifies isolation now, not a
manual exercise).

## Next task
Phase 3 — device registration + staff PIN auth via Sanctum, plus one real
endpoint as proof the whole stack (RLS included) works end to end.
