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
where genuinely needed: `users`, for the phone-reuse check.
(`audit_log.seq` used to need a `SELECT MAX(seq)` here too — since
"Sequence-backed audit ordering" below, it's a real identity column, and
none of the three provisioning roles hold `SELECT` on `audit_log` at all
any more.)

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

## Registration: the second door, and why Sanctum can't authenticate through RLS

A device registering has no membership yet, same bootstrapping problem as
provisioning, but for a *read* that has to happen on every single
authenticated request afterward, not just once. `register_device(jsonb)`
(`2026_09_12_000006_add_register_device_function.php`) is `SECURITY
DEFINER`, owned by `clintra_register` (its own `BYPASSRLS` role since
`2026_09_12_000009_split_provisioning_roles.php` — never shared with
`clintra_provision`/`clintra_mint`, see "One role per provisioning
function") — but `EXECUTE` is granted to `clintra_app`, not
`clintra_owner`, because this one is called from a live, unauthenticated
HTTP request (`POST /api/devices/register`), never from a CLI command on
the `pgsql_owner` connection. It verifies the activation code (exists,
unused, unexpired) and the submitted phone (matches an active owner
membership in that code's org), atomically marks the code used, creates
the `device` row, and returns the full bootstrap payload the web client
needs to actually render from: the four resolved ids
(`device_id`/`org_id`/`location_id`/`membership_id` — the client already
knows `device_id`, it minted it, but not which org/location/membership
the code just resolved it to), the organization, every location and
practitioner in the org, every membership (including `pin_hash`/`pin_salt`
— see `docs/auth-plan.md`'s registration credential resolution for why
that crossing the wire once, here, is intentional — and `rev`, so a later
edit to that membership has a real `base_rev` to send, not a guess), and
every user a returned membership's `user_id` points at (`web/src/auth/LockScreen.tsx`
joins memberships to users by id to label its PIN picker; the first
version of this payload omitted `users` and `rev` both, caught while
wiring up the real registration screen —
`2026_09_12_000019_add_rev_to_register_device_response.php`).

Every credential failure — wrong code, expired, already used, wrong phone,
right phone but the wrong org's code — raises the exact same generic
exception. This is deliberate, not laziness: distinguishing them would
hand an attacker a working oracle for guessing valid phones or codes one
bit at a time. Payload *shape* problems (not a real phone, not real hex,
not a real uuid) are caught by a Laravel `FormRequest` before this
function is ever called, and rendered as 422 — a shape problem is the
caller's bug, not a credential-guessing signal, so being specific about
those costs nothing.

**Why `ApplyMembership` doesn't use `auth:sanctum`.** Sanctum's guard
resolves an authenticated request's token, then loads the token's
*tokenable* — ordinarily a `User` — via a plain Eloquent query. Every
domain table in this schema, `device` included, carries `FORCE ROW LEVEL
SECURITY`; loading a tokenable row this way, before any membership is
known, is exactly the read this schema's RLS is built to block, and would
make authentication itself silently fail (the query returns zero rows,
Sanctum reports "unauthenticated" even for a perfectly valid token).
Granting `device` a bypass for this one read would either mean weakening
its policy (a real hole: anyone who could still be listening on the
connection could then read every device row) or inventing a second,
narrower session GUC (in the spirit of `app.membership_id`) purely to
smuggle the row past its own policy — solvable, but a second bootstrapping
mechanism this schema doesn't need yet.

Instead, `ApplyMembership` verifies the bearer token by hand, directly
against `personal_access_tokens` — the one auth-adjacent table that
carries **no RLS at all** (`grantAppAccessWithoutRls`, same as
`sessions`/`cache`/`jobs`): replicates Sanctum's own `id|token` lookup,
hashes the presented token, compares with `hash_equals`, and reads the
membership id out of the token's `abilities` (stored as
`membership:<uuid>` at issuance — `App\Models\Device` exists solely to
mint tokens in this shape at registration; nothing ever fetches a `Device`
model afterward). This sidesteps the RLS/Sanctum-guard conflict entirely,
at the cost of not using Sanctum's `Auth::user()`/`$request->user()`
sugar on membership-gated routes — `/api/isolation-probe` is the only one
that exists so far.

**The local-only header bridge is enforced in code, not config.**
`ApplyMembership` still accepts `X-Membership-Id` — but only when
`app()->environment('local')` is literally true, checked in the middleware
itself. Not a `.env` flag, not a config value: an environment-specific
config file accidentally shipped to staging or production would silently
re-open this bridge if the gate lived in config instead of in code that
reads the real, framework-detected environment.

**Devices get replaced.** `mint_activation_code(jsonb)`
(`2026_09_12_000005_add_mint_activation_code_function.php`) mints a fresh
code for an org that already exists, via `php artisan clintra:mint-activation-code`
— `EXECUTE` granted only to `clintra_owner`, same CLI-only path as
`provision_organization`, never `clintra_app`. It has no acting membership
of its own to attribute an audit row to (it's a bare CLI invocation, not a
request from a logged-in owner), so it looks up the org's own active owner
membership and attributes the code-creation audit row to that.

## Hardening pass: register_device as the outer boundary

