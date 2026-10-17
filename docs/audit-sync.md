# Audit sync

Backlog A-04 (`docs/bug-hunt.md`, `docs/session-handoff.md`). Owner
decision: every device's audit rows reach the server and every other device
of the same organization, so the owner sees who did what on any device, and
the invoice's "إنشاء" line names its creator everywhere. Audit rows are
append-only: never edited or deleted, anywhere.

**Status: built** (`feat/audit-sync`). The owner approved the design with
every open question answered as recommended (1-12, "Decisions" at the
end), plus one amendment: the pull-cursor gap ("Seq order is commit
order"), fixed for `sync_ledger` in its own commit first. Where the build
differs from the design as first written, "As built" says so.

## What exists today

- **Device** (`web/src/db/mutate.ts`): every write appends one local
  `audit_log` row in the same Dexie transaction as the entity write and its
  `sync_ops` row — `id` (client uuid), `org_id`, `actor_membership_id` (the
  PIN-signed-in membership, `resolveActingMembership`), `entity`,
  `entity_id`, `action`, `before`, `after` (full records), `at` (device
  clock) and `seq`, a dense per-device counter (Dexie `&seq`). The rows
  never leave the device. `recordServerCreatedRow` (the online staff add)
  writes an audit row with no sync op.
- **Readers of the local rows**: the audit sheet
  (`web/src/screens/day/AuditSheet.tsx`, today's rows for the current
  practitioner and location), the invoice's creator line
  (`InvoiceSheet.tsx`: the `invoices` create row's actor, null when this
  device has none — A-04's symptom), and three local mechanisms that rely
  on `seq` being this device's own dense sequence: undo
  (`checkUndo`, "is this still the latest write of the entity"), the visit
  undo's session-link restore (`carePlans.ts`'s `sessionLinksToRestore`:
  "the rows directly after the visit's row") and the queue reorder's undo
  (`visitQueue.ts`, by id).
- **Server**: an `audit_log` table already exists
  (`2026_09_11_170021_create_audit_log_table.php`): ENABLE + FORCE RLS,
  `audit_log_select` (`org_id = current_org()`), `audit_log_insert`
  (`org_id = current_org() AND actor_membership_id = current_membership()`),
  no UPDATE/DELETE policy, `clintra_app` holding SELECT and INSERT only
  (`2026_09_12_000015_revoke_inert_write_grants.php`), `seq` an identity
  column. It holds the server's own evidence: provisioning, registration
  and staff-add rows, and one row per accepted push op
  (`SyncOpApplier::recordAcceptedWrite`), attributed to the token's
  membership.
- **Why that row is not who acted**: a device token is bound to the
  membership that registered the device — always the owner
  (`register_device`) — and PIN sessions are device-local
  (`docs/auth-plan.md`). The server cannot tell which person is signed in,
  so every server audit row on a device names the owner. The person who
  acted is known only to the device.
- **Earlier decision this supersedes**: `docs/sync-plan.md`'s Q1 ("devices
  never push `audit_log` rows") and Q13 (no channel for a client-supplied
  actor). The owner's A-04 decision reverses Q1 for the device's rows. The
  design keeps Q1 and Q13 true for the server's `audit_log`: device rows
  go to a separate table, and the server's own evidence table, its policy
  and its guarantee ("attribution is enforced in the database",
  `api/docs/rls.md`) stay as they are.

## The server table: `device_audit_log`

A new table, not new columns on `audit_log`. Its rows differ from
`audit_log`'s in kind: the actor is the device's claim, not the token's
membership, so they cannot pass `audit_log_insert`'s actor check, and that
check is the documented guarantee of the server's own trail. Mixing the
two would also mean every pulled page carrying the server's per-op rows,
which duplicate the device's rows under the owner's name. (Open question 1.)

