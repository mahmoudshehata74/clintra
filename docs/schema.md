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

## Declared now, unused in v1, no screens

### specialty_templates
id, org_id? (null means a system-wide template), key, name,
generation (none|repeat|sequence|interval), default_count?, gap_days?,
resource_type?, pricing_mode (per_item|package), stall_days?, unit_label,
provider_label

### form_definitions
id, template_id, version, schema, is_current

### visit_form_data
visit_id, form_definition_id, data

*`id` added: the natural key is the composite `visit_id + form_definition_id`.*

### care_plans
id, org_id, location_id, template_id, patient_id, practitioner_id, goal,
diagnosis, planned_count, total_price, paid, status, started_at, expected_end

### care_plan_items
id, care_plan_id, service_id, sequence, visit_id, min_gap_days,
depends_on_item_id, price, status

## Decisions

Two fields the specification left open:

- `payments.method`: `cash | card | wallet | transfer`
- `practitioners.specialty_id`: in v1 it always references the single
  `specialty_templates` row with key `"general"`.

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

## Rules

- A visit's `position` is unique per practitioner per day.
- A visit's `scheduled_at` is unique per practitioner per day, except when
  `is_overbooked` is true.
- An invoice `number` is unique per location.
- Practitioner availability is computed across all locations: a practitioner
  booked at a time in one location is busy in every other location.
- `no_show` is a status in its own right and is never merged with `cancelled`.
- An invoice can never be voided once any payment exists against it.
- Every payment carries its own receipt number.
- A user's `phone` is unique (see v4 additions); a patient's `phone` is
  deliberately not (see the patients table note) — these are different
  entities with different rules, not an inconsistency.