`register_device(jsonb)` is reachable from an unauthenticated public
endpoint (`POST /api/devices/register`) — nothing gates it, because it *is*
how a device gets its first credential. It runs `SECURITY DEFINER` as
`clintra_provision`, a `BYPASSRLS` role, so it deserves the same scrutiny as
`provision_organization`.

**Grants audit (as of the initial pass, before the role split below).**
Queried directly (`information_schema.role_table_grants`, not `\dp`, since
no `psql` client was available in this environment — identical
information): `clintra_provision` held `INSERT`/`SELECT` on
`activation_codes`, `audit_log`, `locations`, `memberships`,
`organizations`, `practitioners`, `users`; `INSERT`-only on `device` and
`practitioner_locations`; and `SELECT`-only on `specialty_templates`. It
held **zero privileges on `patients`, `visits`, `invoices`, or
`payments`** — the specific hole this audit was checking for did not
exist. But the footprint was wider than `register_device` itself needed
(it only ever touched `activation_codes`, `device`, `memberships`,
`users`, `audit_log`) because `clintra_provision` was the shared owner of
three functions, and Postgres grants are per-role, not per-function. A
flaw in `register_device` — reachable from the internet — would have
inherited `provision_organization`'s privileges too: `INSERT` on
`organizations`, `locations`, `practitioners`, `practitioner_locations`,
`memberships`. That's an org-and-membership forgery primitive, not just a
device one. Resolved below, in "One role per provisioning function".
`personal_access_tokens` was expected in this list but wasn't there: the
Sanctum token row is written in PHP, on the `clintra_app` connection,
*after* `register_device` returns (see `DeviceRegistrationController`) —
`register_device` itself never touches that table.

**Its own input validation** (`2026_09_12_000007_validate_register_device_payload.php`)
mirrors `provision_organization`'s: required keys present, no unknown keys,
`device_id` a well-formed UUID, `phone` matching E.164, `code_hash` exactly
64 lowercase hex characters — each with its own `RAISE EXCEPTION ...
USING ERRCODE = '22023'`, checked before any table read. One Pest test per
rule, in `tests/Feature/Rls/RegisterDeviceValidationTest.php`.

**Credential failures stay indistinguishable inside the function, not just
over HTTP.** A bad code, an expired code, an already-used code, and a
phone that doesn't match the code's org all fall through to the same
generic `RAISE EXCEPTION 'register_device: registration failed'` with the
default SQLSTATE (`P0001`) — verified by a test that asserts a bad-code
attempt and a bad-phone attempt raise byte-identical SQLSTATE and message.

**Single-use is atomic under real concurrency**, not just sequentially.
The code's `used_at` claim and the `device` insert happen in one
transaction; a Pest test spawns two genuinely separate OS processes
(`proc_open()` against a standalone PHP/PDO script with no Laravel
bootstrap — `pcntl_fork()` isn't available on Windows) that race the same
activation code, and asserts exactly one commits and one fails.

**`device_exists()`** (`2026_09_12_000008_add_device_exists_helper.php`)
closes a gap `ApplyMembership` had: a token survives in
`personal_access_tokens` (no RLS) even after its `device` row is deleted,
since nothing there depends on the device still existing. It's the same
`SECURITY DEFINER`-owned-by-`clintra_rls` pattern as `current_org()` —
`ApplyMembership` calls it on every token-authenticated request and treats
a `false` result as unauthenticated. `device` has no `is_active` column, so
only "deleted" is representable, not "inactive"; a future `is_active`
column would need this function (and this note) updated together.

## One role per provisioning function

The grants audit above found a real design flaw, not just an untidy
footprint: sharing `clintra_provision` across three functions of two very
different exposure levels — two CLI-only (`provision_organization`,
`mint_activation_code`) and one internet-facing (`register_device`) — meant
a flaw in the internet-facing one inherited the CLI-only ones' privileges
too, because Postgres grants are per-role, never per-function. Fixed by
`2026_09_12_000009_split_provisioning_roles.php`: three roles, each owning
exactly one function, each granted exactly what that function's current
body reads or writes — nothing granted on the grounds that it might be
needed later, since that's what widened `clintra_provision` in the first
place. Widening any of the three now means editing a migration, in a
change that's reviewable on its own, not a side effect of some other
function's grants.

| Role | Owns | Callable by | Table privileges |
|---|---|---|---|
| `clintra_provision` | `provision_organization` | `clintra_owner` (CLI only) | `INSERT` on `organizations`, `locations`, `practitioners`, `practitioner_locations`, `memberships`, `activation_codes`, `audit_log`; `INSERT`+`SELECT` on `users`; `SELECT` on `specialty_templates` |
| `clintra_mint` | `mint_activation_code` | `clintra_owner` (CLI only) | `SELECT` on `locations`, `memberships`; `INSERT` on `activation_codes`, `audit_log` |
| `clintra_register` | `register_device` | `clintra_app` (the unauthenticated HTTP endpoint) | `SELECT` on `organizations`, `locations`, `practitioners`, `memberships`, `users`, `activation_codes`; `UPDATE` on `activation_codes` restricted to exactly two columns (`used_at`, `used_by_device_id`); `INSERT` on `device`, `audit_log` |

*(Table above reflects the state after "Sequence-backed audit ordering"
below — none of the three hold `SELECT` on `audit_log` any more.)*

`clintra_register` — the one reachable from the internet — is the
narrowest by construction: read-only everywhere except the two tables
`register_device` actually creates or updates rows in, and even that
`UPDATE` is column-restricted (`GRANT UPDATE (used_at, used_by_device_id)
ON activation_codes ...`), so it cannot touch `code_hash`, `expires_at`, or
any other column on that table even by accident. It holds zero privileges
of any kind on `patients`, `visits`, `invoices`, `payments`,
`practitioner_locations`, `specialty_templates`, or `form_definitions` —
confirmed by `tests/Feature/Rls/ProvisioningRoleGrantsTest.php`, which
reads `information_schema.role_table_grants`/`role_column_grants` directly
(the same source of truth this whole audit is built from) and fails the
moment a future migration grants either new role anything outside this
table, regardless of what that migration's own comment claims.

**All three roles originally needed `SELECT` on `audit_log`, not just
`INSERT`** — an easy assumption to get wrong, since audit rows are
otherwise append-only (nothing ever `UPDATE`s or `DELETE`s one). Every
provisioning function computed its own next `audit_log.seq` via `SELECT
COALESCE(MAX(seq), 0) FROM audit_log` — a genuine read, and the first
draft of this split's allowlists (written before checking the function
bodies directly) missed it for the two new roles. Caught before granting
anything, not after: see the two corrections below, both found by reading
`2026_09_12_000005_add_mint_activation_code_function.php`'s and
`2026_09_12_000006_add_register_device_function.php`'s actual SQL rather
than assuming from the function's name what it "should" need. (This
`SELECT` grant was itself removed shortly after, once `seq` became a real
identity column — see "Sequence-backed audit ordering" below. Left as
written here since it's what this pass actually found and granted at the
time; the grants table above reflects the current, corrected state.)