| Column | Type | Null | Source |
|---|---|---|---|
| `id` | uuid, primary key | no | the device's local `audit_log.id`, verbatim |
| `org_id` | uuid → organizations, RESTRICT | no | the row; must equal `current_org()` |
| `location_id` | uuid → locations, RESTRICT | yes | scope tag, derived by the device (below); checked by the server |
| `practitioner_id` | uuid → practitioners, RESTRICT | yes | scope tag, as above |
| `actor_membership_id` | uuid → memberships, RESTRICT | no | the row: who the device says acted (a claim) |
| `pushed_by_membership_id` | uuid → memberships, RESTRICT | no | the server: `current_membership()` (proven) |
| `device_id` | uuid → device, RESTRICT | no | the server: the token's device (proven) |
| `entity` | varchar(64) | no | the row |
| `entity_id` | uuid | no | the row (no foreign key: polymorphic, as `audit_log`) |
| `action` | varchar(6), CHECK create/update/delete | no | the row |
| `before` | jsonb | yes | the row, secrets removed (below) |
| `after` | jsonb | yes | the row, secrets removed |
| `at` | timestamptz | no | the row: the device clock when the write happened |
| `received_at` | timestamptz DEFAULT now() | no | the server |
| `seq` | bigint GENERATED ALWAYS AS IDENTITY, UNIQUE | no | the server: the pull cursor |

**Keys and indexes**: primary key `id`; `UNIQUE (seq)`; `(org_id, seq)`
for the pull (RLS adds the org filter, the cursor the range); `(org_id,
at)` to find the first pull's window start; `(entity, entity_id)` for
lookups of one entity's history. Every foreign key RESTRICT, like every
other table. `seq` is `ALWAYS`, not `BY DEFAULT` as on `audit_log`: no
writer, fixtures included, ever supplies one.

**Scope.** A row is the organization's (`org_id`), and is narrowed to a
location and a practitioner when the audited entity has them. The tags
mirror the audit sheet's own scope check (`isAuditRowInScope` and its
joins), computed by the device when it pushes:

| Entity | `location_id` | `practitioner_id` |
|---|---|---|
| any entity whose record (`after ?? before`) has `location_id` / `practitioner_id` (visits, day_state, schedules, invoices, payments, cash_close, prescriptions, messages, care_plans, …) | that value | that value |
| `visit_form_data` | its visit's | its visit's |
| `prescription_items` | its prescription's | its prescription's |
| `care_plan_items` | its plan's | its plan's |
| `invoice_items` | its invoice's | its invoice's |
| `practitioners` | null | `entity_id` |
| everything else (patients, services, memberships, templates, …) | null | null |

A null tag means organization-wide, the same rule the sheet already uses
for an entity with no location or practitioner. A child whose parent is
not on the pushing device is pushed with null tags.

