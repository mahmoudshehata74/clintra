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
is_active, display_name? (see v21 additions)

### membership_locations
membership_id, location_id

*`id` added: the natural key is the composite `membership_id + location_id`.*

### membership_practitioners
membership_id, practitioner_id

*`id` added: the natural key is the composite `membership_id + practitioner_id`.*

### practitioners
id, org_id, user_id?, full_name, specialty_id, title, is_active,
syndicate_number? (see v18 additions)

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
max_capacity? (queue mode only), resource_count (default 1),
next_mode? (slots|queue), next_mode_from? (date) — see v23 additions

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
created_by (membership id), created_at, note? (see v15 additions)

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

None left: `care_plans` and `care_plan_items` were declared here in v1 and
are in use from v20 (see the v20 additions below).

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
concurrent completions *on one device* never collide or leave a gap:
IndexedDB serializes overlapping readwrite transactions on the same store, so
the second transaction's read of the current max number never runs until the
first has already committed its own row. *Correction:* this paragraph used to
say concurrent completions "at the same location" never collide. That holds
only within one device's own IndexedDB: two devices at one location each read
their own local max, so both minted the same next number while offline, and
the second push died on the server's unique index. The v16 additions below
fix this with a per-device number series.

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
needs edit-conflict detection. (v21: still not syncable — a staff member's name moved to
`memberships.display_name` instead, and staff are added on the server, so
the device never writes a `users` row; see the v21 additions.)

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

