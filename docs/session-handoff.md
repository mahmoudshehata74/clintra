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
`fix(api): one role per provisioning function` (this commit) — the grants
audit in the previous commit found that `register_device` (internet-facing)
shared its owner role with two CLI-only functions, inheriting privileges
it never needed. Split into three roles, one per function, sized by
exposure. See "Known gaps" below for the full writeup.

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

Since named "the three-role model," provisioning has grown three roles of
its own — `clintra_provision`, `clintra_mint`, `clintra_register`, one per
provisioning function, sized by exposure (see the "Known gaps" bullet
below and `api/docs/rls.md`'s "One role per provisioning function") — plus
`clintra_fixtures`, test-only. Seven roles total now; this section's name
is legacy, not a claim about the current count.

## Open WIP / deferred
- No entity endpoints (patients, visits, invoices, ...) — that's the next
  phase after auth.
- **Device registration + token issuance is now built** (API side —
  `POST /api/devices/register`, see "Known gaps" below for the full
  writeup). Web's existing Layer 1/Layer 2 auth is still local-only
  (IndexedDB); nothing on the web side calls this endpoint yet — that's
  the next task.
- `contract/` now exists (`reference-data.json`, `pin-hash.json`,
  `phone-cases.json`). The visit status state machine still lives only in
  `web/src/domain/transitions.ts` — not yet duplicated/shared with the
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
- **Closed**: `ApplyMembership` no longer trusts a client-supplied
  `X-Membership-Id` header except when `APP_ENV` is literally `local`
  (checked in the middleware itself, not config — see the device
  registration bullet below). The membership now comes from an
  authenticated device's Sanctum-format bearer token in every other
  environment.
- **Closed**: `bootstrap/app.php` now renders `ValidationException` as 422
  and `AuthenticationException` as 401, registered before the generic
  `Throwable` handler (which still catches everything else, unchanged).
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
- **Device registration is now real** (API side): `POST /api/devices/register`.
  The registration credential — owner phone + a one-time activation code —
  was a real decision, not an implementation detail: `docs/auth-plan.md`'s
  original Q2 cited the mockup's "mobile + password + clinic code", but
  "password" named no field anywhere and directly contradicted this same
  document's own "no password-based login" line elsewhere. Resolved and
  recorded in `docs/auth-plan.md`'s "Resolution: the registration
  credential" — see it before touching this flow.
  - `docs/schema.md`'s v10 additions: `activation_codes` (new table) and
    `device.membership_id` (new column). Codes are SHA-256-hashed
    (`App\Support\ActivationCode`), never stored in plaintext, single-use,
    expire after 72 hours.
  - Two more `SECURITY DEFINER` doors alongside `provision_organization`:
    `mint_activation_code(jsonb)` (CLI-only, `clintra_owner`, for
    replacement devices — `php artisan clintra:mint-activation-code`) and
    `register_device(jsonb)` (the new one reachable from `clintra_app`
    itself, since it's called from a live, unauthenticated HTTP request).
    Full reasoning for both, and the exact validation/generic-error
    behavior, in `api/docs/rls.md`'s "Registration: the second door"
    section — read it before adding anything that touches either.
  - **The interesting design problem**: Sanctum's `auth:sanctum` guard
    loads a token's tokenable via a plain Eloquent query — but every table
    here (including `device`) carries `FORCE ROW LEVEL SECURITY`, so that
    read would silently return nothing before any membership is known,
    making authentication itself fail. `ApplyMembership` doesn't use
    `auth:sanctum` at all; it verifies the bearer token by hand against
    `personal_access_tokens` (the one auth table with no RLS at all) and
    reads the membership id out of the token's `abilities`
    (`membership:<uuid>`, set at issuance). `App\Models\Device` exists only
    to mint tokens in `App\Http\Controllers\DeviceRegistrationController`;
    nothing ever fetches a `Device` model afterward. Full writeup in
    `api/docs/rls.md`.
  - `tests/Feature/Rls/IsolationProbeHttpTest.php` now authenticates with a
    real token instead of the header; `/api/isolation-probe` also returns
    `visible_organization_ids` now (still verification-only, not a real
    entity endpoint), specifically so a test can prove cross-org isolation
    end to end over HTTP, not just that membership resolution works.
  - Rate-limited by IP and by the submitted code (`RateLimiter`, 5
    attempts / 15 minutes each); the plaintext code and its hash are never
    logged (nothing catches and logs the underlying `QueryException`; the
    controller returns one fixed generic message regardless of which
    check failed) — see `tests/Feature/Rls/DeviceRegistrationTest.php`'s
    log-grep test.
  - **Still open, explicitly out of scope for this step**: no web-side
    caller of this endpoint yet. The web app's own `device`
    IndexedDB table has no `membership_id` column to match the API's v10
    addition — that's the next task's problem, not a bug in what shipped
    here.
- **Registration and token verification, hardened.** The previous bullet's
  two new surfaces — `register_device` and `ApplyMembership`'s hand-rolled
  token check — got a dedicated audit pass. Full writeup in
  `api/docs/rls.md`'s three new "Hardening pass" sections; short version:
  - `clintra_provision`'s actual grants were queried directly
    (`information_schema.role_table_grants`) and confirmed **zero access to
    `patients`/`visits`/`invoices`/`payments`** — the specific hole this
    check was for doesn't exist. Its footprint is still wider than
    `register_device` alone needs, because the role is shared with
    `provision_organization`/`mint_activation_code`; splitting it into
    per-function roles would shrink `register_device`'s blast radius
    further but is a structural change, deferred.
  - `register_device` now validates its own payload before any read/write
    (same shape as `provision_organization`'s validation, one test per
    rule), and single-use was proven atomic under genuine OS-level
    concurrency (`proc_open()` racing two real processes against the same
    activation code — not just a sequential test).
  - Found and fixed a real bug while auditing `ApplyMembership`: a
    malformed bearer token id segment (e.g. `Bearer abc|xyz`) reached a raw
    `WHERE id = 'abc'` query against a bigint column and threw an uncaught
    `QueryException` — a 500, not a 401, leaking the query text under
    `APP_DEBUG=true`. Fixed by validating the id segment is all-digits
    before it reaches a query.
  - Added `device_exists()` (same `SECURITY DEFINER`/`clintra_rls` pattern
    as `current_org()`) so a token whose `device` row was deleted is
    rejected — previously it stayed valid forever, since
    `personal_access_tokens` carries no RLS and nothing else checked the
    device still existed.
  - **The Carbon-into-`insert()`/`update()` timezone bug (below) turned out
    not to be unique** — a full grep found and fixed three more instances
    (`ApplyMembership`'s `last_used_at` update, a test's raw `created_at`
    insert, and several `RlsFixtures` helpers). CI's Postgres service now
    runs under `TZ: America/Los_Angeles` — deliberately neither UTC nor
    Cairo — so this bug class fails loudly by default instead of depending
    on which timezone a fresh container happens to pick.
  - Confirmed a clean, fully-passing test run writes zero lines to the
    Laravel log, and added a test asserting neither a failed nor a
    successful registration ever writes its activation code, token,
    token hash, `pin_hash`/`pin_salt`, or any DB connection password to
    the log.
  - Also fixed, while chasing an unrelated CI-only failure during this
    pass: Laravel boots a fresh `Application` per test method with no
    `RefreshDatabase`, so old PDO connections became GC-pending garbage
    that accumulated across a long test run until Postgres's
    `max_connections` was exhausted. `tests/Pest.php` now calls
    `DB::disconnect()` on all three named connections after every test.
- **Provisioning role split: one role per function, sized by exposure.**
  The grants audit above (`clintra_provision`'s footprint) surfaced a real
  design flaw, not just an untidy one: `clintra_provision` was the shared
  `SECURITY DEFINER` owner of three functions across two trust levels —
  `provision_organization` and `mint_activation_code` (CLI-only) plus
  `register_device` (internet-facing, callable by `clintra_app` from an
  unauthenticated `POST /api/devices/register`). Postgres grants are
  per-role, so a flaw in the internet-facing function would have inherited
  the CLI-only ones' privileges too — `INSERT` on `organizations`,
  `locations`, `practitioners`, `practitioner_locations`, `memberships` —
  an org-and-membership forgery primitive, not just a device one.
  `2026_09_12_000009_split_provisioning_roles.php` splits this into three
  roles — `clintra_provision`, `clintra_mint` (new), `clintra_register`
  (new) — each owning exactly one function, each granted exactly what that
  function's current body reads or writes, nothing granted on the grounds
  it might be needed later. Full grant tables and reasoning:
  `api/docs/rls.md`'s "One role per provisioning function".
  - Two real gaps surfaced while building the new allowlists, both from
    checking function bodies directly rather than assuming from names:
    `mint_activation_code` also needs `memberships` `SELECT` (to find the
    org's active owner for the audit row) — an earlier draft had
    `organizations` instead, which the function never actually reads.
    Both `mint_activation_code` and `register_device` need `SELECT` on
    `audit_log`, not just `INSERT` — every provisioning function computes
    its own next `seq` via `SELECT MAX(seq)`, which is a genuine read even
    though nothing ever `UPDATE`s or `DELETE`s an audit row.
  - `clintra_register` — the new internet-facing role — is the narrowest
    of the three by construction: read-only everywhere except `device`
    (`INSERT`-only) and `activation_codes`, where the `UPDATE` is
    column-restricted to exactly `used_at`/`used_by_device_id`. It also
    lost four grants the shared role used to carry that `register_device`
    never actually reads: `SELECT` on `device` itself, `specialty_templates`,
    `form_definitions`, and `practitioner_locations`.
  - `tests/Feature/Rls/ProvisioningRoleGrantsTest.php` reads
    `information_schema.role_table_grants`/`role_column_grants` directly
    and asserts each role's exact allowlist — it fails the moment a future
    migration grants either new role anything beyond it, regardless of
    that migration's own comment. `tests/Feature/Rls/MintActivationCodeTest.php`
    is new too: `mint_activation_code` had no behavioral test at all before
    this split (only `provision_organization`'s own first-code creation was
    covered), so the split's correctness for that function was previously
    unverified by anything.
  - **Checked, not shipped**: the registration response
    (`register_device`'s bootstrap payload) returns `organization`,
    `locations`, `practitioners`, and `memberships`, but not
    `practitioner_locations` — the practitioner-to-location link. Verified
    this is not currently a gap: no screen in `web/src/` reads
    `practitioner_locations` at all (`web/src/screens/day/DayScreen.tsx`
    and the owner panels list practitioners filtered only by `is_active`,
    never by location), so v1 already behaves as "every active
    practitioner works at every location" regardless of what registration
    returns. The local Dexie schema and `seed.ts` do model and write
    `practitioner_locations`, just never read it back. If a future change
    makes the web app actually location-scope its practitioner list, the
    registration payload gap (and the `clintra_register` grant it would
    need) is a separate, later step — deliberately not added here.

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
The web side of device registration: a real caller of
`POST /api/devices/register` (replacing the seed-based org/location
binding — see `docs/auth-plan.md`'s Layer 1, Q2), plus a
`membership_id` column on the web's own local `device` table to receive
the API's bootstrap response and the token. After that: the first real
entity endpoint (patients/visits/invoices) proving the whole authenticated
+ RLS-scoped stack works end to end for something other than the
isolation probe.
