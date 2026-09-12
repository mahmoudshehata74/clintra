# Clintra data schema (v1)

This is the single source of truth for record shape, shared by the local
IndexedDB store today and the future Laravel API.

## Conventions

- Field names are snake_case and identical to the eventual database column
  names. There is no camelCase mapping layer between the local store and
  future API payloads.
- Ids are UUID v4 strings.
- Money is an integer number of piastres.
- A day is a `"YYYY-MM-DD"` string in Africa/Cairo.
- Times are `"HH:MM"`.
- Instants are ISO 8601 UTC strings.
- `?` marks a nullable field.
- Where the specification defines a composite key and the local store needs a
  single primary key, an `id` field is added. This is noted per table below.

## v1 tables

### organizations
id, name, plan_tier (small|medium|large), created_at

### locations
id, org_id, name, address, phone, is_active

### users
id, full_name, phone, email?, is_active

`phone` is unique — see v4 additions for why this differs from
`patients.phone`.

### memberships
id, user_id, org_id, role, location_scope, practitioner_scope,
practitioner_id? (required only when practitioner_scope is self), pin_hash,
is_active

### membership_locations
membership_id, location_id

*`id` added: the natural key is the composite `membership_id + location_id`.*

### membership_practitioners
membership_id, practitioner_id

*`id` added: the natural key is the composite `membership_id + practitioner_id`.*

### practitioners
id, org_id, user_id?, full_name, specialty_id, title, is_active

### practitioner_locations
practitioner_id, location_id, is_active

*`id` added: the natural key is the composite `practitioner_id + location_id`.*

### services
id, org_id, name, duration_minutes, default_price, is_active

### service_price_overrides
id, service_id, practitioner_id?, location_id?, price

### schedules
id, practitioner_id, location_id, weekday (0-6), start_time, end_time,
mode (slots|queue), slot_minutes? (slots mode only),
max_capacity? (queue mode only), resource_count (default 1)

### schedule_exceptions
id, practitioner_id, date, type (closed|extra|shifted), start_time?,
end_time?, shift_minutes?

### patients
id, org_id, full_name, phone?, gender?, birth_year?, note?, created_at

`full_name` search folds letter variants for comparison only: storage is
never rewritten and the UI always displays exactly what was typed. The
Laravel patients search endpoint must apply the identical fold. Exact code
points folded (see `web/src/domain/arabicText.ts`): U+0649 (ى) -> U+064A
(ي); U+0629 (ة) -> U+0647 (ه); U+0623 (أ), U+0625 (إ), U+0622 (آ) and U+0671
(ٱ) all -> U+0627 (ا); U+0624 (ؤ) -> U+0648 (و); U+0626 (ئ) -> U+064A (ي);
tashkeel (U+0610-061A, U+064B-065F, U+0670, U+06D6-06ED) is stripped;
Arabic-Indic digits U+0660-0669 fold to ASCII 0-9; runs of whitespace
(including non-breaking space) collapse to one space; case is folded. No
other hamza-carrier (e.g. plain U+0621 ء) is folded.

`phone` is intentionally not unique per organization. Families share phone
numbers — a spouse or a child registering against a parent's phone is a
normal, valid case, not a data-entry accident. The safeguard against
unintentional duplicates is the search results row showing each match's
last-visit date, which staff read before creating a new patient. Any future
migration must not add a unique index here.

### visits
id, org_id, location_id, practitioner_id, patient_id, service_id?,
care_plan_item_id? (left null in v1), visit_date, position, scheduled_at?
(null in queue mode), status, is_overbooked, source (phone|walkin|recovered),
arrived_at?, started_at?, ended_at?,
cancel_reason? (patient|clinic|no_show|postpone), rescheduled_from?,
created_by (membership id), created_at

Moving a visit creates a new row at the target slot (`rescheduled_from`
pointing back to the original) and marks the original row
`rescheduled`/`postpone`, rather than updating one row's own date and time in
place — this is what `rescheduled_from` and the `rescheduled` status
describe, and the only one of the two models this codebase implements.

