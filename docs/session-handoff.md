# Session handoff

## Phase
v1 web app (React + Vite PWA, offline-first, IndexedDB via Dexie) is
feature-complete for the single-clinic flow: day screen (slots + queue),
booking sheet, invoice/payment/receipt, audit sheet, day sheet, owner-scoped
settings, Playwright e2e + screenshot layer, and three auth layers (device
identity, staff PIN + lock screen, idle timeout).

**The API is now complete for v1's sync.** Postgres schema + row-level
isolation, three provisioning doors (`provision_organization`,
`mint_activation_code`, `register_device`), device registration + token
issuance, `POST /api/sync/push`, `GET /api/sync/pull`, server-assigned `rev`
on every syncable table, and `sync_ledger` as the append-only receipt/cursor
source all exist and are tested (`api/tests/Feature/Rls`, CI's `api` job).

**The web app now registers real devices and syncs over HTTP.** Screen 1
(activation) calls `POST /api/devices/register`, bootstraps the local DB
from the response, and stores the token on the local `device` row.
`selectSyncTransport` (`web/src/sync/httpTransport.ts`) switches the running
sync engine to `HttpTransport` the moment that token exists; `FakeTransport`
is still the default with no token, and remains what every test (vitest +
e2e) runs against — nothing in CI talks to a real Postgres from the web
side. The review UI (screen 17 territory, though no such screen exists in
the reference mockup — see below) now resolves both rejection types the
push endpoint can hand back: a stale-rev edit conflict and a lost slot
conflict, per `docs/sync-plan.md`'s Q6/Q7/Q10.

## Last commit
`fix(web): correct sync-review e2e assertion for a legitimately-surviving
op` (`271d204`) — fixed a genuine bug in the previous commit's own e2e test
(`12d6a50`, `feat(web): resolve sync conflicts`), not a flake: the
`discardMine` test asserted zero `sync_ops` rows remained for an entity
after resolution, but the test's own setup does a real, successful booking
first, which legitimately stays in `sync_ops` as already-synced history.
Caught by CI (mobile project), not local runs. Both commits are pushed to
`origin/main`; CI and Vercel are green on `271d204`.

## The three-role model (now seven)
`clintra_owner` owns every table and is the only role migrations run as.
`clintra_app` is the ordinary request-time connection, RLS-bound. A third,
`clintra_rls` (`BYPASSRLS`), breaks the circular dependency the RLS helper
functions (`current_org()`, `allowed_locations()`, etc.) would otherwise
have on the very tables they scope. Four more exist for provisioning, one
per function, sized by exposure: `clintra_provision` (`provision_organization`,
CLI-only), `clintra_mint` (`mint_activation_code`, CLI-only),
`clintra_register` (`register_device`, internet-facing — the narrowest of
the three by construction), and `clintra_fixtures` (test-only, never
production). Full model and grant tables: `api/docs/rls.md`.

## Standing rules earned this session
- **The sync endpoint is accept-or-reject only.** It never mutates a row
  other than the one `entity_id` the op names — except the calling
  device's own `clock_skew_ms`/`clock_skew_observed_at`, which the device
  is recording about itself, not the server rewriting another actor's
  data. (`api/docs/rls.md`, "The sync endpoint is accept-or-reject only".)
- **Closed days are immutable in the database.** Once `day_state.is_closed`
  is `true`, no role — including `BYPASSRLS` roles — can `UPDATE` or
  `DELETE` that row; enforced by a trigger, not an RLS policy, because only
  a trigger binds roles RLS itself doesn't.
- **Audit attribution is enforced in RLS, not application code.**
  `audit_log`'s `WITH CHECK` requires `actor_membership_id =
  current_membership()`; no membership can attribute a write to any other
  membership, even in its own org.
- **Grants and policies must each hold independently.** An `UPDATE`/
  `DELETE` grant with no matching policy is inert today but live the
  instant an unrelated migration adds that policy later — `audit_log` and
  `sync_ledger` had their inert grants revoked outright rather than left
  to rely on the policy layer alone.
- **`contract/` is the only place a hardcoded UUID is allowed**, and only
  for `org_id`-null system-wide reference rows (`contract/reference-data.json`).
  Every other id in the schema is client-generated, per `docs/schema.md`.

## Gotchas that cost real time
- **A bare `Carbon`/`DateTimeInterface` passed straight into `insert()`/
  `update()`** gets formatted as a naive `Y-m-d H:i:s` string with no
  offset; Postgres then interprets it under its own session timezone,
  silently corrupting the value whenever that differs from
  `config('app.timezone')` (`Africa/Cairo`). Fixed everywhere by explicit
  `->toIso8601String()`; CI's Postgres now runs under `TZ:
  America/Los_Angeles` (deliberately neither UTC nor Cairo) so this class
  fails loudly by default instead of depending on a fresh container's
  timezone guess.
- **`SELECT MAX(seq) + 1` is a race, not a counter**, under real
  concurrency: two transactions reading the same max both try to insert
  the same value, and `seq`'s `UNIQUE` constraint rolls back the loser's
  *entire* transaction. Fixed by making `seq` a real Postgres identity
  column (`GENERATED BY DEFAULT AS IDENTITY`) on both `audit_log` and
  `sync_ledger`, proven under genuine OS-level concurrency
  (`proc_open()`), not just sequential assertions.
- **A caught `QueryException` mid-transaction poisons the whole
  transaction**, not just the failed statement — Postgres refuses every
  further statement until a `ROLLBACK`, including the lookups slot-conflict
  resolution needs to run immediately afterward in the same transaction.
  Fixed by wrapping just the risky `INSERT` in its own nested
  `DB::transaction()`, which Laravel turns into a real `SAVEPOINT` once
  transaction depth is greater than one. Found by running the test, not by
  inspection — it failed with a raw "current transaction is aborted" error.
- **Timestamps compared as raw strings in two different formats** silently
  broke the slot-conflict `created_at` comparison — fixed by parsing both
  sides into real instants (`Carbon::parse`) before comparing, never
  comparing the wire strings directly.
- **`EXECUTE` on a newly created function defaults to `PUBLIC`** — unlike
  tables, which grant nothing by default. Every `SECURITY DEFINER`
  function here explicitly `REVOKE EXECUTE FROM PUBLIC` before granting it
  narrowly to the one role that should hold it; skipping the revoke would
  leave a `BYPASSRLS` function callable by literally any role that can
  reach the database.

## Open items
- **Client-side 60-day retention pruning doesn't exist.** What exists: the
  brief's rule ("local storage covers the last 60 days and the next 60
  days") and a server-side pull endpoint that already returns full history
  with no age cutoff at all. What's missing: nothing on either side prunes
  anything — a device's IndexedDB grows forever, and there is no per-entity
  windowing rule even decided, since most syncable tables (`patients`,
  `services`, `memberships`) have no principled date to filter by (a
  patient created 90 days ago can still have a visit tomorrow). Bites once
  a real clinic has been live long enough for local storage size or pull
  payload size to matter — not before.
- **`practitioner_locations` is written everywhere and read nowhere.** What
  exists: both the API's `provision_organization` and the web's local
  seed/Dexie schema create and store the link. What's missing: nothing
  reads it — the day screen and owner panels list practitioners by
  `is_active` only, and `register_device`'s bootstrap response doesn't
  return it either. Bites at the first clinic with two locations and
  doctors who don't work both: the day sheet will silently show every
  doctor at every branch, with no error and nothing currently testing for
  it (single-location v1 makes this invisible by construction).
- **`users` has no `rev`.** What exists: every other syncable table got a
  server-assigned `rev` this session. What's missing: `users` was excluded
  on purpose, because a user has no single owning org (its organizations
  are its memberships) — giving it `rev` today would be the first
  cross-org race in the schema. Bites only once something needs to sync a
  `users` row directly, which nothing does yet (registration and
  provisioning both write `users` through `BYPASSRLS` functions, never
  through the ordinary sync push path).
- **The chronologically-older-loses trade-off.** What exists: the brief
  says "the chronologically older wins" for a slot conflict; what's
  implemented is first-*arrival*-wins — the slot goes to whichever op
  reaches the server first, regardless of `created_at`. What's missing:
  the brief's literal rule, for the one scenario where arrival order and
  chronological order disagree. This was a deliberate, documented choice
  (`docs/sync-plan.md` Q4/Q5/Q7), not an oversight — implementing the
  literal rule would require the server to rewrite another device's
  already-accepted row on its own initiative, which the accept-or-reject
  standing rule above forbids. Bites exactly when: two devices book the
  same slot while both offline, and the device with the chronologically
  earlier booking reconnects last — it loses, and finds out via a rejected
  push turning into a review-sheet conflict, not via silently winning.

## Verify
Web: `pnpm --dir web test` · `pnpm exec tsc -b --noEmit` · `pnpm --dir web
build` · `pnpm --dir web test:e2e`. API: `cd api && composer install`,
`php artisan migrate --database=pgsql_owner`, `php artisan test`,
`./vendor/bin/pint --test` (`clintra_test` database set up per
`api/README.md` first, local only — CI provisions it itself). CI has four
jobs: `build`, `e2e`, `api`, and — as of this session — the web e2e suite
now includes `sync-review.spec.ts` alongside the existing specs. Current
totals as of `271d204`: vitest 551 passed (59 files); e2e 111 passed
(desktop + mobile).

## Next task
No entity endpoint other than sync exists yet in the sense of a
purpose-built REST resource (patients/visits/invoices are all reached only
through `mutate()` -> `sync/push`, never a dedicated controller) — that's
fine for v1, sync *is* the entity write path. The nearest real next steps,
in rough priority order: (1) decide and implement the 60-day pruning rule
before local storage size becomes a real device's problem; (2) wire
`practitioner_locations` through before the first multi-location clinic;
(3) build the second real device's registration + first sync cycle against
a live Postgres by hand, end to end, once — everything to date has been
proven through `FakeTransport` and Pest fixtures, never a real second
device hitting a real deployed API.
