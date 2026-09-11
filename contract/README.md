# contract/

The API contract shared by every client (web today, Android later) and the
Laravel API — the one place cross-cutting shapes live so the clients and the
server can never silently drift onto different definitions of the same
thing.

## reference-data.json

System-wide reference rows: data every organization shares, with fixed,
known ids, rather than each client (or the server) inventing its own. Today
that's the single "general" `specialty_templates` row and its current
`form_definitions` row — see `docs/schema.md`.

**Rule: system-wide reference rows are server-owned.** They are created
only by an API migration (`api/database/migrations/`, run as
`clintra_owner`), never by a client, and never pushed through sync. A
client only ever *reads* the ids in this file — it uses them, it does not
mint its own. This is the **one** allowed place for a hardcoded UUID in
this codebase, and only for `org_id`-null reference rows; every other id
(organizations, patients, visits, ...) stays client-generated, per
`docs/schema.md`'s own id conventions.

Why this matters: before this file existed, `web/src/db/seed.ts` generated
a random UUID for the "general" template on every device. Two devices'
"general" rows had different ids, so `practitioners.specialty_id` and
`visit_form_data.form_definition_id` pointed at device-local ids that would
never match a row on the server — sync would fail on the foreign key the
moment it tried to push either table. Every client and the server now
reference the exact same id for the same reference row, so there is nothing
for sync to reconcile there at all.

## Adding a new system-wide reference row

1. Add it to `reference-data.json` with a fixed UUID v4, generated once.
2. Add/extend the API migration that upserts `reference-data.json`'s rows
   by id (idempotent — safe across `migrate:fresh` and repeated runs).
3. Any client that needs the row's id imports it from this file — never
   regenerates it.