- `mint_activation_code` also reads `memberships` (to find the org's
  active owner and attribute the new code's audit row to them) — missing
  from an earlier draft of `clintra_mint`'s allowlist, which had assumed
  `organizations` instead. It was corrected to `memberships`;
  `organizations` was dropped entirely — the function only ever checks
  `locations.org_id`, never reads the `organizations` table itself.
- `register_device` writes two `audit_log` rows per successful
  registration (device creation, activation-code-used) — the same
  audit-trail convention every other entity-creating function in this
  schema follows. An earlier draft's allowlist had no `audit_log` entry at
  all for `clintra_register`; granting only `INSERT`, matching every other
  role's `audit_log` grant, keeps `register_device`'s audit trail intact
  without granting `UPDATE`/`DELETE` on a table nothing should ever
  modify or remove rows from.

**Downgraded, not just added:** `clintra_register` used to hold (via the
shared `clintra_provision`) `SELECT` on `device`, `specialty_templates`,
`form_definitions`, and `practitioner_locations` — none of which
`register_device`'s current body ever reads (no `RETURNING`, no query
against any of those three others). All four were dropped. If a later
change needs the registration response to include specialty/form/location
data, that's a new migration granting exactly the new column or table
access it needs — not a standing grant kept around in case.

## Sequence-backed audit ordering

Every provisioning function computed `audit_log.seq` the same way: `SELECT
COALESCE(MAX(seq), 0) + 1`, inside the same transaction as the audit row
itself — the same pattern the web app's local IndexedDB store used for its
own `seq` counter before commit `236e2e2` fixed it there. The two
concurrency models are different, though, and the fix that worked for one
didn't carry over: a single IndexedDB instance has one writer at a time,
so "reserved inside the same transaction" is airtight there. A Postgres
database has many concurrent connections, and two different transactions
can both read the same `MAX(seq)` before either commits — "same
transaction" guarantees nothing about a *different* transaction doing the
same read concurrently.

Checked first, since the failure mode depends on it:
`audit_log.seq` carries a `UNIQUE` constraint
(`2026_09_11_170021_create_audit_log_table.php`). So the actual bug wasn't
silent ambiguity (two rows quietly sharing an order) — it was a
unique-violation on the second transaction to commit, rolling back
*everything else* in that transaction along with it. A rare, real
concurrent registration or provisioning call could fail outright over an
unrelated table's constraint, indistinguishable from any other generic
failure to whoever was retrying it.

Fixed by `2026_09_12_000010_sequence_backed_audit_seq.php`: `seq` is now a
real Postgres identity column (`GENERATED BY DEFAULT AS IDENTITY`),
started one past whatever the current max was at migration time (computed
live in a `DO` block, not hardcoded — so an already-provisioned database's
existing rows never collide with a freshly-generated one, and a
migration run against an empty CI database starts at 1). `nextval()` is
atomic under concurrency by construction; a read-then-write pair never is.
Every `INSERT INTO audit_log` across all three provisioning functions now
omits `seq` entirely, letting Postgres assign it.

**This also meant revoking `SELECT` on `audit_log` from all three
provisioning roles** — `SELECT MAX(seq)` was the only reason any of them
had it (see "One role per provisioning function" above). Checked
empirically before revoking anything, the same way the grants themselves
were checked: does an identity column's underlying sequence need its own
`USAGE` grant for a role that already has `INSERT` on the table? No —
confirmed directly (a throwaway table, an identity column, a role granted
`INSERT` only, no `USAGE` anywhere) that the `INSERT` succeeds without it.
Postgres treats an identity column's sequence as an implicit part of the
table for this purpose; `USAGE` only matters for a role calling
`nextval()`/`currval()`/`setval()` directly, which nothing here does
anymore. `clintra_app` was not touched here.
`tests/Feature/Rls/ProvisioningRoleGrantsTest.php` now asserts all three
roles hold `INSERT`-only on `audit_log`, failing if anything ever
re-grants `SELECT` there without a fresh reason.

