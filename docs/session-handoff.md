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
  `api/docs/rls.md`'s "A worked failure" section) — but the fix meant
  `clintra_app` had no path at all left to write an `org_id IS NULL` row,
  which needed its own bootstrap. **That bootstrap now exists**: `contract/`
  (new, see below) plus two more migrations
  (`2026_09_11_170031_add_owner_reference_data_policies.php`,
  `2026_09_11_170032_seed_reference_data.php`) — a narrow, `clintra_owner`-
  only policy restricted to `org_id IS NULL` rows, and an idempotent upsert
  from `contract/reference-data.json`. See `api/docs/rls.md`'s "Owner-only
  policies for system-wide reference data".
- `contract/` now exists, but only `reference-data.json` (the fixed ids for
  v1's one system-wide reference row set) + `README.md` — not the OpenAPI
  spec or shared enums the CLI brief's repo layout also describes for this
  directory. The visit state machine is still defined once, in
  `web/src/domain/transitions.ts`, with no independent API copy to enforce
  or drift against — unchanged, still open.
- `web/src/db/seed.ts` used to generate a random UUID for the "general"
  `specialty_templates`/`form_definitions` rows on every device — two
  devices' "general" rows had different ids, so `practitioners.specialty_id`
  and `visit_form_data.form_definition_id` pointed at ids that would never
  match a row on the server; sync would have failed on those FKs the moment
  it tried to push either table. Fixed: `seed.ts` now imports the fixed ids
  from `contract/reference-data.json` (via `web/src/domain/referenceData.ts`,
  a thin re-export — `web/tsconfig.app.json` gained `resolveJsonModule` for
  this). Confirmed: the Vercel build (Root Directory `web/`) can read a
  file outside `web/` — commit `3b05c83`'s deploy completed successfully
  reading `contract/reference-data.json`. Re-verify this if Vercel's
  project settings ever change (e.g. a "skip files outside Root Directory"
  toggle), since `web/`'s own build has no way to assert it from inside
  CI. No migration exists (or is needed) for a device that already seeded
  the old random-id
  row: no clinic is live on this app yet, so there is no real data to
  reconcile — but the first sync implementation must not assume every
  device's local "general" row already has the contract id.
- **Closed**: creating the very first organization + owner membership was
  impossible through `clintra_app` or `clintra_owner` (both fully
  RLS-bound). Fixed by a fifth role, `clintra_provision` (`NOLOGIN`,
  `BYPASSRLS`, needed in every environment including production — see
  `api/README.md`), owning one `SECURITY DEFINER` function,
  `provision_organization(jsonb)`
  (`2026_09_11_170033_add_organization_provisioning.php`). It creates an
  org, its first location, the owner's user row (or reuses one by phone),
  a practitioner, the `practitioner_locations` link, the owner membership,
  and an `audit_log` row per created row, atomically. `EXECUTE` is revoked
  from `PUBLIC` and granted only to `clintra_owner` — never `clintra_app`.
  The install-team flow's backend is `php artisan clintra:provision`
  (`App\Console\Commands\ProvisionOrganization`), which prompts for org/
  location/doctor details + a PIN, generates every id itself (the install
  tool acting as a client), and calls the function once. Full reasoning —
  why a function and not `SET ROLE` from PHP, and the
  `REVOKE EXECUTE FROM PUBLIC` trap — in `api/docs/rls.md`'s "Provisioning:
  the one door into an empty database".
- The owner-only reference-data `SELECT` policy added two sessions ago
  (`specialty_templates`/`form_definitions`, restricted to `org_id IS
  NULL`) means `clintra_owner` is no longer "sees zero rows with no
  membership" across *every* table without qualification — it still is for
  every ordinary, tenant-scoped table, but it now sees system-wide
  reference rows regardless of membership, by design. Made explicit in
  `tests/Feature/Rls/OwnerBlockedWithoutMembershipTest.php` (two tests now,
  not one) rather than silently narrowing the old test's table list.
- PIN hashing is now shared, byte-for-byte, between web and the API: both
  read the same Argon2id parameters from `contract/pin-hash.json` (web via
  `web/src/auth/pinHashParams.ts`, a thin re-export; the API via
  `App\Support\PinHash`, `sodium_crypto_pwhash(...,
  SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13)` — not `password_hash()`). Verified,
  not assumed: computed a real test vector with the web's `@noble/hashes`
  implementation, reproduced it byte-identical in PHP, and pinned it in
  `contract/pin-hash.json`'s `testVector`, asserted by both
  `web/src/auth/pinHash.test.ts` and `api/tests/Feature/PinHashTest.php`.
- `App\Support\EgyptianPhone` ports `web/src/domain/phone.ts`'s
  `normalizeEgyptianPhone` classification rules to PHP — the *code* isn't
  shared (one runs in a browser, one in a console command), but the *test
  cases* now are: `contract/phone-cases.json`, iterated by both
  `web/src/domain/phone.test.ts` and `api/tests/Feature/EgyptianPhoneTest.php`.
- `provision_organization(jsonb)` — the schema's one `BYPASSRLS` function —
  now validates its own payload before any write, rather than trusting
  `clintra:provision` (PHP) to have gotten it right:
  `2026_09_12_000001_validate_provision_organization_payload.php`. Checks
  every required key, rejects unknown ones, enforces the `pin_hash`/
  `pin_salt` shape, E.164 phones, a real system-wide `specialty_id`, and no
  cross-org `org_id` smuggling across the sub-entities it creates — all via
  SQLSTATE `22023`, distinct from RLS's `42501`. Two invariants that used
  to be hardcoded literals (`role`/`location_scope`/`practitioner_scope`;
  every sub-entity's `org_id`) are now payload fields the function checks
  rather than assumes — not a new capability, a trap for a future caller
  that assumes otherwise. One real bug found while writing this: the jsonb
  `?` (key-exists) operator is textually indistinguishable from a PDO
  positional placeholder to Laravel's pgsql driver, which silently rewrote
  it to a bare `$1` with nothing bound — fixed by using `jsonb_exists()`
  instead, which contains no `?` at all. `api/tests/Feature/Rls/ProvisionOrganizationValidationTest.php`
  has one test per rule, each calling the function directly with a
  malformed payload.
- **Windows/Git-Bash gotcha, not a code bug**: piping answers into
  `clintra:provision` via stdin (e.g. `printf '...' | php artisan
  clintra:provision`) hangs forever at the first `secret()` (hidden PIN)
  prompt in this environment — `Command::secret()`'s hidden-input handling
  doesn't consume piped, non-TTY input correctly here, so every retry sees
  an empty answer. Discovered by actually running the command by hand
  outside Pest, which hung indefinitely until the process was killed. Real
  interactive terminals are unaffected; Pest's `expectsQuestion()` (used by
  `tests/Feature/Rls/ProvisioningTest.php`) doesn't go through real stdin
  either, so it's unaffected too. Hardened anyway: both prompt loops
  (`promptForPhone`, `promptForPin`) now cap retries at 5 attempts and
  raise a clear error, rather than looping forever regardless of cause.

## Verify
Web: `pnpm --dir web test` · `pnpm exec tsc -b --noEmit` · `pnpm --dir web
build` · `pnpm --dir web test:e2e`. API: `cd api && composer install`,
`php artisan migrate --database=pgsql_owner`, `php artisan test`,
`./vendor/bin/pint --test`. `php artisan test` needs the separate
`clintra_test` database set up per `api/README.md` first (one-time, local
only — CI provisions it itself). CI has four jobs: `build`, `e2e`, `api`
(spins up a throwaway `postgres:16` service, provisions all five roles and
both databases, runs migrations against both, then the test suite —
`api/tests/Feature/Rls` is what actually verifies isolation now, not a
manual exercise).

## Next task
Device registration + Sanctum token issuance + PIN login against the API
— the very first real request path that turns a provisioned membership
(now provisionable, see above) into an authenticated `X-Membership-Id`-free
session. `ApplyMembership`'s client-supplied header is still the known,
commented bridge this replaces (see "Known gaps" above).