### day_state
practitioner_id, location_id, date, delay_minutes, is_closed,
avg_consult_minutes? (derived from started_at to ended_at)

*`id` added: the natural key is the composite `practitioner_id + location_id + date`.*

### invoices
id, org_id, location_id, number (sequential per location per year),
patient_id, practitioner_id, visit_id?, total, paid,
status (unpaid|partial|paid|void), issued_at

### invoice_items
id, invoice_id, service_id, description, qty, unit_price, total

### payments
id, invoice_id, amount, method, receipt_number, note?, created_by, created_at

### cash_close
id, location_id, date, total_expected, total_collected, difference,
difference_note? (required when difference is not zero), closed_by, closed_at

### audit_log
id, org_id, actor_membership_id, entity, entity_id,
action (create|update|delete), before?, after?, at

`actor_membership_id`: before v1 auth (Layer 2, the staff PIN) ships, this may
be the seeded assistant — the dev-only stand-in `resolveActingMembership()`
returned when there was no real session. After auth ships, it is the truly
acting membership (the one whose PIN unlocked the current session). Earlier rows
are never rewritten: history stays as it was recorded.

### specialty_templates
id, org_id? (null means a system-wide template), key, name,
generation (none|repeat|sequence|interval), default_count?, gap_days?,
resource_type?, pricing_mode (per_item|package), stall_days?, unit_label,
provider_label

**In v1 scope** — see `docs/design-audit.md`'s decision A. This table and
the two below were previously filed under "declared now, unused in v1, no
screens"; that scoping was wrong, not the schema itself. The design
reference's screen 10 ("الزيارة — النموذج العام," the general visit form)
is a real v1 screen and is the first screen to read these three tables.
No field on any of the three changed.

### form_definitions
id, template_id, version, schema, is_current

### visit_form_data
visit_id, form_definition_id, data

*`id` added: the natural key is the composite `visit_id + form_definition_id`.*

## Declared now, unused in v1, no screens

### care_plans
id, org_id, location_id, template_id, patient_id, practitioner_id, goal,
diagnosis, planned_count, total_price, paid, status, started_at, expected_end

### care_plan_items
id, care_plan_id, service_id, sequence, visit_id, min_gap_days,
depends_on_item_id, price, status

## Decisions

Fields the specification left open:

- `payments.method`: `cash | card | wallet | transfer`
- `practitioners.specialty_id`: in v1 it always references the single
  `specialty_templates` row with key `"general"`.
- `day_state.avg_consult_minutes`: the specification's own note next to this
  field said only "derived from started_at to ended_at," without saying
  which statistic. Wired as the **median**, not the mean, across every
  completed visit for that practitioner+location+date so far (see
  `web/src/domain/consultStats.ts`) — one unusually long consultation (an
  emergency, a difficult case) would drag a mean far from what most patients
  actually experience, which is exactly the number this field exists to show
  staff and waiting patients. Recomputed and written in the same transaction
  as every visit's completion (`web/src/db/visitCompletion.ts`), never
  incrementally, so it is always an exact recomputation from the full set of
  completed visits that day rather than a running approximation that could
  drift.

## v2 additions

### sync_ops
op_id, entity, entity_id, action (create|update|delete), payload, device_id,
created_at, synced_at?

Queued by the audited mutation pipeline (see `web/src/db/mutate.ts`) for the
future sync transport. `op_id` is its own primary key, distinct from
`entity_id`. Added in local database version 2; version 1's tables are
unchanged.

## v3 additions

### visits.unique_scheduled_at

Equal to `scheduled_at`, except entirely absent (not merely null) when
`is_overbooked` is true. Backs a unique index on
`[practitioner_id+visit_date+unique_scheduled_at]` in the local store, so
IndexedDB itself enforces "a visit's `scheduled_at` is unique per
practitioner per day, except when `is_overbooked` is true" (see Rules below)
— a record missing a compound index's key path component is excluded from
that index entirely, which is how the `is_overbooked` exception is expressed.
Added in local database version 3; versions 1 and 2 are unchanged.

## v4 additions

### users.phone