**Correction**: an earlier version of this section (and of
`2026_09_12_000010_sequence_backed_audit_seq.php`'s own comment) claimed
`clintra_app` "holds no grant on `audit_log` at all" — that was wrong.
`clintra_app` has held full `SELECT`/`INSERT`/`UPDATE`/`DELETE` on
`audit_log` since the table was created, via the standard
`EnablesRowLevelSecurity` grant every table gets
(`2026_09_11_170021_create_audit_log_table.php`). What actually made the
claim's *conclusion* true (nothing today can effectively update or delete
an audit row through `clintra_app`) was the absence of any `UPDATE`/
`DELETE` **policy** — with `FORCE ROW LEVEL SECURITY` and no matching
policy, the grant exists but can never take effect. That is one policy
away from a forgeable audit trail, not a structurally safe state: adding
an `UPDATE`/`DELETE` policy later, for any reason, would silently
reactivate a grant nobody meant to leave live. See "Redundant grants
revoked, not just inert" below for the fix.

**Concurrency proof**: `tests/Feature/Rls/AuditLogSequenceTest.php` runs
two completely independent, valid `register_device` calls — different
orgs, different codes, no shared row — via two genuinely separate OS
processes (`tests/scripts/register_device_race.php`, the same
`proc_open()` harness `RegisterDeviceValidationTest.php`'s single-use race
test uses; `pcntl_fork()` isn't available on Windows). Before this fix,
this exact scenario could make one of the two calls fail outright on the
other's `MAX(seq)` collision, despite both codes and phones being
perfectly valid. Now both always succeed, and all four resulting audit
rows (two per registration) get pairwise-distinct, strictly increasing
`seq` values. A second test reproduces the migration's own `DO` block
against a throwaway table pre-seeded with "existing" high `seq` values,
confirming those rows keep their exact values untouched and a fresh row
lands strictly above the old max — the property that makes running this
migration against an already-provisioned database safe.

**Not addressed here, and explicitly out of scope for this step**: the
web app's local `audit_log.seq` (per-device, Dexie-only) and the API's
identity column (database-global) are two unrelated counters with no
reconciliation between them — there is no sync mechanism yet that pushes a
device's local audit rows to the API at all, so nothing today assumes a
client-assigned `seq` value means anything on the server. Neither
`register_device`'s bootstrap response nor any provisioning function
accepts a caller-supplied `seq` — every `audit_log` row the server writes
is server-created, for its own server-side actions, not a client's synced
history. Designing that reconciliation is future work; see
`docs/schema.md`'s new "v11 additions" section.

## Audit attribution is enforced in the database, not application code

`audit_log_insert`'s `WITH CHECK` originally scoped only the row's org
(`org_id = current_org()`, `2026_09_11_170029_enable_rls_policies.php:178`)
— it said nothing about whether the row's `actor_membership_id` was
actually the membership doing the writing. Any membership inside an org
could `INSERT` an audit row naming any *other* membership in that same org
as the actor. The audit trail is the only record of who did what in this
system; an actor column forgeable from inside the org it audits isn't
evidence, it's a claim.

`2026_09_12_000011_enforce_audit_attribution.php` ANDs a second condition
onto the same policy: `actor_membership_id = current_membership()`.
`current_membership()` (defined alongside `current_org()` in the RLS
helpers migration) is a plain function — not `SECURITY DEFINER`, no
`BYPASSRLS` involved — that reads the session's own declared
`app.membership_id`; already `EXECUTE`-granted to `clintra_app`, so no new
grant was needed. Org scoping, the `SELECT` policy, and the deliberate
absence of any `UPDATE`/`DELETE` policy (audit history stays immutable by
construction) are all untouched.

**The three provisioning functions are unaffected — confirmed, not
assumed.** `provision_organization`, `mint_activation_code`, and
`register_device` all write `audit_log` rows as their own owning roles
(`clintra_provision`/`clintra_mint`/`clintra_register`), each
`SECURITY DEFINER` and `BYPASSRLS`. `BYPASSRLS` means every RLS policy —
including this new check — never applies to their execution at all,
regardless of what the policy says; the actor they write is always a
membership id the function itself resolved server-side
(`v_membership_id`/`v_owner_membership_id`), never one taken from a
caller's payload. Confirmed by grepping `app/` and every migration for
`audit_log` writes: the only three call sites are these three functions,
and the full test suite — including `ProvisioningTest.php`,
`MintActivationCodeTest.php`, and `DeviceRegistrationTest.php`, none of
which changed for this migration — still passes unmodified with the new
policy in place. Nothing today writes an audit row through the ordinary,
RLS-bound `clintra_app` connection at all (no entity endpoints exist
yet), so there was no existing legitimate use this narrows.

Behavioral coverage in `tests/Feature/Rls/AuditLogAttributionTest.php`: a
membership can insert an audit row attributed to itself; the same
membership attributing one to a *different* membership in the same org is
rejected (`42501`); a cross-org insert is still rejected, confirming the
original check wasn't weakened by ANDing the new one onto it.

## Redundant grants revoked, not just inert

`audit_log` and `sync_ledger` are both meant to be append-only, and both
relied on the same structural pattern to get there: the standard
`EnablesRowLevelSecurity` grant gives `clintra_app` full
`SELECT`/`INSERT`/`UPDATE`/`DELETE` on every table, and neither of these
two ever had an `UPDATE`/`DELETE` *policy* — so with `FORCE ROW LEVEL
SECURITY`, those two privileges affected zero rows regardless of holding
the grant. Correct in practice, but a single-layer guarantee: adding an
`UPDATE`/`DELETE` policy to either table later, for any unrelated reason,
would silently reactivate a grant nobody meant to leave live. The audit
trail is the only record of who did what, and the sync ledger is the only
receipt of what actually synced — one policy away from a forgeable
history isn't the same guarantee as two independent layers both saying
no.

`2026_09_12_000015_revoke_inert_write_grants.php` revokes `UPDATE` and
`DELETE` on both tables from `clintra_app` directly. `SELECT`/`INSERT`
are untouched. `tests/Feature/Rls/AppendOnlyGrantsTest.php` asserts the
grant itself is gone, not just its effect.

**This also corrects a factual error from two earlier sessions**: both
`2026_09_12_000010_sequence_backed_audit_seq.php`'s own comment and this
document's "Sequence-backed audit ordering" section above claimed
`clintra_app` "holds no grant on `audit_log` at all." That was never
true — `clintra_app` held the standard full-CRUD grant on `audit_log`
from the moment the table was created. Both are corrected above and here.

## Hardening pass: hand-rolled token verification in ApplyMembership

`ApplyMembership` carries the entire isolation guarantee for every
membership-gated route, so its manual token check (see above: it can't use
Sanctum's own guard, which would try to load the RLS-protected `device`
table before any membership is known) was audited line by line against a
checklist, each backed by a test in
`tests/Feature/Rls/ApplyMembershipHardeningTest.php`:

- Token comparison uses `hash_equals`, not `===` — checked structurally
  (asserts the source contains `hash_equals(` and never a loose comparison
  against a `hash()` call) as well as behaviorally.
- An expired token (`expires_at` in the past) is rejected.
- A deleted token row is rejected (nothing to find `hash_equals` against).
- A token whose `device` row was deleted is rejected, via `device_exists()`
  above.
- A token whose membership has `is_active = false` is rejected — caught by
  `current_org()`'s own `is_active = true` scoping, not by
  `ApplyMembership` reading `memberships` directly.
- A token whose membership moved to a different org reads the *new* org's
  data on the very next request, never the old one — by construction,
  since `current_org()` re-resolves live from `memberships` on every call
  and nothing about org scope is ever cached at token-issuance time.
- A malformed `Authorization` header — no `Bearer` prefix, empty, no `|`
  separator, or a non-numeric/oversized id segment — returns 401, never
  500. This was a real bug, not a hypothetical: before validating the id
  segment with `ctype_digit()`, a header like `Bearer abc|xyz` reached
  `DB::table('personal_access_tokens')->where('id', 'abc')`, and Postgres
  raising `SQLSTATE[22P02]: invalid input syntax for type bigint` bubbled
  up as an uncaught `QueryException` — a 500, with the raw query text
  visible in the response under `APP_DEBUG=true`. Fixed by rejecting any
  id segment that isn't all-digits and at most 18 characters *before* it
  reaches a query.

Every rejection path returns the exact same generic 401 body
(`{"error": "unauthenticated", "message": "..."}"`) — none of the above are
distinguished from each other in the response.

## Hardening pass: the timezone bug class

A naive `DateTimeInterface` passed straight into `insert()`/`update()`/a
raw binding gets formatted by Laravel's query grammar as `Y-m-d H:i:s` with
no UTC offset; Postgres then interprets it under its own session timezone,
which silently corrupts the value whenever that differs from
`config('app.timezone')` (`Africa/Cairo`) — see
`tests/Support/RlsFixtures.php`'s `normalizeTimestamps()` doc comment for
the exact failure this caused (an "expired one minute ago" fixture landed
hours in the future against a UTC-default CI Postgres, silently passing
locally where Postgres happened to default to Cairo too).

A full grep of the API for every `now()`/`Carbon`/`DateTime` instance
reaching `insert()`, `update()`, or a raw query binding turned up, and
fixed the same way (`->toIso8601String()`, which encodes an explicit
offset Postgres can't misinterpret): `ApplyMembership`'s `last_used_at`
update, `CrossOrgInsertRejectedTest`'s raw `created_at` insert, and
`RlsFixtures`'s `makeOrganization`/`makePatient`/`makeVisit`/
`makeAuditLog`/`makeActivationCode`/`makeDevice` fixture helpers (the
latter now all route through the shared `normalizeTimestamps()` helper
instead of each guarding this individually). No other call site in
`app/` passes a raw `DateTimeInterface` to a write.

Because this bug class only surfaces when the app's timezone and
Postgres's session timezone genuinely disagree, and `Africa/Cairo` (the
app) happened to match this developer's local Postgres default, CI's
Postgres service now sets `TZ: America/Los_Angeles` — deliberately neither
UTC (Postgres's own default, which is what actually caught this bug the
first time) nor Cairo, so this whole class of bug fails loudly in CI by
default instead of depending on which timezone a fresh container happens
to pick.

## Hardening pass: log hygiene

Verified that a clean, fully-passing test run writes **zero lines** to
`storage/logs/laravel.log` — Laravel only logs uncaught exceptions or
explicit `Log::` calls, and every credential-failure path here (bad code,
expired code, malformed header, validation failure) is caught and
converted to a JSON response before it would ever reach the exception
handler's `report()` path. `tests/Feature/Rls/DeviceRegistrationTest.php`
now asserts this directly for both directions: a **failed** registration
attempt (wrong code) never writes the attempted code or its hash to the
log, and a **successful** registration — the one request that legitimately
carries a plaintext token, a token hash, and a membership's
`pin_hash`/`pin_salt` all at once, in its response body — never writes any
of those, or the three DB connection passwords, to the log either.

## The sync push endpoint

`POST /api/sync/push` (`App\Http\Controllers\SyncPushController`,
`App\Support\Sync\SyncOpApplier`) is the first entity write path that
runs through the ordinary, RLS-bound `clintra_app` connection rather than
a `SECURITY DEFINER`/`BYPASSRLS` function — everything before it
(provisioning, registration) existed specifically to bootstrap around RLS;
this is the first thing RLS is actually meant to constrain in the way
every other future entity endpoint will inherit. It matches
`SyncTransport.pushOps` exactly (`web/src/sync/transport.ts`): an array of
ops in, one result per op out, same order, behind the `membership`
middleware.

**The syncable-table list, and one deliberate exclusion.** Exactly the 14
tables `2026_09_12_000012_add_row_versioning.php` gave a `rev` column —
derived from what `web/src/db/mutate.ts` callers actually pass as
`entity:`, not the full v1 table list. `users` stays excluded here too,
for the same reason: no single owning org.

**Four result statuses, one meaning each** (`App\Support\Sync\SyncOpApplier`):

- `accepted` — applied; the response carries the new `rev`.
- `duplicate` — `op_id` already in `sync_ledger`, checked before any
  write, never reapplied (the brief's own idempotency rule).
- `rejected` — a genuine business conflict: a stale `base_rev` (edit
  conflict), an insert whose `entity_id` already has a row, a slot
  already occupied (`conflict_slot_taken` — see "Slot conflicts" below),
  or a write against a closed `day_state` row (`conflict_day_closed` —
  see "Closed days are immutable" below).
- `failed` — anything else: an org mismatch, a future-dated or
  out-of-window `created_at`, or a caught `QueryException` this class
  doesn't otherwise model (a foreign key pointing at nothing, for
  instance). Never leaks the underlying SQLSTATE or query text — every
  `QueryException` this class doesn't explicitly recognize is `report()`ed
  server-side and mapped to the single generic reason `internal_error`.

**Trust, per docs/sync-plan.md's Q12/Q13 — applied, not just decided.**
`actor_membership_id`, and any table's own equivalent (`visits.created_by`,
`payments.created_by`, `cash_close.closed_by` —
`App\Support\Sync\SyncableTables::ACTOR_COLUMNS`), is always the
token-resolved membership, overwritten after merging the payload,
regardless of what the payload itself claims. `org_id` is different:
where a table's payload carries one directly (`SyncableTables::DIRECT_ORG_ID_TABLES`),
a mismatch against `current_org()` is checked explicitly and returns
`failed` with a clean `org_mismatch` reason, before any write is
attempted — for tables whose payload has no direct `org_id` at all, RLS's
own `WITH CHECK` catches a transitive mismatch (a `location_id` or
`practitioner_id` belonging to another org) as a `42501`, which this
class's generic `QueryException` handling still turns into a clean
`failed`/`internal_error` rather than surfacing the SQLSTATE.

