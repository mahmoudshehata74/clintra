# Row-Level Security

Isolation lives in the database, not in application code. Any query that
forgets to scope itself returns zero rows, because Postgres enforces the
scope — not because the PHP code remembered to add a `WHERE`.

## The two-role model

- `clintra_owner` owns every table and is the only role migrations run as
  (`php artisan migrate --database=pgsql_owner`).
- `clintra_app` is what Laravel connects as at request time (`DB_CONNECTION`
  default). It owns nothing.
- Table owners bypass RLS silently by default — the one thing that makes
  `clintra_app` safe even if it somehow acquired ownership of a table is
  that it never does. Owning nothing means RLS always applies to it, no
  exceptions, no need to remember `FORCE`.
- A third role, `clintra_rls`, is NOLOGIN and has `BYPASSRLS`. It exists
  only so three helper functions (below) can resolve a membership's scope
  without deadlocking against the very policies that scope feeds. Neither
  `clintra_owner` nor `clintra_app` has `BYPASSRLS` — both remain fully
  RLS-bound for every direct query they run.

## Three traps this schema actively defends against

1. **Owner bypass.** RLS does not apply to a table's owner by default —
   `ENABLE ROW LEVEL SECURITY` alone is a decoration for the owner. Every
   migration also runs `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, which is
   what makes policies apply to `clintra_owner` too. Verified locally: with
   no membership set, `clintra_owner` sees zero rows from a direct
   `SELECT`, same as `clintra_app`.

2. **Empty link table means "all."** `membership_locations` and
   `membership_practitioners` are enumeration tables, not scope switches. A
   membership's `location_scope`/`practitioner_scope` column says whether
   it sees "all", a "listed" subset, or (for practitioners) "self" — an
   empty link table under a `listed` scope means zero locations, not every
   location. `allowed_locations()`/`allowed_practitioners()` branch on the
   scope column explicitly; they never infer "all" from an empty join.

3. **Connection pool session leak.** Isolation is carried by
   `SET LOCAL`/`set_config(..., true)` inside a transaction (Decision B),
   never `SET SESSION AUTHORIZATION` or a bare `SET`. A `SET LOCAL` value
   is automatically discarded at the end of the transaction, so a pooled
   connection reused for the next request starts with no membership
   declared — it can never inherit the previous request's scope by
   accident. `ApplyMembership` wraps the whole request in `DB::transaction()`
   for exactly this reason: `SET LOCAL` outside a transaction is a no-op
   that silently reverts immediately.

### A fourth trap, specific to this design: resolving scope without a deadlock

`current_org()`, `allowed_locations()` and `allowed_practitioners()` have to
read `memberships`, `locations`, `practitioners`, `membership_locations`
and `membership_practitioners` to compute a membership's scope — but those
tables are themselves RLS-protected by policies that depend on
`current_org()`. The very first read needed to resolve `current_org()` would
otherwise be blocked by a policy that needs `current_org()` to already be
known.

The fix is the standard Postgres pattern for this: the three functions are
`SECURITY DEFINER`, owned by `clintra_rls` (NOLOGIN, `BYPASSRLS`). They run
with `clintra_rls`'s bypass internally, and only to resolve the calling
session's own declared membership — the outer query (on `visits`, `patients`,
whatever) still runs entirely under the caller's own RLS-bound identity.
Granting `clintra_owner` or `clintra_app` `BYPASSRLS` directly would have
been simpler but wrong: it would defeat `FORCE ROW LEVEL SECURITY` outright,
since `BYPASSRLS` overrides `FORCE` unconditionally for that role.
`clintra_owner` is a plain member of `clintra_rls`, which the RLS migration
uses via `SET ROLE clintra_rls` while creating these four functions (so
`clintra_rls` owns them directly, and the migration stays idempotent across
`migrate:fresh`, which drops tables but not standalone functions) — role
membership alone does not inherit the `BYPASSRLS` attribute, so this grants
no bypass to `clintra_owner`'s own sessions outside that one block.

## Fail-safe, not fail-open

Every helper function returns an empty result — `NULL` for
`current_membership()`/`current_org()`, an empty set for
`allowed_locations()`/`allowed_practitioners()` — when `app.membership_id`
is unset, malformed, or doesn't resolve to an active membership. Never an
error. An empty result makes every policy's `USING`/`WITH CHECK` clause
evaluate to zero rows, which is what "fails safe" means here: the absence
of a valid membership locks everything out rather than raising an
exception a caller might catch and route around.

## A worked failure: specialty_templates' OR clause

`specialty_templates`/`form_definitions` originally used one policy
expression for both `USING` and `WITH CHECK`:
`org_id = current_org() OR org_id IS NULL` (system-wide templates, per
`docs/schema.md`, are meant to be readable by every org). The automated RLS
suite (`tests/Feature/Rls`) caught two real holes this created, both because
`org_id IS NULL` doesn't depend on `current_org()`/`current_membership()` at
all:

1. **Read**: a session with *no membership declared at all* — not just the
   wrong org — could still `SELECT` every system-wide row, breaking the
   fail-safe invariant above.
2. **Write**: because the same expression backed `WITH CHECK`, any org's
   membership could `INSERT` a new `org_id IS NULL` row, or `UPDATE`/`DELETE`
   an existing system-wide one — corrupting shared reference data for every
   other org, not just reading it.

Fixed in `2026_09_11_170030_split_specialty_template_write_policies.php` by
splitting each table's single policy into one per command: `SELECT` keeps
"or it's system-wide," but gates that on `current_org() IS NOT NULL` (a
membership must actually resolve); `INSERT`/`UPDATE`/`DELETE` drop the `OR`
entirely — a membership can only ever write its own org's rows. There is
deliberately no path left for `clintra_app` to write an `org_id IS NULL` row
— seeding system-wide reference data needs a separate, owner-run bootstrap
step, not this connection (open, see `docs/session-handoff.md`).

The lesson for any future table: **a single combined `USING`/`WITH CHECK`
expression is only safe if every `OR` branch in it still bottoms out at
`current_org()`/`current_membership()`.** An `OR` branch that doesn't is a
read hole if it's reachable with no membership at all, and a write hole
too, silently, the moment that same expression is reused for `WITH CHECK`.

## clintra_fixtures — test-only, never production

A fourth role exists purely for the RLS test suite (`tests/Feature/Rls`) to
insert fixture data without a membership already in place to grant it RLS
scope — something neither `clintra_app` nor `clintra_owner` can do (both stay
RLS-bound). `clintra_fixtures` is `BYPASSRLS`, which defeats every guarantee
on this page outright for whoever holds it. It must **only ever exist in
local dev and CI databases**, is used exclusively by the test suite's own
`pgsql_fixtures` connection, and must never be created in a production
database or referenced by application code. See `api/README.md` for the
exact setup SQL, and `config/database.php` — its credentials have no default,
so an environment that never sets `DB_FIXTURES_USERNAME`/
`DB_FIXTURES_PASSWORD` never has a working connection for it at all.

## How to add a new table

1. Migration creates the table (uuid primary key, client-generated —
   never server-generated).
2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and
   `ALTER TABLE ... FORCE ROW LEVEL SECURITY` (the
   `App\Support\Migrations\EnablesRowLevelSecurity` trait does both, plus
   the grant below, in one call).
3. `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO clintra_app`.
4. Add a policy referencing the appropriate helper(s) — `current_org()` if
   the table carries `org_id`, `allowed_locations()`/
   `allowed_practitioners()` if it carries `location_id`/`practitioner_id`,
   or a join through the table's actual parent if it carries neither (see
   `membership_locations`' policy for the join-table pattern). Give it both
   `USING` and `WITH CHECK` — omitting `WITH CHECK` lets an `INSERT`/`UPDATE`
   silently create a row the same policy would then hide from every future
   `SELECT`.
5. Update `docs/schema.md` with the new field list.