Unique, globally rather than per organization: `users` has no `org_id` of
its own — only `memberships` does, since a user's organizations are its
memberships (one `user_id` can have a `membership` row in more than one
org). A per-org unique key is therefore not something `users` can express,
and would not match what the table represents. Unlike `patients.phone`,
there is no household-sharing rationale for staff: a `users` row is one
real person's login identity, and each of that person's org-scoped roles is
its own `memberships` row referencing the same `user_id`. Letting two
`users` rows share a phone would risk fragmenting one real person's
activity across two disconnected identities instead of one `user` with
multiple memberships. Backs a unique index on `phone` in the local store.
Added in local database version 4; versions 1-3 are unchanged.

## v5 additions

### day_state's natural key, enforced

`day_state` was declared in v1 with its natural key noted as the composite
`practitioner_id + location_id + date`, but the local store had no index
enforcing it while the table stayed unused. The doctor-delay feature is the
first writer, so that natural key is now a real unique index
(`[practitioner_id+location_id+date]`), preventing two rows for the same
practitioner's same day. Added in local database version 5; versions 1-4 are
unchanged.

## v6 additions

### sync_review

id, op_id, entity, entity_id, reason, payload, needs_review, created_at

Written by the sync engine (`web/src/sync/engine.ts`) when the transport
rejects a pushed `sync_ops` row instead of accepting it or reporting it a
duplicate. Nothing is deleted: the rejected `sync_ops` row is left exactly as
it was (`synced_at` stays null), and this row preserves the op's payload and
the rejection reason (e.g. `conflict_slot_taken`) for an assistant to review.
`op_id` is not unique here — see the code comment in `web/src/db/database.ts`
for why the same op could in principle be reviewed more than once. Added in
local database version 6; versions 1-5 are unchanged.

## v7 additions

### invoices.issued_year; invoices, payments and cash_close natural keys enforced

`invoices.number` was always specified as "sequential per location per
calendar year" in this table's own v1 description above, but the v1 Rules
section below it said only "unique per location" and the local store's index
matched that narrower, wrong statement (`&[location_id+number]`, no year) —
an inconsistency in this document, not a deliberate change. Fixed now that
invoicing is implemented: invoices gain `issued_year` (the Africa/Cairo
calendar year of `issued_at`, via `domain/time.ts`'s `cairoYear` — a real
stored field, since a compound unique index needs an actual key path, not a
value derived from another field on read), and the local store's index is
`&[location_id+issued_year+number]`. The number itself is reserved inside the
same transaction that writes the invoice (see `db/visitCompletion.ts`), so
concurrent completions at the same location never collide or leave a gap:
IndexedDB serializes overlapping readwrite transactions on the same store, so
the second transaction's read of the current max number never runs until the
first has already committed its own row.

`invoices.visit_id` and `invoices.location_id` are now indexed (plain, not
unique) — the former so a screen can look up a visit's invoice, the latter for
the cash-close and number-reservation queries. `invoice_items.invoice_id` is
likewise now indexed (plain), so a screen can list one invoice's items.

`payments` gains `location_id` (denormalised from its invoice at write time,
not just derivable by a join, so it can be indexed directly) and
`after_close` (see below). `receipt_number`'s "sequential per location,
across all time" rule — always documented, in the v1 table description above
— was likewise never an enforced index; it now backs a real
`&[location_id+receipt_number]` unique index, reserved inside the same
transaction as the payment write for the same reason as invoice numbers.

`cash_close`'s natural key (`location_id + date`, documented since v1) was
also never enforced; it now backs a real `&[location_id+date]` unique index,
so a second close for the same location and day is rejected by the database
itself, not just discouraged by the UI.

`payments.after_close` is a boolean, true when a `cash_close` row already
existed for that payment's location and day at the moment it was recorded — a
late payment against an already-closed day, flagged so it is visible in the
audit log rather than blending silently into a day whose numbers were already
reconciled. Set by the write path (`db/payments.ts`), not user-editable.

Added in local database version 7; versions 1-6 are unchanged.

## v8 additions

### device

id (the device_id), org_id, location_id, registered_at

