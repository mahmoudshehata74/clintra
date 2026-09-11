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
step, not this connection. That step is `clintra_owner`'s own narrow
policies, below.

The lesson for any future table: **a single combined `USING`/`WITH CHECK`
expression is only safe if every `OR` branch in it still bottoms out at
`current_org()`/`current_membership()`.** An `OR` branch that doesn't is a
read hole if it's reachable with no membership at all, and a write hole
too, silently, the moment that same expression is reused for `WITH CHECK`.

## Owner-only policies for system-wide reference data

`clintra_owner` has no membership, ever — `current_org()` always resolves to
`NULL` for it, same as any other RLS-bound session with nothing declared —
so the base policies above never let it write anything, including a
system-wide reference row. `2026_09_11_170031_add_owner_reference_data_policies.php`
opens one narrow, additional path: three policies on `specialty_templates`
and `form_definitions`, `FOR ... TO clintra_owner` only, each restricted to
`org_id IS NULL` (or, for `form_definitions`, a template whose `org_id IS
NULL`). This doesn't weaken isolation — `clintra_app`'s policies are
completely untouched, so this grants nothing to any tenant-facing
connection. It only lets `clintra_owner` write the one category of row that
was always meant to be server-owned in the first place: the rows every org
shares, seeded once by `2026_09_11_170032_seed_reference_data.php` from
`contract/reference-data.json` (see `contract/README.md`).

Postgres RLS policies for different roles on the same command are
`OR`-combined (both are `PERMISSIVE`, the default), so a role that matches
more than one applicable policy needs only one of them to pass — adding
`clintra_owner`'s own INSERT/UPDATE policies here doesn't interact with or
loosen `clintra_app`'s at all; they're evaluated independently per role.

The migration also needed a `SELECT` policy, not just `INSERT`/`UPDATE`:
`INSERT ... ON CONFLICT DO UPDATE` (used for the idempotent upsert) requires
the target row to be visible under a `SELECT` policy to detect the conflict
at all — verified empirically before adding it (a plain `INSERT` succeeded
without it; the same statement with `ON CONFLICT DO UPDATE` failed with
"new row violates row-level security policy" until the `SELECT` policy
existed). It's scoped identically to `org_id IS NULL`, so it grants no
broader read access than the write policies already do. There is
deliberately no `DELETE` policy — reference rows are upserted, never
removed by a migration.

## Provisioning: the one door into an empty database

`organizations`' policy is `id = current_org()`, and `current_org()` can
never resolve without an active membership — but a membership needs an org
to belong to already. Neither `clintra_app` nor `clintra_owner` (both fully
RLS-bound) can create the very first organization; this is by design, not
an oversight — RLS isn't supposed to have a hole an ordinary connection can
walk through, even for bootstrapping.

`2026_09_11_170033_add_organization_provisioning.php` opens exactly one
door: a fifth role, `clintra_provision` (`NOLOGIN`, `BYPASSRLS` — same
local/CI-only provisioning as `clintra_rls`/`clintra_fixtures`, see
`api/README.md`), owns one `SECURITY DEFINER` function,
`provision_organization(jsonb)`. It creates an organization, its first
location, the owner's `users` row (or reuses one by phone — a user can hold
memberships in several orgs), a practitioner, the `practitioner_locations`
link, the owner membership, and an `audit_log` row for every row created —
all inside one transaction, so a partial provision can never exist.

**Why a function, not `SET ROLE` from PHP.** The obvious shortcut —
grant `clintra_app` (or a request-scoped connection) permission to
`SET ROLE clintra_provision` directly, then run ordinary inserts — was
rejected: it would mean *any* authenticated request could, in principle,
assume a `BYPASSRLS` identity and touch anything, constrained only by
remembering to `RESET ROLE` correctly on every code path, including
exceptions. A `SECURITY DEFINER` function has a hard boundary instead: the
bypass exists only inside this one function body, for exactly the columns
and tables its own code touches, and the caller never holds the elevated
role itself — it only ever gets to ask the function to run, if it has
`EXECUTE`.

**The `REVOKE EXECUTE FROM PUBLIC` trap.** PostgreSQL grants `EXECUTE` on
every newly created function to `PUBLIC` by default — unlike tables, which
start with no grants at all. Skipping the `REVOKE` here would mean
`clintra_app` (and anyone else who can connect) could call
`provision_organization(...)` directly and bypass RLS on all seven tables
it touches, the exact hole `docs/rls.md` exists to prevent everywhere else.
The migration revokes from `PUBLIC` and grants `EXECUTE` only to
`clintra_owner` — never `clintra_app`. `App\Console\Commands\ProvisionOrganization`
(`clintra:provision`) is the only caller, and it runs on the
`pgsql_owner` connection.

**`INSERT ... RETURNING` needs `SELECT` too.** An earlier version of this
function used `RETURNING * INTO ...` to capture each inserted row for its
audit snapshot, and failed "permission denied for table organizations" at
runtime despite `clintra_provision` having `INSERT` — confirmed empirically
that `RETURNING` requires `SELECT` privilege on the target table as well.
Rather than widen the grants past what provisioning actually writes, the
function builds every audit "after" snapshot from the values it already
has in hand (from its `jsonb` argument or fixed constants), so the grants
stay exactly `INSERT` on the seven tables it writes, plus `SELECT` only
where genuinely needed: `users` (the phone-reuse check) and `audit_log`
(`MAX(seq)`).

**Every id is caller-supplied.** The function never calls
`gen_random_uuid()` — `clintra:provision` generates every id itself, "the
install tool acting as a client" (the same rule client apps follow for
every other id in this schema). The one exception by design: a
system-wide reference id like `specialty_id` (the "general" template) is
read from `contract/reference-data.json`, never invented.

**The function validates its own input; it does not trust PHP.**
`2026_09_12_000001_validate_provision_organization_payload.php` added
exhaustive validation before any write: every required key present and
non-null, no unknown keys (rejected, not ignored), `pin_hash`/`pin_salt`
shaped exactly like `contract/pin-hash.json`'s Argon2id output, phones
that are non-empty E.164, `specialty_id` resolving to a real system-wide
template, and every sub-entity's own `org_id` matching the organization
being created (no cross-org smuggling). Every check raises SQLSTATE
`22023` (`invalid_parameter_value`), distinct from `42501` (RLS) or a real
constraint violation, so a test — or a future caller — can tell "this
input was wrong" apart from "this wasn't allowed" or "this collided."

The reasoning: `provision_organization` is the one `BYPASSRLS` function in
this schema. Every other table's safety net is RLS itself — a bad `WHERE`
clause just returns the wrong rows or zero, it can't corrupt another org's
data. This function has no such net; whatever it's told to do, it does,
across seven tables. `role`/`location_scope`/`practitioner_scope` and each
sub-entity's `org_id` were fixed literals inside the function before this
migration — genuinely unreachable as input at the time. They're validated
here anyway, promoted into the payload as fields the function checks
rather than assumes, because "unreachable today" and "unreachable forever"
are different claims, and this function doesn't get to be wrong about
which one it's making.

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