Added to compare "which op is chronologically older" when resolving a
slot conflict — an initial version of that resolution read this column
back to decide whether an incoming op should evict the row currently
holding a slot. That comparison (and the eviction it fed) was removed:
the sync endpoint never modifies a row it wasn't given, so nothing reads
this column back for a decision any more (see `api/docs/rls.md`'s "The
sync endpoint is accept-or-reject only"). The column stays: `sync_ledger`
already records one row per accepted op, and the client's claimed
timestamp is still worth keeping as ledger history — not every syncable
table carries its own `created_at` column (`day_state` doesn't), so this
remains the one place every syncable table's original op timestamp is
guaranteed to be recorded, even though it is currently write-only.

### `device.clock_skew_ms` widened to `bigint`

Shipped in v12 as a plain `integer` (max ~2.1 billion). 60 days in
milliseconds — the brief's own window, the exact case this column exists
to make visible — is already ~5.18 billion, past `integer`'s range before
the skew itself is even unusually large. A real push against this column
overflowed immediately once the 60-day-window test was written. Widened
to `bigint`.

## v14 additions

### `day_state`'s closed-row lock

Once `day_state.is_closed` is `true`, the row can never be `UPDATE`d or
`DELETE`d, by any role, through any connection — enforced by a trigger
(`2026_09_12_000018_lock_closed_day_state.php`), not an RLS policy, since
a trigger is the only mechanism that also binds `BYPASSRLS` roles. The
brief is silent on whether a closed day is immutable (checked directly,
not assumed); this is a standing decision this version makes, prompted by
a real bug: an earlier version of the sync push endpoint's slot-conflict
resolution could delete a `day_state` row unconditionally, including one
with `is_closed = true` and a real, computed `avg_consult_minutes` — see
`api/docs/rls.md`'s "The sync endpoint is accept-or-reject only." Only
the transition *into* being closed (`false` -> `true`) is allowed; a row
already closed is locked from that point on. Confirmed before this
landed: no screen in `web/src/` currently sets `day_state.is_closed` to
`true` at all, so this introduces no product conflict with anything
shipped today.

## v15 additions

### visits.note

The doctor's quick free-text note on one visit: a nullable `text` column on
`visits` itself, not a separate table (owner decision — a note has no
history, author or timestamp of its own beyond its visit's). Null means "no
note"; an empty string is never stored, since the one write path
(`web/src/db/visitNote.ts`'s `setVisitNote`) trims the input and stores an
empty result as null. That write goes through `mutate()`, so every change
is audited and queued for sync like any other visit write, and writing the
value already stored is a no-op (no audit row, no sync op). The audit log
reads a note change as "عدّل ملاحظة الزيارة" and never shows the note's own
text (`web/src/domain/auditVerb.ts`).

Every path that creates a visit (booking, overbooking, walk-in/queue,
move, the seed) sets `note: null` explicitly. A move does not carry the
original visit's note to the new row, and reusing a freed row at a slot
clears whatever note that row held.

Server: `2026_09_12_000023_add_note_to_visits_table.php` adds the column. No
RLS change: `visits_scope` filters rows, not columns, with the same
expression for `USING` and `WITH CHECK`, so a membership that cannot see a
visit cannot see its note; `clintra_app`'s grant on `visits` is table-level,
so it already covers the column; the `rev` trigger already bumps `rev` on a
note-only update. It syncs like every other visit field: the push applier
merges the payload as-is, and pull and bootstrap return whole rows, so no
sync code names it (`api/tests/Feature/Rls/VisitNoteSyncTest.php`).

Local: database version 14 backfills `note: null` onto every existing visit
that has no `note` field, leaving any note a row already carries (a row
pulled from an already-migrated server) untouched. No index: a note is only
ever read and written by primary key with the rest of its visit. Versions
1-13 are unchanged.

## v16 additions

### Per-device number series: device.series, invoices.series, payments.series

Owner decision. Every device at a location holds a number series — 1, 2, 3
... per location, assigned once at registration and never reused (a revoked
device keeps its own) — and mints invoice and receipt numbers only inside
it. Two devices can therefore never mint the same number, offline or not,
and a printed number never changes.

- `device.series` (smallint; server-side NOT NULL and unique per
  `location_id`). Assigned by `register_device(jsonb)`: max + 1 across every
  device ever registered at the code's location, revoked ones included,
  serialised per location by a transaction-scoped advisory lock
  (`api/docs/rls.md`'s "Per-device number series"). Returned as `series` in
  the registration response, and as `device_series` on every
  `GET /api/sync/pull` and `GET /api/sync/bootstrap` page, so a device
  registered before this change learns its series on its next pull. Server
  migration (`2026_09_12_000024_add_device_number_series.php`): existing
  devices are numbered per `location_id` in `registered_at` order, then
  `id`. Local store (database version 15): nullable — null until the server
  has said; the seed/demo device (no token, never talks to a server) is 1.
  The sync engine stores a reported series only over null; a different
  non-null value is never written over the stored one — it is logged and
  left as one `sync_review` row (entity `device`, reason
  `device_series_conflict`) for support.
- `invoices.series`, `payments.series` (smallint, NOT NULL, no default):
  the series of the device that minted the row. Every row that existed
  before this version is series 1, on the server and in every local store
  (an unsent invoice or payment op's payload gets the same 1 locally).
- **Unique indexes.** Server: `UNIQUE (location_id, issued_year, series,
  number)` on `invoices` and `UNIQUE (location_id, series, receipt_number)`
  on `payments`, replacing the v7 keys. Local (database version 15):
  `&[location_id+issued_year+series+number]` and
  `&[location_id+series+receipt_number]`. Existing rows stay unique: they
  were unique on the old key, and each gains the same series, 1.
- **Minting rule.** The next invoice number is the max `number` for
  (`location_id`, `issued_year`, this device's series) + 1; the next receipt
  number is the max `receipt_number` for (`location_id`, this device's
  series) + 1 — both read inside the write's own transaction, as in v7. A
  device whose series is still null refuses to mint
  (`device_series_unknown`) before anything is written, and the screen says
  "الجهاز ده محتاج يتصل بالإنترنت مرة واحدة قبل ما يطلّع فواتير أو إيصالات".
  The push endpoint rejects a create whose `series` is not the pushing
  device's own (`series_mismatch`) and an update that changes `series`,
  `number`, `issued_year` or `receipt_number` (`number_immutable`); a create
  that still collides on the number key is `conflict_number_taken`, never
  `conflict_already_exists`.
- **Display rule** (`web/src/screens/day/invoiceNumber.ts`; the series
  letter itself now lives in `web/src/domain/numberSeries.ts`, shared with
  prescription numbers — see the v17 additions). Series 1
  renders exactly as before ("INV-2026-0043", "RCP-1189"); series n ≥ 2
  adds its letter, bijective base 26 with 1 = A, so 2 → B … 26 → Z,
  27 → AA, 28 → AB … ("INV-2026-B-0043", "RCP-B-1189"). The printed invoice
  and receipt and the audit log show the bare form, without the INV-/RCP-
  prefix ("43", "B-43"), as they always showed the bare number. Every place
  that shows or prints an invoice or receipt number goes through these
  formatters.

## v17 additions

### prescriptions, prescription_items

A visit's prescription and its drug lines. Data only so far — no screen
writes them yet (screens 10 and 16 of the prototype will).

**prescriptions**: id, org_id, location_id, visit_id, patient_id,
practitioner_id, series, issued_year, number, diagnosis?, printed_at?,
created_by (membership id), created_at, rev

**prescription_items**: id, prescription_id, name, form?, instructions,
duration?, note?, position, rev

- `name` is the drug ("Diclofenac 50mg") and `instructions` the Arabic
  dosage line; both are trimmed and never empty. `form` ("Tablet", "Gel"),
  `duration` and `note` are optional; blank is stored as null.
- `position` is 1-based, in append order: a new item takes the highest
  position so far + 1, and removing an item does not renumber the rest.

Owner decisions:

- **At most one prescription per visit** (`visit_id` unique). It is created
  together with its first item (`web/src/db/prescriptions.ts`'s
  `addPrescriptionItem`), only for a visit that is `in_room` or `completed`
  (any other status refuses, `visit_not_prescribable`). Removing every item
  leaves the numbered prescription in place, and its number stays used.
- **Numbered like an invoice** (v16 additions): minted at creation, inside
  this device's own series, as the max `number` for (`location_id`,
  `issued_year`, `series`) + 1, read inside the write's own transaction; a
  device whose series is unknown refuses before anything is written
  (`device_series_unknown`). Displayed "RX-{year}-{0000}" for series 1 and
  "RX-{year}-{L}-{0000}" for series n ≥ 2 (`formatPrescriptionNumber`,
  `web/src/domain/numberSeries.ts`, the same series letter as invoices and
  receipts). The push endpoint holds it to the same rules as invoices:
  `series_mismatch`, `number_immutable`, `conflict_number_taken`.
- **Printed lock.** The first print (`markPrescriptionPrinted`) sets
  `printed_at` and snapshots the visit's diagnosis, as the general visit
  form holds it at that moment (`readVisitFormValues`; blank is null), into
  `prescriptions.diagnosis`. Later prints write nothing. From the first
  print on, every item write and every change to the prescription itself is
  refused with `prescription_printed` — on the device, and by the push
  endpoint (`api/docs/rls.md`'s "Prescriptions"). An empty prescription
  cannot be printed (`prescription_empty`).
- **Only the visit's own practitioner writes** a prescription or its items:
  every web writer refuses unless the acting membership's `practitioner_id`
  is the visit's (`not_prescriber`). **Known gap:** the server does not
  enforce who writes. Its RLS policy admits any membership in scope of the
  visit (the visits policy, verbatim), so a device that bypassed the web
  writers could write a prescription for a visit it can see. Closing it
  needs a policy change, out of scope for v1 (`api/docs/rls.md`).

Server (`2026_09_12_000026_create_prescriptions_tables.php`): unique
indexes `(location_id, issued_year, series, number)` and `(visit_id)`, plain
indexes on `org_id`, `location_id` and `prescription_items.prescription_id`;
no foreign key cascades. `rev` with the `enforce_row_rev()` trigger, FORCE
RLS, both tables in the syncable-table list. A second prescription pushed
for the same visit is rejected as `conflict_visit_has_prescription`, never
`conflict_already_exists`. Bootstrap returns the prescriptions of the
windowed visits and their items.

Local (database version 16), two new stores:
`prescriptions: "id, &visit_id, location_id, patient_id,
&[location_id+issued_year+series+number]"` — the visit's one prescription
(and the lookup that finds it), the number-minting read, a patient's
prescriptions, and the printed number's uniqueness — and
`prescription_items: "id, prescription_id"` for one prescription's items.
Versions 1-15 are unchanged.

The audit log reads "كتب وصفة", "أضاف دواء", "عدّل دواء", "شال دواء" and
"طبع الوصفة", never a drug's name or instructions, or the diagnosis.

## v18 additions

### practitioners.syndicate_number, practitioners.rev; practitioners sync

Owner decision: the owner edits each practitioner's name, title and
syndicate number from settings (the "الأطباء" tab), and the printed
prescription shows the syndicate number.

- `syndicate_number` (varchar(50), nullable): the practitioner's medical
  syndicate registration number, stored trimmed; null means none is on
  record, and an empty entry is stored as null.
- `title` is unchanged and stays NOT NULL: it is stored trimmed, and `""`
  means "no title". One rule everywhere — the settings row, its edit form and
  the printed prescription all read both fields through
  `web/src/domain/practitionerProfile.ts`, so no screen decides "empty"
  differently. (The server receives a pushed `""` as null, through Laravel's
  global ConvertEmptyStringsToNull middleware, and stores it as `""` again:
  `api/docs/rls.md`'s "Practitioners".)
- `rev`, with the shared `enforce_row_rev()` trigger, as every other
  syncable table (v12 additions): `practitioners` joins the syncable-table
  list, in `SyncableTables::NAMES` and `DIRECT_ORG_ID_TABLES` on the server
  and `web/src/sync/syncableTables.ts` on the device.
- **Writes.** `web/src/db/practitioners.ts`'s `updatePractitionerProfile`,
  through `mutate()`: the owner only (`not_owner`); the name is required
  once trimmed; the syndicate number is at most 50 characters; writing the
  values already stored is a no-op (no audit row, no sync op). The audit log
  reads "عدّل بيانات الطبيب" under the "الإعدادات" filter, scoped to that
  practitioner's own log, and never shows a field's value.
- **Server.** Practitioners are created only by provisioning: the push
  endpoint refuses a create or a delete, and an update that changes any
  column other than `full_name`, `title` and `syndicate_number`
  (`practitioner_not_editable`); it validates the profile as the device does
  (`practitioner_profile_invalid`). Owner-only editing is enforced on the
  device only — the same known gap as every other settings write
  (`api/docs/rls.md`'s "Practitioners"). Pull returns practitioner rows;
  bootstrap returns every practitioner of the org in a sixth stage;
  `register_device` returns each practitioner's `syndicate_number` and
  `rev`. The policy (`org_id = current_org()`) and `clintra_app`'s grants
  did not change.
- **Printed prescription.** The first `.doc-spec` line reads "{title} · رقم
  النقابة {n}", either part left out when empty and the whole line left out
  when both are.

Server: `2026_09_12_000027_add_profile_and_rev_to_practitioners.php` (the
column, `rev` and the trigger),
`2026_09_12_000028_add_practitioner_profile_to_register_device.php` (the
registration payload). Local: database version 17 backfills
`syndicate_number: null` and `rev: 1` (version 12's convention — 1 is what
the server gave every existing row) onto every practitioner without them,
leaving a pulled row's own values alone; no index changes. Versions 1-16
are unchanged.

## v19 additions

### messages, message_templates

The messages a clinic sends its patients over WhatsApp or SMS, and the
organization's edited template bodies. Data only so far — no screen writes
them yet (screen 19 of the prototype will).

**messages**: id, org_id, location_id, patient_id, visit_id?, template_key,
channel, phone, body, attempted_at, marked_sent_at?, created_by (membership
id), created_at, rev

**message_templates**: id, org_id, key, body, updated_by (membership id),
updated_at, rev

Owner decisions:

- **Templates: defaults ship with the app, overrides live in the database.**
  The six keys, their names, descriptions, kinds and default bodies are
  defined in `web/src/domain/messageTemplates.ts`, in display order:
  `booking_confirmation` (تأكيد الحجز), `appointment_reminder` (تذكير
  بالموعد), `post_visit_followup` (متابعة بعد الزيارة),
  `care_plan_session_reminder` (تذكير جلسة خطة), `balance_reminder` (تذكير
  برصيد متبقي) and `custom` (رسالة مخصصة, written per message, default
  body `""`). `message_templates` holds only an organization's edited body
  for one of the five editable keys; `custom` has no override. "Reset to
  default" deletes the override, and `effectiveBody(key, override)` falls
  back to the default. (This replaces the earlier plan of seeding templates
  by migration: a seed would only reach the organizations that exist when
  the migration runs.) Placeholders: `patient_name`, `clinic_name`,
  `clinic_phone`, `date`, `time`, `doctor_name`, `session_label`,
  `balance`. `renderTemplate(body, values)` fills the known ones through the
  existing domain formatters (the clinic-day date with Latin digits,
  "HH:MM", money, the local phone display), leaves an unknown `{{token}}`
  untouched, and renders every known placeholder that had no value as its
  Arabic label in square brackets ("[الجلسة]") — never as a raw token — and
  reports it so a screen can warn before sending.
- **A message is written the moment the app opens WhatsApp or SMS for it**
  (`attempted_at`). Its body, phone, channel, template key, patient and
  `attempted_at` never change afterwards; only `marked_sent_at` may be set or
  cleared — "اتبعتت" is marked by hand. Messages are never deleted.
- **No provider, so no delivery status.** The app opens
  `https://wa.me/<E.164 digits without +>?text=<encoded body>` or
  `sms:<E.164>?body=<encoded body>` (`buildMessageLink`,
  `web/src/domain/messageLink.ts`, percent-encoding the whole body).
- **Scope.** `messages` is isolated like `invoices` — org + allowed locations,
  not practitioner, since assistants send most messages — and
  `message_templates` like `practitioners`, org only. Template editing is
  owner only, enforced on the device; the server does not check who edits,
  the same known gap as every other settings write (`api/docs/rls.md`'s
  "Messages and message templates").

- `template_key` is one of the six keys and `channel` is `whatsapp` or
  `sms` (both CHECK constraints); `message_templates.key` is one of the five
  editable keys (CHECK), unique per organization.
- `phone` is the patient's number in E.164, as it was when the message was
  opened; `body` is the rendered text, trimmed, exactly as it was handed to
  WhatsApp or SMS. `phone` has no format CHECK — no existing phone column has
  one — and the push endpoint validates its shape instead.
- **Writes** (`web/src/db/messages.ts`, through `mutate()`):
  `recordMessageAttempt` (refuses `patient_has_no_phone`, an empty body and
  an unknown key; the location is the visit's when one is given, otherwise
  this device's; returns the row and its link), `markMessageSent` /
  `unmarkMessageSent` (no-op when unchanged), `saveTemplateBody` (owner only,
  `not_owner`; trimmed; empty refused; at most 4000 characters; equal to the
  default deletes the override instead) and `resetTemplate`. The audit log
  reads "فتح رسالة واتساب" / "فتح رسالة SMS" (naming the patient), "علّم
  الرسالة إنها اتبعتت", "شال علامة الإرسال", "عدّل قالب «{name}»" and "رجّع
  قالب «{name}» للأصل" — never a body or a phone. Messages are listed under
  the "patients" filter, template edits under "settings".
- **Server.** The push endpoint accepts a message create, and an update that
  changes `marked_sent_at` only; any other changed column, and every delete,
  is `message_immutable`; a create without a known key, a valid channel, an
  E.164 phone or a non-empty body is `message_invalid`. A template override
  may be created, updated and deleted; a key outside the five, or a body that
  is empty or over 4000 characters, is `template_invalid`. An empty body is
  refused, never stored: Laravel's ConvertEmptyStringsToNull middleware
  delivers a pushed `""` as null, which both rules refuse explicitly. Pull
  returns both tables; bootstrap returns the messages attempted inside the
  60-day window and every template override, in two stages appended after
  `practitioners`.

Server (`2026_09_12_000029_create_messages_tables.php`): plain indexes on
`messages.org_id`, `location_id`, `patient_id` and `attempted_at`, unique
`(org_id, key)` on `message_templates`; no foreign key cascades. `rev` with
the `enforce_row_rev()` trigger, FORCE RLS, both tables in the
syncable-table list (`SyncableTables::NAMES` and `DIRECT_ORG_ID_TABLES`;
`ACTOR_COLUMNS` `messages` → `created_by`, `message_templates` →
`updated_by`; a mark leaves `created_by` as the creator's).

Local (database version 18), two new stores:
`messages: "id, patient_id, location_id, attempted_at"` — a patient's
messages, a location's, and the newest first — and
`message_templates: "id, &key"`, at most one override per key and the
lookup `effectiveBody` needs. The key alone is unique locally, not
`[org_id+key]`, because a device serves exactly one organization. Versions
1-17 are unchanged.

## v20 additions

### care_plans, care_plan_items

A patient's course of treatment with one practitioner and its sessions
(screen 17 of the prototype). Both tables were declared in v1 with no
writer; v20 gives them writers, sync and a narrower policy. Screen 17
writes them (`web/src/screens/carePlan/`).

**care_plans**: id, org_id, location_id, template_id, patient_id,
practitioner_id, goal, diagnosis, planned_count, total_price, paid, status
(active|stopped), started_at, expected_end, rev

**care_plan_items**: id, care_plan_id, service_id, sequence, visit_id?,
min_gap_days, depends_on_item_id?, price, status (planned|skipped), rev

- `care_plan_items.visit_id` is **nullable** now (it was NOT NULL in v1):
  null while the session is not booked, otherwise the visit that books it.
  The foreign key to `visits` stays (RESTRICT) and the column has a plain
  index. It is the only link between a session and its visit:
  `visits.care_plan_item_id` stays null, as it always has.
- `care_plans.paid` is **unused**: written as 0 and never read. What a plan
  has been paid is derived from the payments on the invoices of its linked
  visits (`carePlanPaid`, `web/src/domain/carePlan.ts`); the server refuses
  any other value (`care_plan_invalid`). Paying for a package up front is out
  of scope.
- `planned_count` (the sessions not skipped), `total_price` (their summed
  prices) and `expected_end` (the last session's display date, at Cairo
  midnight; `started_at` while no session has a date yet) are derived and
  rewritten by every writer that changes them, in the same transaction.
- `depends_on_item_id` is unused (always null); the order of sessions is
  their `sequence`.

Derived, never stored (`web/src/domain/carePlan.ts`, pure):

- A session is **done** (its linked visit is completed), **booked** (its
  linked visit still holds its slot: booked, confirmed, arrived, in_room) or
  **suggested** (no link, or a link to a visit that no longer holds its
  slot); a skipped session is left out of every count, total and date.
- A session's **display date** is its linked visit's day; otherwise the
  previous (not skipped) session's date plus its own `min_gap_days`;
  otherwise none, and it reads "جلسة {n}". Its **label** is its service's
  name.
- A plan is **completed** when every session not skipped is done and at
  least one is (a plan whose every session is skipped reads as active with
  nothing to book), and
  **stalled** when it is active, nothing is booked and the next suggested
  session's date is more than 7 days past: "المريض متوقف من N يوم"
  (`arabicCount`).
- The message placeholder `{{session_label}}` for a visit that books a
  session reads "جلسة {n} من {count} · {service}", n and count over the
  sessions not skipped.

Owner decisions:

1. **Billed per session.** A session's visit is billed when it is
   completed, at the session's own `price` instead of the service's price
   (`db/visitCompletion.ts`) — the only change to completion. A visit that
   books no session is billed exactly as before.
2. **Created from a visit** (`createCarePlan`, `db/carePlans.ts`): the
   visit's practitioner, patient and location; goal and diagnosis required
   (the diagnosis starts from the visit form's, `carePlanDraftForVisit`);
   one or more groups of sessions (service, count ≥ 1, gap ≥ 0 days)
   expanded into sessions with `sequence` 1..n, each priced at its service's
   effective price at creation (`resolveServicePrice`, overrides included)
   and `min_gap_days` = its group's gap (the plan's first session: 0).
   `template_id` is the general specialty template, as the visit form
   resolves it.
3. **Linked through `care_plan_items.visit_id` only.** Booking a session
   (`bookExistingPatientVisit`'s or `addToQueue`'s `carePlanItemId`) sets it; moving the visit
   (`moveVisit`) carries it to the new visit; cancelling it or marking a
   no-show (`cancelVisit`, `markVisitNoShow`) clears it — each in the
   visit write's own transaction, which also rewrites the plan's derived
   fields. Booking refuses a session that is not suggested
   (`care_plan_session_not_bookable`), of a stopped plan
   (`care_plan_stopped`), or for another patient, practitioner or service
   (`care_plan_session_mismatch`).
4. **Two stored statuses**, everything else derived (above).
5. **Edits**: goal and diagnosis (`updateCarePlanDetails`), appended
   sessions (`addCarePlanSessions`), skip and unskip of a session that is
   neither done nor booked (`skipCarePlanSession`,
   `unskipCarePlanSession`; `care_plan_session_not_skippable`), stop and
   resume (`stopCarePlan`, `resumeCarePlan`). Nothing is ever deleted.
   A patient has at most one plan under way (active and not completed)
   with a practitioner: creating or resuming another is refused
   (`plan_already_active`), on the device only.
   Only the plan's own practitioner creates or edits a plan
   (`not_plan_practitioner`), enforced on the device; the server does not
   check who writes — the same known gap as prescriptions
   (`api/docs/rls.md`'s "Care plans"). Keeping links current (decision 3)
   is part of the visit's write, by whoever writes the visit.

The audit log reads "بدأ خطة رعاية", "عدّل خطة رعاية", "أضاف جلسات للخطة",
"أجّل جلسة", "رجّع جلسة", "وقّف الخطة" and "رجّع الخطة"; a session's link
reads as its visit's write ("سجّل حجز" when booked, "نقل الميعاد" when
moved, "عدّل خطة رعاية" when a cancel or no-show clears it). Never a goal or
a diagnosis. The audit sheet lists both under "الزيارات", naming the
patient; a session's row is scoped through its plan, as a prescription
item's is through its prescription.

Undoing a visit write (`undoMostRecentVisitMutation`, `db/visitUndo.ts`)
puts back the session links that write changed, in the undo's own
transaction and queued before the visit's own reversal: undoing a cancel or
a no-show relinks the session, undoing a move's new visit carries it back to
the original visit before that new visit is deleted, undoing a session's
booking unlinks it before the visit is deleted. A session changed since
keeps its later link. Sync ops are stamped strictly in write order per tab,
so they push in that order.

Server (`2026_09_12_000030_make_care_plans_syncable.php`): the policies
become the visits expression (org + allowed locations + allowed
practitioners), `care_plan_items` through its plan, both USING and WITH
CHECK — changed only on empty tables, which the migration asserts first;
`visit_id` nullable and indexed; `rev` with the `enforce_row_rev()` trigger
on both; both in the syncable-table list (`care_plans` with a direct
`org_id`; no actor column). The push endpoint refuses every delete
(`care_plan_immutable`), a session update that changes `care_plan_id`,
`service_id` or `sequence` (`care_plan_immutable`), a status outside its
set or a `paid` other than 0 (`care_plan_invalid`), and a `visit_id` that is
not a visit of the plan's own patient and practitioner
(`care_plan_invalid`). Pull returns both; bootstrap returns, in two stages
appended after `message_templates`, every active plan and every plan of a
patient with a visit in the window, with their sessions.

Local (database version 20): `care_plans: "id, patient_id,
practitioner_id"` — a patient's plans and a practitioner's — and
`care_plan_items: "id, care_plan_id, visit_id"` — a plan's sessions and the
session a visit books. No unique index: the server has no unique key on
either table beyond the id, so a pulled row can never collide with a local
one. Both stores existed (empty) since version 1; versions 1-19 are
unchanged.

## v21 additions

### memberships.display_name; staff added on the server

Owner decisions:

1. Each membership carries the name the organization uses for the member:
   `display_name` (varchar(120), nullable, stored trimmed). Every place a
   staff name is shown — the staff list, the lock screen, the app bar, the
   audit actor, the cash close, printed pages, the patient profile — reads
   it through `web/src/domain/staffName.ts`'s `staffName`: `display_name`,
   or `users.full_name` only when `display_name` is null (or absent on a
   local row stored before it existed). No backfill: every existing
   membership keeps the name it showed.
2. Renaming a staff member edits `display_name` through the ordinary
   memberships sync (`updateMembership` with `displayName`, owner only on
   the device; required, at most 120 characters; audited "غيّر اسم موظف").
   It never touches `users.full_name`, which other organizations may share.
   Who renames is enforced on the device only — the same known gap as every
   other settings write (`api/docs/rls.md`).
3. Adding a staff member needs a connection and happens on the server in one
   step (`POST /api/staff`, `add_staff_member(jsonb)` —
   `api/docs/rls.md`'s "Adding staff"): find the user by E.164 phone or
   create it, then create the membership (role, scopes, `display_name`, PIN
   salt and hash computed on the device), its `membership_locations` /
   `membership_practitioners` rows and the audit row. The server itself
   checks that the device token's membership — the owner who registered
   the device, not the person signed in by PIN, which the server never
   sees — is an active owner of the organization, and that every location
   and practitioner named is the organization's; a non-owner calling the
   endpoint from an owner-registered device is not stopped, the same limit
   as every other settings write. Offline the
   form says "إضافة موظف محتاجة اتصال بالإنترنت" and writes nothing; on
   success the device stores the returned rows at once (no sync op), so the
   new member can sign in immediately, and other devices pull them. The
   device no longer creates `users` rows.
4. A pushed op for an entity the server does not sync is rejected alone
   (`unknown_entity`); the rest of its batch applies.

Server: `2026_09_12_000031_add_display_name_to_memberships.php` (the
column; the policy is unchanged),
`2026_09_12_000032_add_staff_member_function.php` (`clintra_staff`'s
grants and the function), `2026_09_12_000033_add_display_name_to_register_device.php`
(the registration payload carries each membership's `display_name`).

Local: database version 21. No store changes (`display_name` is not
indexed). Its upgrade unsticks a device whose queue still holds a staff
member added locally (`web/src/db/staffOpsRecovery.ts`): it removes every
unsent `users` op, and every unsent op of a membership created with one of
those users and of that membership's link rows; sent ops and the local rows
stay. Versions 1-20 are unchanged.

## v22 additions

### device_audit_log

Every device's local `audit_log` rows, synced so each device of the
organization sees who did what on any of them (`docs/audit-sync.md`,
backlog A-04). Append-only: never updated or deleted, anywhere.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `id` | uuid, primary key | no | the device's local `audit_log.id` |
| `org_id` | uuid → organizations | no | |
| `location_id` | uuid → locations | yes | scope tag; null = organization-wide |
| `practitioner_id` | uuid → practitioners | yes | scope tag; null = organization-wide |
| `actor_membership_id` | uuid → memberships | no | who the device says acted (its PIN session) |
| `pushed_by_membership_id` | uuid → memberships | no | the token's membership (server-set) |
| `device_id` | uuid → device | no | the token's device (server-set) |
| `entity` | varchar(64) | no | the audited table |
| `entity_id` | uuid | no | the audited row (no foreign key) |
| `action` | varchar(6), create/update/delete | no | |
| `before` | jsonb | yes | the record before; `memberships` records never carry `pin_hash`/`pin_salt` |
| `after` | jsonb | yes | the record after, likewise |
| `at` | timestamptz | no | the device clock at the write |
| `received_at` | timestamptz, default now() | no | the server clock at the push |
| `seq` | bigint, identity (always), unique | no | the pull cursor |

Every foreign key is RESTRICT. Indexes: `(org_id, seq)`, `(org_id, at)`,
`(entity, entity_id)`. The server's own `audit_log` is unchanged and stays
the server's evidence (the token's membership as actor).

Server: `2026_09_12_000034_create_device_audit_log_table.php`
(`api/docs/rls.md`'s "Device audit rows").

Local: database version 23. A new store, `remote_audit_log`
(`id, at, [entity+entity_id]`), holds the rows pulled from the
organization's other devices — the server row's fields except
`pushed_by_membership_id`, `received_at` and `seq` — so `audit_log` keeps
only this device's rows and its dense `seq`. The device row gains
`audit_pushed_seq` (the highest local `seq` the server has answered for)
and `audit_pull_cursor` (the last `device_audit_log.seq` pulled), neither
indexed; absent, they read as 0 and null, so no backfill runs and the
device pushes every local row it holds from seq 0. Pulled rows older than
60 Cairo days are not kept (`web/src/sync/auditSync.ts`). Versions 1-22
are unchanged.

## v23 additions

### schedules.next_mode, schedules.next_mode_from

A doctor's slots/queue switch, dated (`docs/bug-hunt.md`'s A-03, hardening
scenario 24). Owner-authorised; no policy or grant change.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `next_mode` | varchar(255), CHECK `slots`/`queue` (mode's own type) | yes | the mode from `next_mode_from` on |
| `next_mode_from` | date | yes | the first Cairo day `next_mode` applies to |

Both are null with no switch pending, and are written and cleared together
by the device. A date's effective mode is `next_mode` when
`next_mode_from` is set and the date is on or after it, else `mode` — on
the device, `effectiveScheduleMode` (`web/src/domain/scheduleMode.ts`),
the only way any screen reads a day's mode; the server reads no mode.

The working-hours switch writes `next_mode` and `next_mode_from` = tomorrow
(Cairo) on every row the doctor has at the location, and converts the
weekday's visits dated tomorrow or later; switching back before tomorrow
clears both and converts them back. Today's rows read the same mode either
way. A row whose `next_mode_from` is today or earlier is folded on its next
save (`mode` := `next_mode`, both cleared), which changes no day from today
on.

The `schedules_scope` policy filters rows, not columns, and clintra_app's
grant is table-level, so both columns are read and written by exactly the
roles that read and write `mode`. Both travel in the sync payload like
every other schedule field (the pull returns the date as `YYYY-MM-DD`).

Server: `2026_09_12_000035_add_next_mode_to_schedules_table.php`.

Local: no new database version. Both fields are optional on the device's
`Schedule` and read as null while absent, so no backfill runs; a pulled row
brings them. Versions 1-23 are unchanged.

## Rules

- A visit's `position` is unique per practitioner per day.
- A visit's `scheduled_at` is unique per practitioner per day, except when
  `is_overbooked` is true.
- An invoice `number` is unique per location per calendar year (Africa/Cairo;
  see v7 additions — this line previously said "per location" only, which was
  an error in this document, not the implementation it now matches) within
  the minting device's number series (v16 additions).
- A payment's `receipt_number` is unique per location, across all time (never
  reused, never scoped to a year or a single invoice), within the minting
  device's number series (v16 additions).
- A device's number series is unique per location and never reused.
- A visit has at most one prescription. A prescription `number` is unique
  per location per calendar year within the minting device's series, like
  an invoice's (v17 additions).
- A printed prescription never changes, and neither do its items.
- A care plan and its sessions are never deleted; a session never changes
  plan, service or place. A session's `visit_id` names a visit of its plan's
  own patient and practitioner, and a linked visit is billed at the
  session's price.
- A message never changes after it is written except for its sent mark, and
  is never deleted. An organization has at most one template override per
  key, and none for `custom`.
- A `cash_close` is unique per location per day.
- Practitioner availability is computed across all locations: a practitioner
  booked at a time in one location is busy in every other location.
- `no_show` is a status in its own right and is never merged with `cancelled`.
- An invoice can never be voided once any payment exists against it.
- Every payment carries its own receipt number.
- An organization has at most one membership per user (checked by
  `add_staff_member`, v21 additions).
- A user's `phone` is unique (see v4 additions); a patient's `phone` is
  deliberately not (see the patients table note) — these are different
  entities with different rules, not an inconsistency.