This browser's device registration. Exactly one row per browser, keyed by the
device_id itself. The device_id previously lived in `localStorage`
(`clintra:device_id`); version 8 moves it into the database so it shares fate
with the data it stamps (`sync_ops.device_id`) and is covered by the
persistent-storage grant. On first launch after the upgrade, application code
(`web/src/db/deviceRegistration.ts`) migrates an existing `localStorage`
device_id into this row — keeping a deployed device's identity — then deletes
the `localStorage` entry. Migration runs in application code rather than a Dexie
upgrade callback because it needs the seeded org+location to bind to, and the
seed runs after upgrades.

`org_id` and `location_id` record which org and location this device serves.
`getDeviceBinding()` (same module) is the single source of truth for these
three ids, so replacing the seed-based binding with the future Laravel-backed
registration is a one-file change. In v1 the binding comes from the seed (the
first active location and its org); there is no device-login screen yet, so
registration is transparent — see `docs/auth-plan.md` Layer 1.

Added in local database version 8; versions 1-7 are unchanged.

## v9 additions

### memberships.pin_salt; memberships.is_active index

Staff PIN authentication (Layer 2 — see docs/auth-plan.md). `memberships`
gains `pin_salt`, the per-membership random salt for `pin_hash`. The PIN is
hashed with Argon2id (`@noble/hashes`) under the parameters in
`web/src/auth/pinHashParams.ts`; the salt is a value field, not an index — hash
and salt are only ever read by primary key alongside the rest of the row — so
this version's only real index change is a plain `is_active` index on
`memberships`, used to list the pickable memberships on the lock screen.