**Same-entity_id blocking, not a general op DAG** (the controller, not the
applier — it sequences the batch and knows nothing else about ordering).
Once an op targeting a given `entity_id` returns `rejected` or `failed`,
every later op in the same batch targeting that same `entity_id` returns
`blocked` without being attempted. Ops on other entities are unaffected.
This is `docs/sync-plan.md`'s Q2 decision; the brief only mandates the
ops arrive in chronological order per device, which this endpoint trusts
and preserves rather than re-sorting.

**A real bug, caught before it shipped**: catching a `QueryException`
mid-transaction (to detect a unique-constraint violation on a slot table)
leaves Postgres refusing every further statement in that transaction
until a `ROLLBACK` — including the lookups slot-conflict resolution needs
to run immediately afterward, in the *same* transaction. Wrapping just the
risky `INSERT` in its own nested `DB::transaction()` makes Laravel issue a
real `SAVEPOINT` (automatic once transaction depth is greater than one)
and roll back to it on failure, leaving the outer transaction usable
afterward instead of permanently aborted. Found by running the slot-conflict
test, not by inspection — it failed with a raw "current transaction is
aborted" error before this fix.

## The sync pull endpoint

`GET /api/sync/pull` (`App\Http\Controllers\SyncPullController`,
`App\Support\Sync\SyncPuller`) matches `SyncTransport.pullSince` exactly
(`web/src/sync/transport.ts`): one opaque cursor in, a batch and a new
cursor out. Same connection as push — the ordinary, RLS-bound
`clintra_app` connection, behind the same `membership` middleware. No web
changes shipped alongside it; `HttpTransport` implementing the
`SyncTransport` interface against these two endpoints is a separate step.