**Mapping to the device's row.** Same `id`. These travel up: `id`,
`org_id`, `actor_membership_id`, `entity`, `entity_id`, `action`,
`before`, `after`, `at`, plus the two derived tags. These never travel
up: `seq` (the device's own counter; meaningless elsewhere) and, inside
`before`/`after` of a `memberships` row, `pin_hash` and `pin_salt` (the
device removes them; the server refuses a row that still has them, so an
old PIN hash is never copied into an append-only history on every device —
open question 8). These travel down: everything that went up, plus
`device_id` and `seq` (the cursor). These never travel down:
`pushed_by_membership_id` (always the registering owner, misleading on a
screen) and `received_at`.

## RLS and grants

ENABLE and FORCE, like every table. The policy follows the other tables'
membership pattern; every `OR` branch sits inside an `AND` with
`org_id = current_org()`, so it ends at a membership (the
`specialty_templates` lesson, `api/docs/rls.md`):

- **SELECT**: `org_id = current_org()` and each tag either null or within
  `allowed_locations()` / `allowed_practitioners()`.
- **INSERT** (WITH CHECK): the same, and `pushed_by_membership_id =
  current_membership()`, `actor_membership_id` a membership of
  `current_org()`, `device_id` a device of `current_org()`.
- **No UPDATE or DELETE policy**, and `clintra_app` is granted **SELECT and
  INSERT only** — two independent layers, the `audit_log` pattern
  (`AppendOnlyGrantsTest.php`). `clintra_owner` is bound by FORCE with no
  membership, so an UPDATE/DELETE it runs affects zero rows. No
  provisioning role gets any privilege. `clintra_fixtures` (test-only)
  gets its usual table privileges through the default privileges in
  `api/README.md`; the Pest cleanup and `web/e2e-live/removeLiveOrgs.php`
  delete through it, which is why no trigger blocks DELETE for every role
  (open question 10).

**Stopping a device from writing another organization's or another
membership's rows.**

- *Another organization*: `org_id = current_org()` in WITH CHECK, plus an
  explicit check before the insert so the device gets a clean
  `org_mismatch`; the actor, device, location and practitioner subqueries
  and foreign keys all have to resolve inside the token's organization.
- *Another membership as the pusher*: `pushed_by_membership_id =
  current_membership()` in WITH CHECK; the server sets it, never the body.
- *Another device*: `device_id` is set by the server from the token, never
  read from the body.
- *Actor = the token's membership? No, and why not*: the token's membership
  is the owner who registered the device, for every device. Requiring it
  would label every row the owner's — on device B, the assistant's booking
  on A would read as the owner's, which is A-04's own bug in another form.
  The person who acted is known only to the device's PIN session, so the
  actor is accepted as a claim within the organization: it must be a
  membership of `current_org()` (active or not — a row written offline
  before a deactivation must still go up). What is proven is which device
  sent it and under which token; what is claimed is which staff member was
  signed in on it. A device with a stolen token could therefore name any
  staff member of its own organization. That is the same limit as every
  settings write today, and it closes with the backlog's "server-side
  per-person identity" (a PIN-derived proof per request), which would turn
  the claim into a check (`actor_membership_id = <proven acting
  membership>`) without changing this table. (Open question 2.)

## Rows going up

**Their own endpoint**, `POST /api/audit/push`, behind the `membership`
middleware on the RLS-bound `clintra_app` connection — not the existing
push. Through `/api/sync/push` each audit row would be a `sync_op` and a
`sync_ledger` row: the ledger and every fresh device's backfill would
double, the applier would write a server audit row about the audit row,
and a refused audit row would land in the sync review sheet as a conflict
for a person to settle, when there is nothing to settle.

**The local rows are their own outbox.** No `sync_ops` row is added.
The device keeps one watermark, `device.audit_pushed_seq`: the highest
local `seq` the server has answered for. Unsent rows are
`audit_log.where("seq").above(watermark)`, in `seq` order — the existing
index; no field or index on the rows changes.

**Request**: `{ rows: [ … ] }`, 1 to 200 rows (the pull's page size),
each in the shape above. **Response**: `{ results: [ { id, status,
reason? } ] }`, one per row, same order. Statuses:

- `accepted` — inserted.
- `duplicate` — a row with that id is already stored, visible to the
  caller, with the same `org_id`, `actor_membership_id`, `entity`,
  `entity_id`, `action`, `at`, `before` and `after`. Nothing is written. A
  resend (a lost response, a retried batch) is therefore a no-op.
- `rejected` — final, with a reason: `org_mismatch`, `actor_not_in_org`,
  `unknown_entity` (outside `SyncableTables::NAMES` and `users`, which
  older devices audited before staff moved to the server),
  `audit_invalid` (an id, entity id or `at` that does not parse; an action
  whose `before`/`after` shape does not match — create: before null, after
  an object; update: both objects; delete: before an object, after null;
  a row over 64 KB of JSON), `audit_secret_field` (a `memberships` record
  carrying `pin_hash` or `pin_salt`), `scope_mismatch` (a tag that
  disagrees with the record's own `location_id`/`practitioner_id`, or a
  `practitioners` row whose `practitioner_id` is not its `entity_id`),
  `audit_id_taken` (the id exists with different content, or is not
  visible — another organization's).
- A request that fails as a whole (network, 5xx, 401) answers nothing.

`at` is not checked against the server clock or the 60-day window: it is
history, and refusing it would lose it for good; `received_at` records
when it arrived. Each row is inserted in its own savepoint
(`INSERT … ON CONFLICT (id) DO NOTHING`, then the duplicate check), so a
refused row never aborts the rest of the batch. No `sync_ledger` row and
no server `audit_log` row is written for an audit row.

**Device**: after a response, the watermark moves to the batch's last
`seq` — `accepted`, `duplicate` and `rejected` are all final answers. A
rejected row stays on the device, unchanged, and is not retried (open
question 6). A failed request leaves the watermark, and the next cycle
resends the same rows. **Ordering**: rows go up in local `seq` order, which
is write order; the server's `seq` records arrival order. **Batching**: the
engine drains in batches of 200 until nothing is left above the
watermark, like the pull's `has_more` loop. **Offline**: rows are written
locally exactly as today and wait above the watermark; nothing is sent
until the transport succeeds again, and they then go up once.

**Cycle order**: push ops (`runSyncCycle`), push audit rows, pull changes
(`runPullCycle`), pull audit rows. Ops go first so the server holds the
entities before their audit rows (not required by anything — an audit row
names no foreign key on its entity — but it keeps the server's two trails
in step). An audit row travels even when its entity's op was rejected:
the row records what was done on the device (open question 3).

## Rows going down

**Their own cursor**, `GET /api/audit/pull?cursor=<device_audit_log.seq>`,
same middleware and connection; the device keeps `device.audit_pull_cursor`
(null until the first page). Org and scope isolation come from the SELECT
policy alone, no hand-written org filter, as in `SyncPuller`. The query
leaves out the calling device's own rows (`device_id <> <token's device>`):
unlike entity rows, an audit row has no `rev` to learn back, and the device
already holds it. Page size 200, fetched as 201 for `has_more`. Response:
`{ cursor, has_more, rows: [ … ] }`, rows in `seq` order, `at` as ISO 8601
UTC with milliseconds and `before`/`after` as JSON values (`SyncPayload`).
A cursor above the caller's visible maximum is a 422 `invalid_cursor`, as
the ledger pull.

**Volume.** One clinic day with one practitioner and about 30 visits:
per visit roughly a booking, arrival, call in, completion, the form's
autosaves (2–4), a note, the invoice and its item, a payment and the
invoice's update, a prescription with three drugs and its print, a
message — about 20 audit rows, so about **600 rows per practitioner per
day**, plus a handful of settings rows. A row carries two full records,
about 1.5–2.5 KB of JSON: about 1–1.5 MB a day before compression. Six
months is about 110,000 rows per practitioner on the server — ordinary for
Postgres. A fresh device cannot be handed all of it.

**The first pull is a window, not the history.** With a null cursor the
server starts at the first row whose `at` falls inside the last **14
Cairo days** (the `(org_id, at)` index), and pages forward from there;
from then on the cursor continues forever. 14 days is about 8,400 rows,
42 pages, for a one-practitioner clinic. The audit sheet shows only today,
so for the sheet the window only needs to cover today; 14 days also gives
the creator line on every invoice of the last two weeks, the ones a
clinic reopens (past-due balances, reprints). (Open question 4.)

**Older days**: the audit sheet shows today only and does not change;
older days are not shown on any device, as now. An invoice older than the
window, opened on a device that did not create it, keeps today's
behaviour: "إنشاء {time}" with no name.

**Retention on the device**: rows pulled from other devices and older
than 60 Cairo days (`SyncWindow::DAYS`, the brief's local storage window)
are deleted from the device's pulled-row store at start-up — local only;
the server keeps everything, and this device's own rows are never touched.
(Open question 5.)

## Seq order is commit order

Both cursors — `sync_ledger.seq` and `device_audit_log.seq` — are identity
values, assigned at insert. Two writers of one organization could commit
out of seq order, and a device pulling in between would move its cursor past
the lower, still-uncommitted seq and never receive that row. Every
transaction that inserts into either table therefore first takes
`pg_advisory_xact_lock(hashtextextended('sync_seq:' || org_id::text, 0))` —
one key per organization, shared by both tables' writers (the sync push,
the staff add and the audit push), taken before the first insert and held
to commit. Within an organization seq order then equals commit order;
other organizations never wait on each other; no grant is needed. The
`sync_ledger` writers take it from the commit that fixed this
(`api/docs/rls.md`'s "One organization's sync writes commit in seq order").

## The device side

**Database version 23**:

- New store `remote_audit_log: "id, at, [entity+entity_id]"` holding rows
  pulled from other devices: `id`, `org_id`, `location_id`,
  `practitioner_id`, `actor_membership_id`, `device_id`, `entity`,
  `entity_id`, `action`, `before`, `after`, `at`. No `seq`.
- `device` gains `audit_pushed_seq` and `audit_pull_cursor` (no index),
  both optional: absent, they read as `0` and `null`, so neither the
  upgrade nor registration writes them (see "As built").
- `audit_log` is unchanged: same fields, same `&seq` index, same writers.

**Telling a pulled row from this device's own**: by store. Own rows live in
`audit_log`, pulled rows in `remote_audit_log`. A pulled row whose id is
already in `audit_log` is skipped (the server leaves a device's own rows
out, so this only covers a re-registered device's history), and a pulled
id already in `remote_audit_log` is skipped too — nothing is ever
overwritten. Undo, the session-link restore and the queue reorder's undo
keep reading `audit_log` only, so their `seq` reasoning ("the latest write
of this entity on this device", "the rows right after this one") is
untouched by rows from elsewhere; a later change from another device is
still caught where it is today, by the server's `base_rev` check when the
undo pushes.

**Backfill of rows written before this change**: the watermark starts at
`0`, so the first cycles push every local row the device holds, oldest
first, 200 per request. Rows a server refuses (an organization or actor it
does not know) are refused once and left on the device.

**Shared reading**: `web/src/db/auditEntries.ts` returns one shape for
both stores (`AuditEntry`: the local row minus `seq`), used by the audit
sheet (`auditEntriesOfDay`) and the invoice (`findAuditEntry`); the scope
rule the sheet applied inline is the pure helper
`web/src/domain/auditScope.ts`, which the push reuses, so the tags pushed
are exactly the scope the sheet applies.

**Transport**: a separate `AuditTransport` interface
(`pushAuditRows(rows)`, `pullAuditSince(cursor)`, `web/src/sync/transport.ts`)
that `HttpTransport` and `FakeTransport` implement beside `SyncTransport`;
the engine runs the audit pass only for a transport that has it
(`hasAuditEndpoints`). `FakeTransport` keeps the server-side rows in its own
database's `remote_audit_log`, with the pushing device and an arrival seq,
and answers with the server's statuses, so the e2e suite exercises it.
The pass itself is `web/src/sync/auditSync.ts`.

## What changes in the UI, and what does not

Changes:

- **Audit sheet**: today's rows from every device of the organization, own
  and pulled, in one list, newest first by `at`. Each row reads exactly
  like a local one — verb, subject, the actor's staff name, context, dot —
  and is filtered by the same four filters (الكل، زيارات، فواتير، إعدادات)
  and the same practitioner and location scope. Today's pulled rows are
  read by an `at` range on `remote_audit_log`, not a full scan.
- **Invoice**: "إنشاء {time} · {name}" finds the invoice's create row in
  either store, so device B names the person who created it on device A.

Does not change:

- The sheet's layout, verbs, filters, today-only range and empty state; no
  device label or "from another device" mark is added.
- Undo and every other local mechanism reading `audit_log`.
- The sync status chip: it keeps counting unsent `sync_ops` only; audit
  rows waiting to go up do not show as pending (open question 11).
- The sync review sheet: an audit row never enters it.
- The day rows' "سجّله …" byline, which reads `visits.created_by`, not the
  audit log (open question 9).

## Tests

**Pest** (`tests/Feature/Rls/DeviceAuditLogTest.php`, plus push and pull
endpoint tests):

- Structure: both RLS flags; the two policies' deparsed text; `clintra_app`
  holds exactly SELECT and INSERT (no UPDATE, DELETE, TRUNCATE,
  REFERENCES, TRIGGER); no provisioning role holds anything; `seq` is
  `GENERATED ALWAYS`; the unique key, the three indexes, every foreign key
  RESTRICT.
- RLS isolation across two organizations: org B reads none of org A's rows
  directly or through `/api/audit/pull`, even with A's cursor; org B
  pushing a row with A's `org_id` is `org_mismatch`; a direct insert of
  one is `42501`. A membership with a listed location does not see another
  location's rows; null-tagged rows are seen org-wide.
- No UPDATE/DELETE for `clintra_app`: both raise `42501` and the row is
  unchanged; `clintra_owner`'s UPDATE/DELETE affect zero rows.
- Idempotent resend: one batch pushed twice is `accepted` then `duplicate`,
  one row stored, `seq` unchanged; the same id with different content is
  `audit_id_taken`; a mixed batch inserts the good rows around a refused
  one.
- Actor spoofing refused: an actor membership of another organization is
  `actor_not_in_org`; a direct insert whose `pushed_by_membership_id` is
  not `current_membership()` is `42501`; a `device_id` or
  `pushed_by_membership_id` in the body is ignored and the stored values
  are the token's; an actor of the same organization other than the
  token's membership is accepted (the documented claim).
- Validation: every `rejected` reason above, `pin_hash`/`pin_salt` in a
  `memberships` record, a 201-row batch refused by the request.
- Pull: paging at 200/201, the null-cursor window (a row 15 days old is
  left out of the first pull, a row 13 days old is in it), the calling
  device's own rows left out, `invalid_cursor`, a revoked token's 401.
- An audit push writes no `sync_ledger` and no `audit_log` row; the
  existing `audit_log` tests pass unchanged.

**Vitest**:

- Push: unsent rows are those above the watermark, in `seq` order, 200 per
  batch, drained in a loop; the watermark moves on `accepted`, `duplicate`
  and `rejected` and stays on a transport failure or 401; `seq` and PIN
  fields never leave; the scope tags for each row of the entity table
  above.
- Pull: rows land in `remote_audit_log`; an id already in either store is
  skipped; the cursor is stored after each page; the first pull sends a
  null cursor.
- Database version 23: existing `audit_log` rows unchanged, the device row
  gains `0` and `null`, the new store is empty.
- Undo and `sessionLinksToRestore` ignore pulled rows (a pulled row for
  the same visit with a later `at` does not make an undo stale).
- Retention: a pulled row older than 60 days is removed, an own row of the
  same age is kept.
- The shared reader and the scope helper; the audit sheet and the invoice
  read both stores.
- `FakeTransport`'s audit endpoints: the same statuses as the server.

**e2e** (FakeTransport): a row pulled from "another device" (seeded in the
fake server, not written into IndexedDB) appears in today's audit sheet
under its filter with its actor's name; the invoice that row created shows
"إنشاء … · {that actor}"; an action taken offline appears in the fake
server's table once, after reconnecting.

**Live two-device run** (`web/e2e-live/sync.live.spec.ts`, a new scenario,
real transport): with the assistant signed in on A, book, complete a visit
and take its payment; on B, signed in as the owner, the audit sheet lists
A's booking, completion and payment under the assistant's name, and A's
invoice reads "إنشاء {time} · {the assistant}". A goes offline, acts, comes
back: B lists each of those rows once. The scenario's cleanup is the
existing `removeLiveOrgs.php`, which deletes `device_audit_log` rows like
any other org-keyed table.

## Statements

The implementation's migration, run as `clintra_owner`
(`--database=pgsql_owner`), on an empty new table — no backfill, so no
`NO FORCE` step is needed:

```sql
CREATE TABLE device_audit_log (
    id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
    location_id uuid NULL REFERENCES locations (id) ON DELETE RESTRICT,
    practitioner_id uuid NULL REFERENCES practitioners (id) ON DELETE RESTRICT,
    actor_membership_id uuid NOT NULL REFERENCES memberships (id) ON DELETE RESTRICT,
    pushed_by_membership_id uuid NOT NULL REFERENCES memberships (id) ON DELETE RESTRICT,
    device_id uuid NOT NULL REFERENCES device (id) ON DELETE RESTRICT,
    entity varchar(64) NOT NULL,
    entity_id uuid NOT NULL,
    action varchar(6) NOT NULL,
    before jsonb NULL,
    after jsonb NULL,
    at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    seq bigint GENERATED ALWAYS AS IDENTITY,
    CONSTRAINT device_audit_log_action_check CHECK (action IN ('create', 'update', 'delete')),
    CONSTRAINT device_audit_log_seq_unique UNIQUE (seq)
);

CREATE INDEX device_audit_log_org_id_seq_index ON device_audit_log (org_id, seq);
CREATE INDEX device_audit_log_org_id_at_index ON device_audit_log (org_id, at);
CREATE INDEX device_audit_log_entity_entity_id_index ON device_audit_log (entity, entity_id);

ALTER TABLE device_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_audit_log FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON device_audit_log TO clintra_app;

CREATE POLICY device_audit_log_select ON device_audit_log FOR SELECT USING (
    org_id = current_org()
    AND (location_id IS NULL OR location_id IN (SELECT * FROM allowed_locations()))
    AND (practitioner_id IS NULL OR practitioner_id IN (SELECT * FROM allowed_practitioners()))
);

CREATE POLICY device_audit_log_insert ON device_audit_log FOR INSERT WITH CHECK (
    org_id = current_org()
    AND (location_id IS NULL OR location_id IN (SELECT * FROM allowed_locations()))
    AND (practitioner_id IS NULL OR practitioner_id IN (SELECT * FROM allowed_practitioners()))
    AND pushed_by_membership_id = current_membership()
    AND actor_membership_id IN (SELECT id FROM memberships WHERE org_id = current_org())
    AND device_id IN (SELECT id FROM device WHERE org_id = current_org())
);
```

`down()`:

```sql
DROP TABLE IF EXISTS device_audit_log;
```

Not run, deliberately: no `UPDATE`/`DELETE` policy, no `UPDATE`/`DELETE`
grant (the `EnablesRowLevelSecurity` trait's four-privilege grant is not
used for this table), no grant to any provisioning role, no `USAGE` on the
identity sequence (an `INSERT` grant covers it — `api/docs/rls.md`'s
"Sequence-backed audit ordering"), no change to `audit_log`, its policies
or its grants, no `SECURITY DEFINER` function. Two things to confirm
empirically while writing the migration, as earlier tables did: that
`INSERT … ON CONFLICT (id) DO NOTHING` needs no extra policy under FORCE,
and that the `memberships`/`device` subqueries in WITH CHECK resolve under
their own policies for `clintra_app`.

Docs the implementation updates: `docs/schema.md` (v22 additions),
`api/docs/rls.md` (a "Device audit rows" section, and the Q1/Q13
cross-reference), `docs/sync-plan.md` (Q1 and Q13 addenda: superseded for
device rows by A-04), `docs/session-handoff.md`.

## Open questions

1. **A separate table or the existing one?** Recommended: a new
   `device_audit_log`, leaving `audit_log` as the server's own evidence
   with its actor check. The alternative adds `device_id`, scope tags and
   a "claimed" marker to `audit_log` and loosens `audit_log_insert` for
   device rows; it keeps one table but weakens the documented guarantee
   and puts the server's per-op owner-attributed rows next to the
   device's.
2. **Is a claimed actor acceptable until per-person identity exists?**
   The server proves the device and the token, and accepts any membership
   of the organization as the actor. Requiring the token's membership
   would name the owner on every row. Do you accept the gap (a device with
   a stolen token could name any staff member of its organization), to be
   closed by the backlog's server-side per-person identity?
3. **Should an audit row travel when the server rejected its entity's op**
   (a lost slot, a stale edit)? Recommended: yes — it records what was done
   on that device, as device A's own sheet already shows it. The
   alternative holds each audit row until its op is accepted and drops it
   on rejection.
4. **The first pull's window: 14 days?** The sheet needs only today; 14
   days also names the creator on two weeks of invoices (about 8,400 rows,
   42 pages for one practitioner). 7 days halves that; 60 days
   (`SyncWindow::DAYS`) is about 36,000 rows and 180 pages.
5. **Delete pulled rows older than 60 days on each device at start-up?**
   Recommended: yes, pulled rows only, local only; the server keeps every
   row. Without it the pulled store grows by about 1 MB per practitioner
   per day for as long as the device lives.
6. **What happens to a rejected audit row?** Recommended: it stays on the
   device and is not retried or shown — there is nothing for a person to
   decide. The alternative lists it in the sync review sheet.
7. **Keep the server's own per-op `audit_log` rows** (owner-attributed)?
   Recommended: yes, unchanged; they are the server's evidence of what each
   token applied, and nothing pulls them.
8. **Remove `pin_hash` and `pin_salt` from `memberships` records before they
   travel?** Recommended: yes (and the server refuses rows that still carry
   them). The rows already on the device keep them; only what is sent
   changes.
9. **The other actor columns** — `visits.created_by`, `payments.created_by`,
   `prescriptions.created_by`, `messages.created_by`,
   `message_templates.updated_by`, `cash_close.closed_by` — are overwritten
   by the push with the token's membership (`SyncOpApplier::buildAttributes`),
   so after a pull, read from the code and not run here, every device's
   "سجّله …" byline names the owner instead of the assistant who booked. It
   is the same question as 2 for those columns. Out of this PR's scope
   unless you want it in; recommended: its own decision and PR.
10. **A trigger refusing UPDATE/DELETE for every role** (like the closed
    day's)? Recommended: no — the grant and the missing policies stop
    `clintra_app` and `clintra_owner`, as on `audit_log`, and a trigger
    would also stop the Pest cleanup and the live run's org removal, which
    delete through `clintra_fixtures`.
11. **Should rows waiting to go up count in the sync chip's pending
    state?** Recommended: no; the chip stays about the clinic's data.
12. **A 64 KB per-row limit** on the JSON a row carries — acceptable? The
    largest record today (a visit with its form) is a few KB.

## Decisions

The owner answered every open question as recommended: (1) a separate
`device_audit_log`; (2) the claimed actor accepted until server-side
per-person identity; (3) an audit row travels even when its entity's op was
rejected; (4) the first pull's window is 14 Cairo days; (5) pulled rows
older than 60 days are deleted on the device; (6) a rejected audit row stays
on the device, unshown and not retried; (7) the server's own per-op
`audit_log` rows stay unchanged; (8) `pin_hash`/`pin_salt` never travel;
(9) the overwritten actor columns are their own PR, the next one — since
built: they keep the device's claim when it names a member of the token's
organization, refuse it as `actor_not_in_org` otherwise and fall back to
the token's membership when absent (`api/docs/rls.md`'s "Actor
attribution"); (10) no all-role trigger; (11) the
sync chip does not count audit rows; (12) a 64 KB per-row limit.

## As built

- **Device row fields** are optional and read as `0` / `null` while absent,
  rather than being written by the version 23 upgrade and by registration:
  the effect is the same (every local row is pushed from seq 0; the first
  pull has no cursor), with no upgrade callback and no change to
  registration.
- **Retention** runs once per sync engine start (`startSyncEngine`, before
  its first pull), and a pulled row already older than 60 Cairo days is not
  stored in the first place (`storePulledAuditRows`).
- **A failed row** (`internal_error`) stops the watermark at the last row
  before it; it and the rows after it go up again on the next cycle, where
  any already stored come back as `duplicate`.
- **Input middleware**: Laravel's global `TrimStrings` and
  `ConvertEmptyStringsToNull` skip `POST /api/audit/push`, so a record is
  stored exactly as the device wrote it and a resend matches it.
- **The lock** is taken once per request by the sync push, the staff add
  and the audit push, before any write, rather than right before the first
  ledger insert: every writer of an organization then takes it first, so it
  can never wait on it while holding a row lock another writer needs.
- **The e2e checks** plant "another device" in the fake server's database:
  a row in today's audit sheet under its filter and actor, an invoice
  naming its creator, and this device's rows reaching the server once
  (`web/e2e/audit-sync.spec.ts`). The offline round is covered by the live
  run (scenario 9) and vitest, since the fake server is in the browser and
  a context going offline does not cut it off.