`pin_salt` is nullable: rows written before this version, and any membership
whose PIN has not been set, carry none. There are no real PINs deployed yet
(the seed's `pin_hash` was a placeholder), so no data upgrade runs — a fresh
seed writes real salted hashes for the dev PINs (`web/src/auth/devPins.ts`,
dev-only and to be removed with the real setup flow).

PIN length is four digits in v1 but the column accepts any length, so a future
6-digit clinic is a config change, not a schema change. Changing the Argon2id
parameters later needs no migration either: the next successful PIN entry can
re-hash transparently, since a stored hash is only ever compared against a
fresh hash of the entered PIN.

Added in local database version 9; versions 1-8 are unchanged.

## v10 additions

### activation_codes

id, org_id, location_id, code_hash, expires_at, used_at, used_by_device_id?,
created_at

Server-side only — API schema, not (yet) a local IndexedDB table. Backs
real device registration (`docs/auth-plan.md`'s Layer 1, Q2): a one-time
credential an owner types into a new device to activate it against their
org and a specific location. `code_hash` is a SHA-256 hex digest; the
plaintext code (format `CLT-XXXX-XXXX-XXXX-XXXX`, 16 characters from an
unambiguous alphabet excluding `0/O/1/I/L`, CSPRNG-generated) is never
stored and is shown to the installer exactly once, at creation time.
Single-use: `used_at` is set atomically on successful registration, and a
code with `used_at` already set — or past `expires_at` (72 hours after
`created_at`) — is rejected identically to one that never existed, so a
failed registration attempt reveals nothing about *why* it failed.
`used_by_device_id` records which device consumed it, once used.

Minted two ways, both through the API's provisioning path (never through
the ordinary tenant-facing connection — see `api/docs/rls.md`): once
automatically when an organization is first provisioned
(`php artisan clintra:provision`), and again on demand for a replacement
device (`php artisan clintra:mint-activation-code`), since devices get
replaced over a clinic's lifetime.

### device.membership_id

`device` (v8) recorded which org and location a device serves, but not
which membership activated it — needed once device registration issues a
real Sanctum token, which must be bound to a specific membership as well
as a specific device (`api/docs/rls.md`'s "Provisioning: the one door into
an empty database" — the same bootstrapping concern applies to
registration). Set once, at registration, to the owner membership whose
phone + activation code activated the device; not reassigned afterward in
v1 (there is no multi-staff API session yet — Layer 2's PIN switching
stays local-only, per `docs/auth-plan.md`).

Added in local database version 10 (API-side only so far — `web/src/db/database.ts`'s
local `device` table does not yet have `membership_id`, since the web
client does not yet talk to this endpoint); versions 1-9 are unchanged.

## v11 additions

### audit_log.seq

A strictly monotonic, globally-unique write counter (`UNIQUE` constraint)
recording actual insertion order — never derived from `at`, which is
millisecond-resolution and can tie between two writes in the same
transaction.

Two independent implementations, not shared code, because they solve the
same problem in two different concurrency models:

- **Web** (local IndexedDB, shipped): a per-device Dexie `version(11)`
  migration reserves `seq` inside the same transaction as the row itself
  (`db/mutate.ts`'s `applyEntityWrite`) — safe because a single IndexedDB
  instance has one writer at a time. Fixed a real bug: `undoMostRecentMutation`
  used to compare `at` timestamps alone to find "the most recent mutation,"
  which could tie and fall back to IndexedDB's primary-key (UUID) iteration
  order — meaningless as a tiebreaker.
- **API** (Postgres, this version): `seq` is a native identity column
  (`GENERATED BY DEFAULT AS IDENTITY`), not application-computed. An
  earlier version computed it the same way the web side originally did —
  `SELECT MAX(seq) + 1`, reserved inside the same transaction — but a
  single Postgres database has multiple concurrent writers, where "the
  same transaction" guarantees nothing about two *different* transactions
  reading the same `MAX` at once. Since `seq` is `UNIQUE`, the collision
  didn't produce ambiguous ordering — it raised a unique-violation that
  rolled back the entire surrounding transaction (a provisioning or
  device-registration call could fail outright on an unrelated table's
  constraint). `nextval()` on a real sequence is atomic under concurrency
  by construction, which a read-then-write pair never is.

**Not yet reconciled**: the web's local counter and the API's identity
column are two entirely separate sequences (per-device vs.
database-global) with no relationship to each other today, because no
sync mechanism exists yet that pushes a device's local `audit_log` rows to
the API — see `docs/session-handoff.md`'s open items. Designing that
reconciliation (whether the server re-numbers incoming rows, keeps a
separate per-device sequence, or something else) is a later step, not
decided by this version.

## v12 additions

Server-side only — none of the three additions below exist yet in the
local IndexedDB store. They implement the first two items of
`docs/sync-plan.md`'s checklist: row versioning and the sync ledger, the
foundations the eventual push/pull endpoints will build on. No endpoint
exists yet; these are storage only.

### `rev` on every syncable table

`cash_close`, `day_state`, `invoice_items`, `invoices`,
`membership_locations`, `membership_practitioners`, `memberships`,
`patients`, `payments`, `schedules`, `service_price_overrides`,
`services`, `visit_form_data`, `visits` each gain `rev` — a server-assigned
integer, starting at 1 on insert and incremented on every accepted update.
This is `docs/sync-plan.md`'s Q5 edit-conflict mechanism: a future push
endpoint rejects any op whose `base_rev` doesn't match a row's current
`rev`.

The syncable-table list is every entity `web/src/db/mutate.ts` callers
actually pass to `mutate()`/`applyEntityWrite()` today (`entity: "..."` at
each call site), cross-checked against this file and the CLI brief's
section 9 rule 10 — not a guess from the v1 table list alone, since several
v1 tables (`organizations`, `locations`, `practitioners`,
`specialty_templates`, `form_definitions`, `schedule_exceptions`, `device`,
`activation_codes`) have no client write path in v1 at all and are
deliberately excluded.

**`users` is deliberately excluded, not omitted by oversight.** Every other
syncable table has exactly one owning organization; `users` does not — it
has no `org_id` column at all, and the same row is visible to (and, per its
RLS policy, editable by) every org a person holds a membership in
(`id IN (SELECT user_id FROM memberships WHERE org_id = current_org())`).
Giving it `rev` today would make it the first table where two *different
organizations'* devices could race on the same counter — a materially
different kind of conflict than anything else in this schema, and a
product decision this version does not make. Revisit when `users` actually
needs edit-conflict detection.

`rev` is enforced by a single shared trigger (`enforce_row_rev()`), not by
restricting `clintra_app`'s column grants — see
`api/database/migrations/2026_09_12_000012_add_row_versioning.php`'s own
comment for why a trigger is the only mechanism that actually computes the
increment, and why it requires no grant changes at all. A client-supplied
`rev` value, on insert or update, is never honoured: the trigger overwrites
it unconditionally before the row is written.

### `sync_ledger`

seq, op_id, org_id, entity, entity_id, rev, actor_membership_id, device_id,
applied_at

The server-side record of every accepted sync op, backing the pull cursor
`docs/sync-plan.md`'s Q9 decided on: a device pulls everything with `seq`
greater than the last one it saw — `seq` is a real Postgres identity
column, the same pattern `audit_log.seq` uses (see "v11 additions" above),
never a client-supplied timestamp. `op_id` is unique — the idempotency key
the CLI brief describes ("the server ignores any duplicate op_id"). FORCE
RLS, org-scoped, append-only: no `UPDATE`/`DELETE` policy exists at all, the
same as `audit_log`.

Not the same table as `sync_ops` (v2 additions, above) — that table already
exists server-side too (`api/database/migrations/2026_09_11_170027_create_sync_ops_table.php`),
mirroring the client's own outbound-queue shape, but nothing writes to it
yet. `sync_ledger` is a different, additive concept: a lean, ordered
receipt of what was actually applied and what `rev` it produced, not a
payload archive. Whether a future push endpoint also writes into the
existing `sync_ops` table (as a payload/idempotency store) alongside
writing here is that endpoint's own decision, not resolved by this version.

### `device.clock_skew_ms`, `device.clock_skew_observed_at`

Storage only, both nullable — no enforcement logic exists yet. Groundwork
for `docs/sync-plan.md`'s Q5 slot-conflict rule ("chronologically older
wins," per the CLI brief section 8): resolving a slot conflict by client
`created_at` requires defending against a badly-set device clock, and this
is where that observation will be recorded once a push endpoint exists to
compute it (comparing a device's claimed `created_at` against the server's
own clock). The rejection rules themselves (future-dated ops, ops outside
the 60-day window) belong with that future endpoint, not this version.

## v13 additions

The push endpoint (`POST /api/sync/push` — see `api/docs/rls.md`'s "The
sync push endpoint") turned two of v12's "storage only, no enforcement
yet" additions into load-bearing columns, and found one was sized wrong.

### `sync_ledger.client_created_at`

Added because implementing v12's own slot-conflict rule required it:
comparing "which op is chronologically older" needs the *client's*
claimed timestamp for whichever op currently occupies a slot, and not
every syncable table carries its own `created_at` column (`day_state`
doesn't). `sync_ledger` already records one row per accepted op, so this
is the single, uniform place every syncable table's original op timestamp
is now guaranteed to be recorded, regardless of whether the entity table
itself has anywhere to put it.

### `device.clock_skew_ms` widened to `bigint`

Shipped in v12 as a plain `integer` (max ~2.1 billion). 60 days in
milliseconds — the brief's own window, the exact case this column exists
to make visible — is already ~5.18 billion, past `integer`'s range before
the skew itself is even unusually large. A real push against this column
overflowed immediately once the 60-day-window test was written. Widened
to `bigint`.

## Rules

- A visit's `position` is unique per practitioner per day.
- A visit's `scheduled_at` is unique per practitioner per day, except when
  `is_overbooked` is true.
- An invoice `number` is unique per location per calendar year (Africa/Cairo;
  see v7 additions — this line previously said "per location" only, which was
  an error in this document, not the implementation it now matches).
- A payment's `receipt_number` is unique per location, across all time (never
  reused, never scoped to a year or a single invoice).
- A `cash_close` is unique per location per day.
- Practitioner availability is computed across all locations: a practitioner
  booked at a time in one location is busy in every other location.
- `no_show` is a status in its own right and is never merged with `cancelled`.
- An invoice can never be voided once any payment exists against it.
- Every payment carries its own receipt number.
- A user's `phone` is unique (see v4 additions); a patient's `phone` is
  deliberately not (see the patients table note) — these are different
  entities with different rules, not an inconsistency.