**Org isolation is never a hand-written filter.** Every query in
`SyncPuller` reads either `sync_ledger` or one of the 14 syncable entity
tables exactly as any other RLS-bound `clintra_app` query would — there is
no `->where('org_id', ...)` anywhere in the class to forget. `sync_ledger`'s
own `sync_ledger_select` policy (`org_id = current_org()`) scopes which
rows a cursor can ever see; each entity table's own SELECT policy scopes
the current-state lookup for that row's `payload`. A device holding
another org's cursor, or another org's `entity_id`, gets nothing back
through this path for the same reason `/api/isolation-probe` does — RLS
itself, not application logic, is what a missing filter would have had to
route around, and there's no code path here that could.

**The cursor is `sync_ledger.seq`** — the same global identity column
`audit_log.seq` already uses ("Sequence-backed audit ordering" above), one
counter shared across every org, not reset per org. `null`/absent means
"from the beginning" (`since = 0`); a cursor greater than the caller's own
RLS-scoped `MAX(seq)` is rejected outright with a 422 (`invalid_cursor`)
rather than silently answered as "nothing new" — a real client following
this contract could never legitimately hold a cursor ahead of what it can
see, so one arriving anyway is corrupted, forged, or borrowed from another
org's sequence space, and is treated as an error rather than hidden as an
empty page. A negative or non-integer cursor never reaches this check at
all — `PullSyncOpsRequest`'s `nullable|integer|min:0` rule rejects it with
a 422 first.

