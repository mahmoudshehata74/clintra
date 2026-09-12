# Sync plan (for review)

A decision document for the sync workstream — the layer between the web
app's local IndexedDB writes (`web/src/db/mutate.ts`) and the eventual
Laravel API. Each question carries one recommendation, a one-line
rationale, the constraint that binds it (cited as file + line, or "spec is
silent" when nothing in the repo settles it), and a status:

- **decided** — a single default proposed, already grounded in an
  existing, implemented pattern; needs your confirmation to lock in.
- **open** — genuinely under-specified, or the current code's actual
  behavior conflicts with a stated requirement (the brief's "never lose
  data"). I do not have enough to default these, and defaulting one
  quietly would hide a real gap rather than surface it.

No code changes accompany this document. Several answers below report
what the current implementation actually does — including places where
that behavior looks like a bug or an unfinished feature — rather than
what a finished sync layer should do; those are called out explicitly as
findings, not decisions.

**On the CLI brief**: as `docs/auth-plan.md` notes, there is no standalone
specification file for it in this repo. I could not locate a "sync
section" to read directly, and the docs that do quote it
(`docs/session-handoff.md:124`, `:178`) cite unrelated lines (a superseded
`UNIQUE (org_id, phone)` rule, and the repo-layout description). Where a
question below depends on the brief, I've marked it "spec is silent (brief
section not found in repo)" and treated only the single line you quoted in
this task's own instructions — "the assistant must never lose data" — as a
verified brief constraint.

---

## Ordering and identity

### 1. What does a pushed audit row carry — server seq authoritative, local seq as a second column, or dropped?

- **Recommendation:** N/A today — see finding. When audit sync is built:
  the server's identity-column `seq` should be authoritative for global
  ordering; the device's local `seq` should survive as a separate field
  (not dropped), since `undoMostRecentMutation` already depends on it for
  same-device ordering and that dependency has no reason to move.
- **Finding:** `audit_log` rows are never pushed at all today.
  `applyEntityWrite` writes exactly one `sync_ops` row per call, and its
  `entity` is always the domain table being written (`visits`, `patients`,
  `day_state`, ...) — never `"audit_log"` itself
  (`web/src/db/mutate.ts:72-81`). `fakeTransport.ts`'s `tableForEntity`
  resolves whatever entity string a `sync_op` carries to a real Dexie
  table by name, so `"audit_log"` was never a valid entity to begin with.
  The device's local audit trail and the API's own `audit_log` (server
  writes from provisioning, unrelated to device sync) are two disconnected
  tables today — already noted in `docs/schema.md`'s "v11 additions" and
  `api/docs/rls.md`'s "Sequence-backed audit ordering".
- **Constraint:** `web/src/db/mutate.ts:56-70` (local seq, never queued for
  push); `web/src/sync/fakeTransport.ts:22-28` (entity resolution has no
  audit_log case); `docs/schema.md`'s "v11 additions" (explicitly: "no
  sync mechanism exists yet that pushes a device's local audit_log rows to
  the API"). Spec is silent (brief section not found in repo).
- **Status:** open — there is nothing implemented to confirm a default
  against; this is a schema decision for a table that isn't synced yet.

### 2. Do sync_ops push in strict per-device order, and what happens when op N fails but N+1 would succeed?

- **Recommendation:** Keep sending the whole batch and letting each op
  resolve independently (current behavior) for ops on different entities;
  but when N+1 targets the same `entity_id` as a failed N (e.g. an update
  to a row N was supposed to create), the client should hold N+1 back
  until N is resolved (retried or dismissed), rather than sending it and
  getting a second, causally-confusing rejection.
- **Rationale:** Independent ops (a new patient, an unrelated visit) have
  no reason to block each other on one device's slow network; but two ops
  against the same row have a real dependency the current design ignores.
- **Finding:** `runSyncCycle` sorts `toSend` by `created_at` ascending,
  then sends the entire array in one `pushOps()` call
  (`web/src/sync/engine.ts:27-34`). `FakeTransport.pushOps` processes them
  one at a time in a loop, each in its own transaction
  (`web/src/sync/fakeTransport.ts:49-55`) — a rejected op does not stop
  the loop. The interface itself makes no ordering promise beyond
  returning results in the same order submitted
  (`web/src/sync/transport.ts:26`: "Pushes ops (any order the caller
  likes)"). So today: N failing has zero effect on N+1, even when N+1
  depends on N's data — it would also fail, with its own separate
  `sync_review` row, unrelated-looking to the assistant.
- **Constraint:** `web/src/sync/engine.ts:27-34`,
  `web/src/sync/fakeTransport.ts:49-93`, `web/src/sync/transport.ts:26`.
  Spec is silent (brief section not found in repo).
- **Status:** open — the independent-ops half is implicitly decided by
  what's shipped; the same-entity-dependency half is a real gap nothing
  currently handles, and deciding how far to take dependency tracking
  (just same-row, or a fuller op DAG) is a product call.

### 3. Are ops idempotent on replay after a network failure that succeeded server-side but lost the response? What makes them so.

- **Recommendation:** Confirm the existing design: `op_id` (client-generated, per `domain/id.ts`) is the idempotency key. A server implementation must check it before any write, exactly as `FakeTransport` does.
- **Rationale:** This is already correct and already shipped — no change
  needed, only confirmation that the real server replicates it.
- **Constraint:** `web/src/sync/fakeTransport.ts:60-65`: `alreadySeen`
  checks `sync_ops.get(op.op_id)` *before* touching the entity table, and
  returns `"duplicate"` without reapplying anything. `op_id` is generated
  client-side per op (`web/src/db/mutate.ts:73`), consistent with this
  codebase's standing rule that every id is caller-supplied, never
  server-generated (`api/database/migrations/2026_09_11_170033_add_organization_provisioning.php:22-24`
  states the same rule for the API side).
- **Status:** decided.

---

## Conflicts

### 4. What actually counts as a conflict for each entity, given every row has a single owning org and most have one owning device?

- **Recommendation:** Confirm the two-tier reality already implemented,
  and treat the second tier as the open problem it is:
  - **Entities with a real unique constraint** (`visits`:
    `[practitioner_id, visit_date, position]` and
    `[practitioner_id, visit_date, unique_scheduled_at]`; `day_state`:
    `[practitioner_id, location_id, date]`) — a conflict is a native
    constraint violation, mirrored identically on both the local Dexie
    schema and the Postgres schema.
  - **Every other entity** (`patients`, and anything without a natural
    key — `patients.phone` is deliberately non-unique, per
    `docs/schema.md`'s own note) — there is **no conflict detection at
    all**. Two devices editing the same `patients` row offline produce two
    `sync_ops` rows with the same `entity_id`; the server's `table.put()`
    (or a real UPDATE) just overwrites, whichever arrives second, with no
    rejection and no `sync_review` entry.
- **Constraint:** `web/src/db/database.ts:108-111` (visits' compound
  unique indexes), `:124-126` (day_state's), mirrored in
  `api/database/migrations/2026_09_11_170015_create_visits_table.php:61,66`
  and `2026_09_11_170016_create_day_state_table.php:29`.
  `api/database/migrations/2026_09_11_170014_create_patients_table.php:9-10`
  (phone deliberately non-unique, no other constraint declared).
  `web/src/sync/fakeTransport.ts:73-86` (conflict detection is
  `Dexie.ConstraintError` or nothing).
- **Status:** open for the second tier. This is exactly the gap that
  risks the brief's "never lose data" line (see Q6) — silently
  defaulting it to "last-write-wins is fine" would be deciding a real
  product question by omission.

### 5. Last-write-wins, per-field, or per-entity rules? Where does the timestamp come from — device clock or server?

- **Recommendation:** N/A — see finding; this needs a real decision, not
  a default.
- **Finding:** Today it is neither clock-based last-write-wins nor
  per-field merge — it's **arrival-order-wins**, and the distinction
  matters. `FakeTransport.pushOne` does an unconditional `table.put(op.payload)`
  with no comparison against the row's current state, the op's own
  `created_at`, or any version marker (`web/src/sync/fakeTransport.ts:71`).
  `SyncOp` carries no "based on" field — no server seq the op was written
  against, no expected previous value (`web/src/db/types.ts:332-341`). So
  a device whose edit happened first in real time but reconnects to the
  network later can overwrite a device whose edit happened second but
  synced first. `created_at` (`web/src/db/mutate.ts:38`, device clock) is
  used only to *order the client's own send queue*
  (`web/src/sync/engine.ts:29`) and as the fake transport's pull cursor —
  never as a conflict-resolution input.
- **Constraint:** `web/src/db/types.ts:332-341`,
  `web/src/sync/fakeTransport.ts:71`, `web/src/db/mutate.ts:38`. Spec is
  silent (brief section not found in repo).
- **Status:** open — per-field vs. per-entity vs. LWW-by-server-arrival
  vs. LWW-by-timestamp is a product decision with real trade-offs (a
  timestamp policy needs client clocks trusted or corrected somehow); I
  don't have grounds to pick one for you.

### 6. Which conflicts land in sync_review for a human, and which resolve silently? The brief says the assistant must never lose data.

- **Recommendation:** N/A — see finding, which is the reason this stays
  open rather than getting a default.
- **Finding:** Only constraint-violation rejections land in
  `sync_review` — every entity from Q4's second tier resolves *silently*,
  by one write overwriting another with nothing recorded anywhere. That
  is a direct tension with "never lose data," not a hypothetical one.
  Separately, even for conflicts that *do* reach `sync_review`, the
  resolution UI doesn't yet resolve anything: both actions
  ("خليها كده" / keep, "شيلها" / remove) call the identical
  `dismissSyncReview`, which only flips `needs_review` to `false`
  (`web/src/sync/reviewActions.ts`, whose own comment says: "designing
  that resolution flow is a later task; this only wires the plumbing").
  Since a dismissed op's `synced_at` is still `null` and it's no longer
  excluded by `openReviewOpIds` (`web/src/sync/engine.ts:24-28`), the
  *exact same op is resent on the next cycle* regardless of which button
  was tapped — "keep" and "remove" currently do the same thing, and
  neither actually reverts or fixes the underlying local row.
- **Constraint:** `web/src/sync/reviewActions.ts` (both actions identical,
  by comment and by code), `web/src/sync/engine.ts:24-32` (resend
  eligibility), `web/src/sync/reviewSummary.ts` (falls back to the raw
  machine code for any reason it doesn't recognize — see Q11).
- **Status:** open. Two separate gaps, both real: (a) silent data loss for
  unconstrained entities, (b) a review queue whose two actions don't yet
  differ. Neither should be defaulted without your input on what "keep"
  and "remove" are actually meant to do to the local row.

### 7. Two devices book the same slot while both offline. What happens?

- **Recommendation:** N/A — see finding.
- **Finding:** The losing device's create *is* correctly rejected once it
  syncs (`conflict_slot_taken`, via the shared unique constraint from Q4),
  and correctly lands in `sync_review`. But the rejected `sync_op`'s
  entity row is never touched — `runSyncCycle`'s rejection branch only
  writes a `sync_review` row and leaves `sync_ops` exactly as it was
  (`web/src/sync/engine.ts:42-57`). So the losing assistant's own screen
  keeps showing the slot as booked — a phantom row that doesn't exist on
  the server — until she notices the (easy-to-miss, non-blocking) chip,
  and even then dismissing the review does not remove or revert that
  local visit (see Q6). She could be double-booking on top of it, or
  simply confused, for as long as she doesn't investigate.
- **Constraint:** `web/src/sync/engine.ts:36-57`,
  `web/src/screens/day/SyncStatusChip.tsx:26-32` (chip is non-blocking by
  design and easy to miss — "Tapping the chip only opens something in
  that third state").
- **Status:** open. What should happen to the loser's local visit — auto-
  revert to a cancelled/needs-rebooking state, or require the assistant to
  explicitly acknowledge and rebook — is a real UX decision, not a
  technical one.

---

## Transport and failure

### 8. Push and pull: one endpoint or two? Batched or per-op?

- **Recommendation:** Two endpoints, mirroring the two `SyncTransport`
  methods directly — e.g. `POST /api/sync/push` (batched: accepts an
  array of ops, returns one result per op) and
  `GET /api/sync/pull?cursor=...` (batched: returns every op since the
  cursor in one response, not one per request).
- **Rationale:** The client-side contract already commits to exactly this
  shape; there's no benefit to inventing a different one server-side that
  the client would then have to be adapted to.
- **Constraint:** `web/src/sync/transport.ts:25-30` — `pushOps` takes
  `readonly SyncOp[]` and returns `Promise<PushOpResult[]>`; `pullSince`
  takes one cursor and returns a batch (`PullSinceResult.ops`). Both are
  already batched, not per-op, in the interface itself.
- **Status:** decided.

### 9. How does a device know what it's missing — a cursor, a server sequence, timestamps?

- **Recommendation:** A real server-assigned monotonic value (an identity
  column on whichever server-side table records applied sync ops), not a
  client-supplied timestamp — the cursor should be opaque to the client
  either way, but what it's backed by matters.
- **Rationale:** `FakeTransport.pullSince` currently uses the pushed op's
  own `created_at` (a client device clock, string-compared) as both sort
  key and cursor (`web/src/sync/fakeTransport.ts:96-100`). That's fine
  when one fake "server" only ever receives ops through one JS process,
  but real devices have unsynchronized clocks — the exact class of bug
  this codebase already found and fixed once, server-side, for
  `audit_log.seq` (`api/docs/rls.md`'s "Sequence-backed audit ordering":
  a read-then-write / clock-based counter is unsafe under concurrency;
  a real monotonic sequence isn't).
- **Constraint:** `web/src/sync/fakeTransport.ts:95-101`;
  `web/src/sync/transport.ts:11-16` (`PullSinceResult.cursor` is
  documented as opaque, so nothing client-side depends on it being a
  timestamp specifically — only the fake's own implementation does).
  Spec is silent (brief section not found in repo).
- **Status:** open. The *mechanism* (server sequence over client
  timestamp) is well-grounded by precedent above and I'd call that part
  decided; but no server-side sync ledger table exists yet to hang an
  identity column on, so the concrete schema is a decision still to make,
  not something this plan can default.

### 10. What does the assistant see while sync is down, and what is she blocked from doing, if anything?

- **Recommendation:** Confirm the existing, already-shipped design: she is
  never blocked from anything. Additionally close the one real gap found
  below (network-interface-up-but-server-down is currently invisible).
- **Finding:** `SyncStatusChip` shows one of three states — "متصل"
  (online, nothing pending review), "شغّال محلي" (local-only, network
  interface down), or "فيه حاجة محتاجة مراجعة" (needs review) — and
  offline-first is explicit in its own comment: "the app keeps working,
  purely locally" (`web/src/screens/day/SyncStatusChip.tsx:26-32`). No
  screen or write path checks sync status before allowing a mutation.
  **Gap**: `isOnline` is `navigator.onLine` only
  (`web/src/sync/useOnlineStatus.ts`) — the network *interface* being up
  says nothing about whether the sync *server* is reachable. A thrown
  error from `transport.pushOps` (DNS failure, 500, timeout) is caught and
  only `console.error`'d (`web/src/sync/engine.ts:89-92`) — invisible to
  the assistant, who would see "متصل" while nothing is actually syncing.
- **Constraint:** `web/src/screens/day/SyncStatusChip.tsx`,
  `web/src/sync/useOnlineStatus.ts`, `web/src/sync/engine.ts:84-96`.
  `docs/hardening.md:433` independently flags that `FakeTransport` can't
  even exercise this today: "`setOffline` does not affect `FakeTransport`
  at all."
- **Status:** decided for "never blocked." Open for whether/how to
  surface a real transport-level failure distinctly from "network
  interface is down" — a small but real product decision (a fourth chip
  state? a toast? silent retry only?) not yet made anywhere.

### 11. Server rejects an op because RLS refuses it (a real bug, not a conflict). What happens to that op and to the ops behind it?

- **Recommendation:** N/A — see finding; this needs a genuinely new status
  the current design doesn't have.
- **Finding:** `PushOpResult` has exactly three variants: `accepted`,
  `duplicate`, `rejected` (with a free-form `reason` string)
  (`web/src/sync/transport.ts:4-9`). There is no fourth "server_error" or
  "needs_engineering_attention" variant. A real RLS rejection (SQLSTATE
  `42501`, per `api/docs/rls.md`) would have to be shoehorned into
  `rejected`, landing in `sync_review` indistinguishable from a genuine
  business conflict like `conflict_slot_taken`. `describeSyncReview`'s
  fallback for an unrecognized reason is to show the *raw machine code*
  to the assistant (`web/src/sync/reviewSummary.ts:17-20`:
  `REASON_LABELS[review.reason] ?? review.reason`) — she would see
  something like `42501` or a raw error string with no Arabic label. Per
  Q6, dismissing it doesn't fix anything and the op resends on the next
  cycle — a persistent bug becomes a silent, recurring
  reject-review-dismiss-retry loop with no escalation path. "Ops behind
  it" are not blocked (see Q2) — everything in `toSend` is attempted
  regardless of any other op's result.
- **Constraint:** `web/src/sync/transport.ts:4-9`,
  `web/src/sync/reviewSummary.ts:11-20`, `web/src/sync/engine.ts:24-32`.
  Spec is silent (brief section not found in repo).
- **Status:** open. Distinguishing "your data conflicts with someone
  else's" from "the server is broken" is a real design decision (a new
  status, different UI treatment, maybe a non-dismissible state or a
  retry cap that escalates instead of looping) that doesn't exist to
  default from.

---

## Trust

### 12. Which fields does the server override from the token, and which does it validate and reject on mismatch?

- **Recommendation:**
  - **Override, never trust the payload:** `actor_membership_id` (and any
    future "who did this" field) — always taken from the authenticated
    token's resolved membership, exactly as `ApplyMembership` already
    resolves `membership_id`/`device_id` server-side and never from a
    client-supplied header outside `local` (`api/app/Http/Middleware/ApplyMembership.php:96-107`),
    and exactly as every provisioning function already computes its own
    `v_membership_id`/actor rather than accepting one in the payload.
  - **Validate and reject on mismatch:** `org_id`, `location_id`,
    `practitioner_id` — these should be checked, not silently substituted,
    because a genuine mismatch here (a device's payload naming a
    different org than its own token) is itself a signal something is
    wrong client-side worth surfacing distinctly, not papering over.
- **Rationale:** For org/location/practitioner scope, RLS's own
  `WITH CHECK` policies already reject a mismatch at the database level
  for free, *provided* the sync endpoint writes through the ordinary
  RLS-bound `clintra_app` connection (never a `BYPASSRLS` path) — the
  same guarantee every other RLS-protected table already gets
  (`api/docs/rls.md`'s "How to add a new table" checklist). No such
  protection exists for membership attribution specifically (see Q13),
  so that one must be actively overridden, not just checked.
- **Constraint:** `api/app/Http/Middleware/ApplyMembership.php:53-77`
  (current_org()/device_exists() re-resolved fresh from the token on every
  request, never cached from payload);
  `api/database/migrations/2026_09_11_170029_enable_rls_policies.php`
  (org/location `WITH CHECK` policies throughout).
- **Status:** decided in principle — it's the same pattern already used
  everywhere else in this codebase. The concrete sync endpoint doesn't
  exist yet to apply it to.

### 13. Can a device push an audit_log row attributed to a different membership? It must not be able to. How is that enforced?

- **Recommendation:** It must not be possible, enforced by never reading
  `actor_membership_id` (or equivalent) from any client payload at all —
  the server always substitutes the token-resolved membership, the same
  as Q12's recommendation for that field specifically.
- **Finding — this is not yet enforced anywhere it would need to be:**
  `audit_log`'s own `INSERT` policy is `WITH CHECK (org_id = current_org())`
  only — it does **not** check `actor_membership_id` against the
  requester's own membership at all
  (`api/database/migrations/2026_09_11_170029_enable_rls_policies.php:178`,
  with the surrounding comment explicitly noting `INSERT` is
  "deliberately open beyond location/practitioner scope"). So today, RLS
  alone would let one membership within an org write an audit row
  attributed to a *different* membership in that same org — it only
  blocks a different *org's* membership. This is currently moot in
  practice only because nothing pushes `audit_log` rows at all yet (Q1);
  it becomes a real, live hole the moment any future endpoint — sync or
  otherwise — accepts a client-supplied actor field and inserts it
  through the ordinary connection.
- **Constraint:**
  `api/database/migrations/2026_09_11_170029_enable_rls_policies.php:169-178`.
- **Status:** decided in principle (never accept the field, full stop —
  matches 100% of existing precedent), but flagged because the current
  RLS policy would not catch a violation on its own if this principle
  isn't also enforced in application code once a sync endpoint exists.

---

## Sources

- `web/src/sync/engine.ts` — the push cycle: what gets sent, in what
  order, and how results are applied (or not) to `sync_ops`/`sync_review`.
- `web/src/sync/transport.ts` — the `SyncTransport` interface a real
  Laravel backend must implement; the contract every question about
  endpoint shape is checked against.
- `web/src/sync/fakeTransport.ts` — the only implementation that exists
  today; its behavior (dedup, constraint-based conflict detection,
  timestamp-based cursor) is what "currently decided" means throughout
  this document, since nothing else has been built to compare it against.
- `web/src/sync/useOnlineStatus.ts`, `web/src/screens/day/SyncStatusChip.tsx`,
  `web/src/sync/reviewActions.ts`, `web/src/sync/reviewSummary.ts` — what
  the assistant actually sees and can do today.
- `web/src/db/mutate.ts`, `web/src/db/types.ts`, `web/src/db/database.ts` —
  how `audit_log`, `sync_ops`, and `sync_review` rows are shaped and
  written locally.
- `docs/schema.md` — `audit_log` (v1, "v11 additions"), `sync_ops` (v2),
  `sync_review` (v6), `device` (v8, "device.membership_id").
- `api/docs/rls.md` — "Sequence-backed audit ordering" (the seq-counter
  precedent Q9's recommendation leans on), "One role per provisioning
  function" and "Registration: the second door" (the token-derived-identity
  pattern Q12/Q13 lean on).
- `api/app/Http/Middleware/ApplyMembership.php`,
  `api/database/migrations/2026_09_11_170029_enable_rls_policies.php`,
  `api/database/migrations/2026_09_11_170015_create_visits_table.php`,
  `2026_09_11_170016_create_day_state_table.php`,
  `2026_09_11_170014_create_patients_table.php` — server-side constraints
  cited above.
- `docs/hardening.md:433` — independent confirmation that `FakeTransport`
  cannot currently exercise real offline/transport-failure behavior.
- The CLI brief's sync section: **not found in this repo** — see the note
  under the document header. The single brief quotation used above ("the
  assistant must never lose data") came from this task's own instructions,
  not from a file I could re-read directly.