**Page size is 200, capped by fetching 201 and checking the count.** Kept
deliberately small: this response has to complete over a connection bad
enough that the offline-first architecture exists for in the first place
(`docs/reference/clintra-cli-brief.md`, section 1 — the app "opens and
works with the network down"). Each row's `payload` is a full entity (a
`visits` row has roughly twenty columns), so 200 keeps one page's JSON
small enough that a single round trip stays resumable within an ordinary
request timeout, instead of one giant page risking a timeout with no
partial progress to show for it. `has_more` tells the client whether to
keep calling with the newly returned cursor.

**The ledger doesn't store row content, so `payload` is read fresh at
pull time.** `sync_ledger` records that an `entity_id` changed and what
`rev` it reached — never the field values themselves. `SyncPuller`
resolves each row's current state with a plain `SELECT ... WHERE id = ?`
against that entity's own table at the moment of the pull, through that
table's own RLS policy, not a historical snapshot. `null` means the row
has since been deleted by this op or a later one — the pulling device's
own job to interpret once `HttpTransport` exists to hand it this response
at all.

**Two things this endpoint deliberately does not do, flagged rather than
guessed at** — both spelled out in `docs/sync-plan.md`'s Q9:

- **No 60-day windowing.** The brief bounds local storage to the last 60
  days and the next 60 days, but that only has an unambiguous meaning for
  entities with their own date (`visits.visit_date`, `day_state.date`).
  Most syncable tables — `patients`, `services`, `memberships` — have no
  principled date to filter by; a patient created 90 days ago can still
  have a visit tomorrow. Inventing a per-entity rule (e.g. windowing by
  `created_at`) risks silently starving a device of rows it still
  legitimately needs. This endpoint currently returns full history, no
  age cutoff, until a real rule exists.
- **A device's own ops are not excluded from its own pull.** Excluding
  them looked appealing — a device already knows what it just pushed —
  but breaks recovery from a push that succeeded server-side while its
  own response was lost in transit: with no other device around to later
  touch the same row, the pushing device would have no other way to ever
  learn the `rev` it needs for `base_rev` on its next edit. Pull is the
  one channel guaranteed to eventually tell a device its own outcome, so
  every row it's entitled to see through RLS is included regardless of
  which device wrote it.

## The sync endpoint is accept-or-reject only

**Standing rule**: the sync push endpoint accepts or rejects the op in
front of it. It never modifies a third row — any row other than the one
`entity_id` the op itself names — on its own initiative. If a design
needs to attribute a change to an acting membership and there isn't a
real one, the design is wrong, not the audit trail.

**The one narrow exception, made explicit so the rule isn't read more
loosely later**: the endpoint may write the *calling device's own*
metadata — specifically `device.clock_skew_ms`/`clock_skew_observed_at`
(`SyncOpApplier::checkClientClock`). This is the device recording a fact
about itself as a side effect of the request it is already making, not
the server rewriting another actor's data on its own initiative — the
device's own row is not a third row in the sense this rule forbids. It is
still bound by the rule's spirit: it never writes anything that isn't
either (a) the entity the op names, or (b) the calling device's own
identity row, and it never writes anything attributed to an actor other
than the one the token resolves.

This rule exists because an earlier version of `resolveSlotConflict`
broke it: when a chronologically older `create` lost a race to an
already-accepted newer row, that version *evicted* the occupant —
mutating `visits` (`is_overbooked = true`, `unique_scheduled_at` cleared,
`position` bumped) or deleting `day_state` outright — to let the older op
claim the slot retroactively. Asked to explain that design before pull
was built on top of it, three problems fell out of the same mistake:

- **No real audit actor.** The eviction had no acting membership of its
  own to attribute a change to — it was the *server's* decision, on
  behalf of nobody, about a row a different device owned.
- **No discoverability.** The evicted device had already received
  `accepted` for its own push, truthfully, before the eviction happened
  in a later, unrelated request. Nothing could tell it afterward —
  `GET /api/sync/pull` didn't exist yet at the time, so there was no
  mechanism at all, not even a designed-but-unbuilt one. It exists now
  (see "The sync pull endpoint" below) precisely so a losing device learns
  the truth by asking, instead of the server rewriting anything for it.
- **No respect for a closed day.** `day_state`'s eviction branch deleted
  the existing row unconditionally, including a row with `is_closed =
  true` and a real, computed `avg_consult_minutes` — an operation that
  should never have been able to run against a closed day, because it
  shouldn't have been able to run against *any* row it wasn't given.

All three are branches of the same root cause, not three separate bugs:
once the endpoint stopped being accept-or-reject-only, there was no
principled place to stop.

## Slot conflicts: accept-or-reject, not chronologically-older-wins

`resolveSlotConflict` now does exactly one thing: if a `create`'s natural
key collides with an existing row, `rejected`/`conflict_slot_taken` —
always, regardless of `created_at`. No lookup of the occupant's original
timestamp, no comparison, no second insert. This is the op-in-front-of-it
being rejected, full stop.

**Deliberate departure from the brief's literal text, accepted knowingly
(`docs/sync-plan.md`'s Q4/Q5).** Section 8 says "the chronologically
older wins." As implemented, the slot instead goes to whichever op
*arrives* first — the brief's rule holds only when arrival order and
chronological order happen to agree. The exact scenario this costs:
**two devices book the same slot while both offline; the device with the
chronologically earlier booking reconnects last.** Under the brief's
literal rule it should still win; under this implementation it loses,
because winning would require the server to rewrite the other device's
already-accepted row on its own initiative — precisely what the standing
rule above forbids. The alternative (evicting the current occupant) is
the design just removed, for the three reasons above. Fixing this
properly needs a pull endpoint the losing device can use to notice its
booking failed and rebook — not a server-side rewrite of someone else's
row.

`created_at` validation is unchanged and still worth having even though
nothing compares it for a *winner* anymore: reject a slot op as `failed`
if it's in the future relative to server time (`future_dated_created_at`),
or more than 60 days in the past (`created_at_outside_window`, the
brief's own local-storage window). Every slot op's observed skew (server
time minus claimed `created_at`) is still recorded into
`device.clock_skew_ms` regardless of outcome, so a device's clock
drifting slowly stays visible. `sync_ledger.client_created_at`
(`docs/schema.md`'s "v13 additions") is retained too — every accepted
op's claimed timestamp is still worth recording as ledger history, even
though nothing reads it back for a decision any more.

## Closed days are immutable in the database

The brief is silent on whether a closed day can be reopened or modified
— checked directly (`grep -n -i "clos"` across the whole document; it
only ever mentions "day close" as a screen/feature). This is therefore a
standing decision, not a brief requirement: once `day_state.is_closed` is
`true`, that row can never be modified or deleted, by any role, through
any connection (`2026_09_12_000018_lock_closed_day_state.php`).

**Enforced with a trigger, not an RLS policy — the trigger is the
strictly tighter guarantee.** An RLS policy only ever binds `clintra_app`
(RLS via `ENABLE`) and `clintra_owner` (RLS via `FORCE`); `clintra_fixtures`
and any future `BYPASSRLS` role would pass straight through it — the same
gap `enforce_row_rev()` was built to close for `rev` itself
(`2026_09_12_000012_add_row_versioning.php`). A `BEFORE UPDATE OR DELETE`
trigger fires for every role unconditionally, RLS-bound or not. It checks
only `OLD.is_closed` — the transition that actually closes a day
(`false` -> `true`) is untouched; only a row *already* closed is locked.

The push endpoint catches this specific failure (`SQLSTATE 55000`,
`object_not_in_prerequisite_state` — a real Postgres class, not a custom
one) and maps it to a clean `rejected`/`conflict_day_closed`, the same
"never leak a SQLSTATE" discipline as everything else in
`SyncOpApplier`. Confirmed before this landed, not assumed: no screen in
`web/src/` currently sets `day_state.is_closed` to `true` at all — the
day-close screen (13, "إقفال اليوم") writes a separate `cash_close` row
entirely — so this constraint introduces no product conflict with
anything shipped today.

**Confirmed, not assumed: this endpoint holds no privilege beyond the
ordinary `clintra_app` connection.** It runs no `SECURITY DEFINER`
function, owns no `BYPASSRLS` role, and is subject to every RLS policy
like any other write through this connection — the grants audit that
mattered for `register_device` (a `BYPASSRLS` path) simply doesn't apply
here by construction.

Full test coverage in `tests/Feature/Rls/SyncPushTest.php` and
`tests/Feature/Rls/ClosedDayStateTest.php`.

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
