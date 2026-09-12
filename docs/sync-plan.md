# Sync plan (for review)

A decision document for the sync workstream — the layer between the web
app's local IndexedDB writes (`web/src/db/mutate.ts`) and the eventual
Laravel API. Each question carries a recommendation, a one-line rationale,
the constraint that binds it (cited as file + line, or "brief silent" when
the CLI brief genuinely doesn't address it), and a status:

- **decided** — locked in, either because an existing implemented pattern
  already grounds it or because the brief settles it directly.
- **open** — genuinely under-specified even after checking the brief; a
  real product call still to make.

No code changes accompany this document. Several answers below report
what the current implementation actually does — including places where
that behavior looks like a bug or an unfinished feature, or where it
turns out to violate the brief — rather than what a finished sync layer
should do; those are called out explicitly as findings, separate from the
decisions recorded beneath them.

**On the CLI brief**: it is now readable at `docs/reference/clintra-cli-brief.md`
(filed there this session — it was sitting untracked before). Every
question below has been re-checked against its actual text, not assumed
silent. Section 8 ("Frontend-first architecture") turned out to directly
settle several of these; section 9 (rule 10) and section 10 (trap #4)
settle two more. Where the brief still says nothing, that's now a
confirmed reading of the whole document, not an "I couldn't find the
file."

---

## Checklist: what this document commits web/ and api/ to build

Nothing below is implemented. This is the punch list the eight decisions
in this document create, for whenever sync implementation starts.

**web/**
- `SyncOp` gains `base_rev` (the `rev` the device last saw for the row
  being written) — Q5.
- Every synced entity table gains a local `rev` field, updated whenever a
  row is created, pulled, or has an op accepted — Q5, Q9.
- `PushOpResult` gains a fourth variant, `failed`, distinct from
  `rejected` — Q11.
- `engine.ts`: hold an op back while an earlier unresolved op targets the
  same `entity_id` (same-row dependency only, no general DAG) — Q2. Treat
  `failed` differently from `rejected`: retry with backoff, never enter
  `sync_review`, escalate with a reference code after a retry cap — Q11.
  Track consecutive transport failures (thrown errors from `pushOps`,
  currently only `console.error`'d) — Q10. Wire up an actual pull cycle
  using a persisted "last seq seen" cursor — Q9 (nothing calls
  `pullSince` today).
- `reviewActions.ts`: "خليها كده" (keep mine) and "شيلها" (discard mine)
  must diverge into real, different operations instead of both calling
  the same dismiss — Q6.
- `reviewSummary.ts`: remove the raw-machine-code fallback; every reason
  shown to the assistant must be a real Arabic label — Q11.
- `SyncStatusChip.tsx`: a fourth state distinguishing "network interface
  down" from "server not responding," still small and non-intrusive,
  never blocking — Q10.
- Day screen: a visible needs-rebooking state for a visit that lost a
  slot conflict, not inferable only from the sync chip — Q7.
- A retention policy enforcing the brief's 60-days-back / 60-days-forward
  local storage window — Q9.
- No change to local `audit_log` writing or `undoMostRecentMutation` — Q1
  confirms these stay device-local permanently.

**api/**
- Two new endpoints: `POST /api/sync/push`, `GET /api/sync/pull` — Q8
  (already decided, unaffected by this round).
- A new server-side sync ledger table with an identity-column `seq`,
  backing the pull cursor — Q9 (schema itself still open).
- A `rev` integer column on every syncable entity table, server-assigned
  and incremented on each accepted write; reject a push whose `base_rev`
  doesn't match — Q5 (edit conflicts).
- For slot-constrained tables (`visits`, `day_state`): reject a push whose
  `created_at` is in the future relative to server time; reject anything
  outside the 60-day window; record per-device clock skew somewhere
  inspectable — Q5 (slot conflicts).
- When an accepted sync_op is applied, the server writes its own
  `audit_log` row as a side effect, attributed to the token-resolved
  membership — Q1. This is new application logic; today only the three
  provisioning functions write `audit_log`.
- A `failed`-equivalent response status, a retry/backoff policy, and a
  reference-code mechanism for escalation — Q11.

---

## Ordering and identity

### 1. What does a pushed audit row carry — server seq authoritative, local seq as a second column, or dropped?

- **Decision:** Devices never push `audit_log` rows, full stop. The local
  `audit_log` stays device-local permanently — it serves `undoMostRecentMutation`
  and the local audit screen, and nothing more is asked of it. The server
  writes its own audit row as a side effect of applying an accepted
  `sync_op`, attributed to the token-resolved membership — exactly as
  section 9, rule 10 of the brief requires, and exactly as
  `provision_organization`/`mint_activation_code`/`register_device`
  already do server-side today.
- **Rationale:** A client-pushed audit row would be a claim about who
  acted; a server-derived one is evidence. Accepted cost: the server's
  audit trail won't contain a purely local action that was undone (via
  the 5-minute undo window) before it ever synced — that's fine, since
  nothing was ever visible to anyone else in that window anyway.
- **This closes Q13 by design, not by policy** — see Q13 below.
- **Finding (current behavior, unchanged by this decision):** `audit_log`
  rows are never pushed at all today. `applyEntityWrite` writes exactly
  one `sync_ops` row per call, and its `entity` is always the domain
  table being written (`visits`, `patients`, `day_state`, ...) — never
  `"audit_log"` itself (`web/src/db/mutate.ts:72-81`).
  `fakeTransport.ts`'s `tableForEntity` resolves whatever entity string a
  `sync_op` carries to a real Dexie table by name, so `"audit_log"` was
  never a valid entity to begin with. The device's local audit trail and
  the API's own `audit_log` (server writes from provisioning, unrelated
  to device sync) are two disconnected tables today — already noted in
  `docs/schema.md`'s "v11 additions" and `api/docs/rls.md`'s
  "Sequence-backed audit ordering."
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 9, rule
  10 (verbatim): *"Audit log is written on every change to: visits ·
  patients · invoices · payments · memberships · schedules. Attributed to
  the acting membership, never to the device."* `web/src/db/mutate.ts:56-70`
  (local seq, confirmed never queued for push); `web/src/sync/fakeTransport.ts:22-28`
  (entity resolution has no audit_log case).
- **Correction**: earlier work in this session claimed `clintra_app` had
  no grant on `audit_log` at all, as if that were what kept it
  write-protected — wrong, and now fixed on both counts.
  `clintra_app` always held the standard full-CRUD grant; what actually
  protected the table was the absence of an `UPDATE`/`DELETE` policy, a
  single-layer guarantee. `api/database/migrations/2026_09_12_000015_revoke_inert_write_grants.php`
  now revokes `UPDATE`/`DELETE` from `clintra_app` directly, so the
  "devices never push audit_log rows" decision above and the database's
  own grants agree independently, not by coincidence of one covering for
  the other. See `api/docs/rls.md`'s "Redundant grants revoked, not just
  inert."
- **Status:** decided.

### 2. Do sync_ops push in strict per-device order, and what happens when op N fails but N+1 would succeed?

- **Decision:** Chronological order per device is a brief mandate, not a
  choice. For the half the brief leaves open: an op is held back on the
  client while an earlier, unresolved op targets the *same* `entity_id`
  (e.g. an update queued behind a create of the same row that's still
  pending or under review). Ops targeting different entities never block
  each other. Same-row dependency only — no general op dependency graph
  in v1.
- **Finding (current behavior):** `runSyncCycle` sorts `toSend` by
  `created_at` ascending, then sends the entire array in one `pushOps()`
  call (`web/src/sync/engine.ts:27-34`). `FakeTransport.pushOps` processes
  them one at a time in a loop, each in its own transaction
  (`web/src/sync/fakeTransport.ts:49-55`) — a rejected op does not stop
  the loop, and nothing today implements the same-`entity_id` hold-back
  this decision requires.
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 8:
  *"Operations upload in chronological order per device."* (This settles
  the ordering half — the brief is genuinely silent on the
  failure-blocks-later-ops half; that part is this document's own
  decision, not a brief requirement.) `web/src/sync/engine.ts:27-34`,
  `web/src/sync/fakeTransport.ts:49-93`.
- **Status:** decided (both halves).

### 3. Are ops idempotent on replay after a network failure that succeeded server-side but lost the response? What makes them so.

- **Recommendation:** Confirm the existing design: `op_id` (client-generated, per `domain/id.ts`) is the idempotency key. A server implementation must check it before any write, exactly as `FakeTransport` does.
- **Rationale:** This is already correct and already shipped — no change
  needed, only confirmation that the real server replicates it.
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 8,
  verbatim: *"op_id is unique and sent with every operation. The server
  ignores any duplicate op_id — this is what prevents duplication on
  retry."* Matches the implementation exactly:
  `web/src/sync/fakeTransport.ts:60-65`'s `alreadySeen` check runs
  *before* touching the entity table, returning `"duplicate"` without
  reapplying anything. `op_id` is generated client-side per op
  (`web/src/db/mutate.ts:73`).
- **Status:** decided.

---

## Conflicts

There are two structurally different conflict types below, and the brief
only speaks to one of them. This distinction recurs through Q4, Q5, Q6,
and Q7 — the resolution mechanism is not the same for both, and treating
them as one rule would be wrong:

- **Slot conflicts**: two *different* rows compete for the same unique
  key (`visits`' booking slot, `day_state`'s one-row-per-day key). The
  brief settles this one directly (section 8).
- **Edit conflicts**: the *same* row is edited on two devices (`patients`,
  and anything else with no natural-key collision to detect against at
  all). The brief is silent on this type. Resolved below by a new
  mechanism (`rev`) this plan introduces.

### 4. What actually counts as a conflict for each entity, given every row has a single owning org and most have one owning device?

- **Decision:** Confirmed as the two types above, and now both have a
  detection mechanism (see Q5 for the resolution rule of each):
  - **Slot conflicts** — detected by the existing native unique
    constraint, mirrored identically on both the local Dexie schema and
    the Postgres schema (`visits`: `[practitioner_id, visit_date, position]`
    and `[practitioner_id, visit_date, unique_scheduled_at]`; `day_state`:
    `[practitioner_id, location_id, date]`).
  - **Edit conflicts** — every other entity, including `patients`
    (`patients.phone` is deliberately non-unique, so no natural key exists
    to collide on at all). Detected by a new per-row `rev` counter (Q5),
    closing the "no conflict detection at all" gap this question
    originally found.
- **Pre-launch TODO (a bug to fix before shipping sync, not an open
  question):** nothing in the current code compares timestamps at all for
  slot conflicts. `FakeTransport.pushOne` relies entirely on the
  database's native unique-constraint race — whichever op's `INSERT`
  happens to execute first server-side wins. Over a real network, arrival
  order can disagree with chronological (`created_at`) order — a device
  that booked earlier but reconnected later could still lose to a device
  that booked later but reconnected sooner. That is a direct violation of
  the brief's "the chronologically older wins" (section 8), and whatever
  implements Q5's slot-conflict rule for real must actually compare
  timestamps, not rely on incidental processing order.
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 8:
  *"On a conflict over the same slot: the chronologically older wins..."*
  (settles slot conflicts; brief is silent on edit conflicts — confirmed
  by reading the full document, not assumed). `web/src/db/database.ts:108-111`
  (visits' compound unique indexes), `:124-126` (day_state's), mirrored in
  `api/database/migrations/2026_09_11_170015_create_visits_table.php:61,66`
  and `2026_09_11_170016_create_day_state_table.php:29`.
  `api/database/migrations/2026_09_11_170014_create_patients_table.php:9-10`
  (phone deliberately non-unique — why `patients` had zero detection
  before this decision). `web/src/sync/fakeTransport.ts:73-86` (today's
  detection is `Dexie.ConstraintError` or nothing).
- **Status:** decided.

### 5. Last-write-wins, per-field, or per-entity rules? Where does the timestamp come from — device clock or server?

- **Decision, split by conflict type — do not apply one rule to both:**
  - **Slot conflicts** (visits' unique slot keys, `day_state`): the
    earliest `created_at` wins, per the brief. Because device clocks are
    untrustworthy, the server enforcing this must additionally (a) reject
    any op whose `created_at` is in the future relative to server time;
    (b) reject any op outside the brief's 60-day window (see Q9); and (c)
    record per-device clock skew somewhere inspectable, so a badly-set
    device's clock is visible rather than silently winning or losing
    every race it's in.
  - **Edit conflicts** (everything else, including `patients`): every
    syncable row gets a `rev` integer, assigned and incremented by the
    server on each accepted write. Each `sync_op` carries `base_rev` — the
    `rev` the device last saw for that row. The server rejects any op
    whose `base_rev` does not equal the row's current `rev`; that
    rejection *is* the conflict. No clock participates here at all.
    Per-field merge is explicitly out of scope for v1 — whole-row rebase
    or discard only (see Q6).
- **Finding (current behavior, both types):** Today it is neither
  clock-based last-write-wins nor per-field merge for either type — it's
  **arrival-order-wins**. `FakeTransport.pushOne` does an unconditional
  `table.put(op.payload)` with no comparison against the row's current
  state, the op's own `created_at`, or any version marker
  (`web/src/sync/fakeTransport.ts:71`). `SyncOp` carries no `base_rev` or
  equivalent today (`web/src/db/types.ts:332-341`).
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 8 (slot
  rule, quoted under Q4); brief confirmed silent on edit-conflict
  resolution after reading the full document. `web/src/db/types.ts:332-341`,
  `web/src/sync/fakeTransport.ts:71`, `web/src/db/mutate.ts:38`.
- **Status:** decided.

### 6. Which conflicts land in sync_review for a human, and which resolve silently? The brief says the assistant must never lose data.

- **Decision:** Every conflict — slot or edit — reaches `sync_review`.
  The only silent resolution is a genuine no-op: an incoming op whose
  payload is identical to the row's current state, which has nothing to
  review. The two review actions must do genuinely different things, not
  the same dismiss twice:
  - **"خليها كده" (keep mine):** rebase the op onto the row's current
    `rev` and resend it, overwriting the server's version.
  - **"شيلها" (discard mine):** drop the local op entirely and overwrite
    the local row with the server's current version.
  No path may lose both versions — that is what "never lose data" means
  operationally: the assistant always ends up with either her version or
  the server's, deliberately chosen, never silently neither.
- **Finding (current behavior):** Only constraint-violation rejections
  land in `sync_review` today — every edit-conflict-type entity resolved
  *silently* before this decision, by one write overwriting another with
  nothing recorded anywhere, which was a direct tension with "never lose
  data." Separately, even for conflicts that do reach `sync_review`, the
  resolution UI doesn't yet resolve anything: both actions currently call
  the identical `dismissSyncReview`, which only flips `needs_review` to
  `false` (`web/src/sync/reviewActions.ts`, whose own comment says:
  "designing that resolution flow is a later task; this only wires the
  plumbing"). Since a dismissed op's `synced_at` is still `null` and it's
  no longer excluded by `openReviewOpIds` (`web/src/sync/engine.ts:24-28`),
  the exact same op is resent on the next cycle regardless of which button
  was tapped. One thing this finding does *not* indict: "discard mine"
  never actually deletes local data today, since `dismissSyncReview` only
  touches the review row — accidentally compliant with "never silently
  deleted" already, even though the label could read as implying deletion.
- **Constraint:** `web/src/sync/reviewActions.ts`, `web/src/sync/engine.ts:24-32`,
  `web/src/sync/reviewSummary.ts`. Brief section 8, on slot conflicts
  specifically: *"the loser becomes needs_review and is shown to the
  staff member. Never silently deleted."* Brief is silent on what the two
  review actions should each concretely do — that mechanism (rebase vs.
  discard-and-overwrite) is this plan's own decision, not the brief's.
- **Status:** decided.

### 7. Two devices book the same slot while both offline. What happens?

- **Decision:** The loser's local row must survive un-deleted — the
  brief's "never silently deleted" confirms `FakeTransport` not touching
  the rejected op's entity row is correct behavior, not the bug this
  question originally suspected. But the brief also requires the loser be
  "shown to the staff member," and a visit still rendering as a confirmed
  booking on the day screen is not shown as a loser. So: don't delete it,
  and don't leave it looking confirmed either. The local row moves to a
  distinct needs-rebooking state — not cancelled, not deleted — that
  keeps the patient record intact and is visible directly on the day
  screen itself, not only inferable via the sync chip.
- **Finding (current behavior):** The losing device's create is correctly
  rejected once it syncs (`conflict_slot_taken`), and correctly lands in
  `sync_review`. But the rejected `sync_op`'s entity row is never touched
  — `runSyncCycle`'s rejection branch only writes a `sync_review` row and
  leaves `sync_ops` exactly as it was (`web/src/sync/engine.ts:42-57`). So
  today the losing assistant's own screen keeps showing the slot as
  booked with no visible distinction, until she notices the chip — which
  is compliant with "never deleted" but not yet with "shown to the staff
  member" as a loser specifically.
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 8
  (quoted under Q4/Q6). `web/src/sync/engine.ts:36-57`,
  `web/src/screens/day/SyncStatusChip.tsx:26-32`.
- **Status:** decided.

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
  the client would then have to be adapted to. The brief describes the
  `sync_ops` schema and behavior but never a REST endpoint shape — this
  recommendation is unaffected by re-reading it.
- **Constraint:** `web/src/sync/transport.ts:25-30` — `pushOps` takes
  `readonly SyncOp[]` and returns `Promise<PushOpResult[]>`; `pullSince`
  takes one cursor and returns a batch (`PullSinceResult.ops`). Both are
  already batched, not per-op, in the interface itself. Brief confirmed
  silent on endpoint topology.
- **Status:** decided.

### 9. How does a device know what it's missing — a cursor, a server sequence, timestamps?

- **Decision:** Decided on mechanism, open on schema. The mechanism: a
  server-side sync ledger table with an identity-column `seq` (the same
  pattern `audit_log.seq` now uses); the pull cursor is simply the last
  `seq` a device has seen, opaque to the client — no client timestamps
  involved, for the identical reason `audit_log.seq` was moved off
  `MAX(seq) + 1`. Open: the concrete shape of that ledger table doesn't
  exist yet — what it stores per row, how it relates to the entity tables
  it references, is a schema decision for whenever the endpoint is built.
  Additional constraint recorded from the brief: local storage — and by
  extension, what a pull needs to cover — is bounded to the last 60 days
  and the next 60 days; a device does not need, and should not retain,
  the org's entire history.
- **Finding (current behavior):** `FakeTransport.pullSince` currently uses
  the pushed op's own `created_at` (a client device clock, string-compared)
  as both sort key and cursor (`web/src/sync/fakeTransport.ts:96-100`).
  Fine for a fake server reached only through one JS process; not fine
  across devices with unsynchronized clocks.
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 8:
  *"Local storage covers the last 60 days and the next 60 days."*
  `api/docs/rls.md`'s "Sequence-backed audit ordering" (the precedent this
  decision reuses). `web/src/sync/fakeTransport.ts:95-101`;
  `web/src/sync/transport.ts:11-16` (`PullSinceResult.cursor` is already
  documented as opaque, so nothing client-side depends on it being a
  timestamp specifically). Brief confirmed silent on the specific
  mechanism (identity column vs. something else) — the 60-day window is
  the only concrete constraint it gives here.
- **Status:** decided on mechanism; open on schema.

### 10. What does the assistant see while sync is down, and what is she blocked from doing, if anything?

- **Decision:** "Network interface down" and "server not responding" are
  different facts and must be distinguishable — derived from a
  consecutive-transport-failure counter (thrown errors from
  `transport.pushOps`, currently only `console.error`'d, nowhere counted).
  But the brief's "a small indicator only... no intrusive error messages"
  still governs the UI treatment: this becomes a fourth state of the
  existing `SyncStatusChip`, never a toast, never a dialog, never
  anything blocking. She remains never prevented from any action, in
  every state — that part was already correct and stays unchanged.
- **Finding (current behavior):** `SyncStatusChip` shows one of three
  states — "متصل" (online), "شغّال محلي" (local-only, network interface
  down), or "فيه حاجة محتاجة مراجعة" (needs review) — and offline-first is
  explicit in its own comment (`web/src/screens/day/SyncStatusChip.tsx:26-32`).
  `isOnline` is `navigator.onLine` only (`web/src/sync/useOnlineStatus.ts`)
  — the network interface being up says nothing about the sync server's
  reachability, and a thrown transport error is currently invisible to
  the assistant, who would see "متصل" while nothing is actually syncing.
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 8:
  *"A small indicator only: online / working locally. No intrusive error
  messages."* `web/src/screens/day/SyncStatusChip.tsx`,
  `web/src/sync/useOnlineStatus.ts`, `web/src/sync/engine.ts:84-96`.
  `docs/hardening.md:433` independently confirms `FakeTransport` can't
  exercise this today ("`setOffline` does not affect `FakeTransport` at
  all").
- **Status:** decided.

### 11. Server rejects an op because RLS refuses it (a real bug, not a conflict). What happens to that op and to the ops behind it?

- **Decision:** Add a fourth `PushOpResult` variant, `failed` — a server
  error or bug, not a business conflict. It never enters the
  `sync_review` queue (that queue is for conflicts a human resolves, not
  engineering failures); instead it's retried with backoff, and after a
  retry cap is reached it surfaces to the assistant as needing support,
  with a reference code she can quote. `reviewSummary.ts`'s raw-machine-code
  fallback must be removed — every reason ever shown to the assistant is
  a real Arabic label, never a raw string like a SQLSTATE.
- **Finding (current behavior):** `PushOpResult` has exactly three
  variants: `accepted`, `duplicate`, `rejected` (with a free-form `reason`
  string) (`web/src/sync/transport.ts:4-9`). A real RLS rejection
  (SQLSTATE `42501`) would have to be shoehorned into `rejected`, landing
  in `sync_review` indistinguishable from a genuine business conflict.
  `describeSyncReview`'s fallback for an unrecognized reason shows the raw
  machine code (`web/src/sync/reviewSummary.ts:17-20`:
  `REASON_LABELS[review.reason] ?? review.reason`). Per Q6's old
  behavior, dismissing didn't fix anything and the op resent on the next
  cycle — a persistent bug would become a silent, recurring
  reject-review-dismiss-retry loop with no escalation path. "Ops behind
  it" are not blocked (see Q2) — everything in `toSend` is attempted
  regardless of any other op's result.
- **Constraint:** `web/src/sync/transport.ts:4-9`,
  `web/src/sync/reviewSummary.ts:11-20`, `web/src/sync/engine.ts:24-32`.
  Brief checked in full — confirmed genuinely silent on distinguishing a
  server bug from a business conflict; this decision is this plan's own,
  not derived from the brief.
- **Status:** decided.

---

## Trust

### 12. Which fields does the server override from the token, and which does it validate and reject on mismatch?

- **Recommendation:**
  - **Override, never trust the payload:** `actor_membership_id` (and any
    future "who did this" field) — always taken from the authenticated
    token's resolved membership.
  - **Validate and reject on mismatch:** `org_id`, `location_id`,
    `practitioner_id` — these should be checked, not silently substituted,
    because a genuine mismatch here is itself a signal something is wrong
    client-side worth surfacing distinctly, not papering over.
- **Rationale:** This is now an explicit brief mandate, not just an
  inferred pattern. For org/location/practitioner scope, RLS's own
  `WITH CHECK` policies already reject a mismatch at the database level
  for free, provided the sync endpoint writes through the ordinary
  RLS-bound `clintra_app` connection (never a `BYPASSRLS` path). No such
  protection exists for membership attribution specifically (it does now
  — see Q13), so that one must be actively overridden in application
  code, not just checked by a policy that doesn't cover it.
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 10, trap
  #4, verbatim: *"The token carries user_id and membership_id only. Any
  scope arriving from the client is ignored entirely. The server reads
  the membership from the database on every request, so permission
  changes take effect immediately."* `api/app/Http/Middleware/ApplyMembership.php:53-77,96-107`
  (already implements exactly this — token-resolved scope, re-read fresh
  every request, never cached from a client-supplied value) and
  `api/database/migrations/2026_09_11_170029_enable_rls_policies.php`
  (org/location `WITH CHECK` policies throughout).
- **Status:** decided — now grounded directly in brief text, not only in
  precedent. The concrete sync endpoint doesn't exist yet to apply it to.

### 13. Can a device push an audit_log row attributed to a different membership? It must not be able to. How is that enforced?

- **Decision:** Closed by design, not only by policy. Per Q1, devices
  never push `audit_log` rows at all — there is no channel for a client
  to submit an actor field for an audit row in the first place, so the
  original question (can a device *push* a misattributed row) cannot
  arise in this architecture. The RLS fix already shipped
  (`api/database/migrations/2026_09_12_000011_enforce_audit_attribution.php`)
  remains valuable regardless, as defense-in-depth against any *other*
  future write path (not necessarily sync-related) that might one day
  insert through the ordinary RLS-bound connection.
- **What was done (unchanged from the previous session):**
  `audit_log_insert`'s `WITH CHECK` used to be `org_id = current_org()`
  only — it did not check `actor_membership_id` against the requester's
  own membership at all, so one membership within an org could write an
  audit row naming a different membership in that same org as the actor.
  The migration above ANDs `actor_membership_id = current_membership()`
  onto the same check. Org scoping, the `SELECT` policy, and the
  immutability of `audit_log` (no `UPDATE`/`DELETE` policy at all) are
  unchanged. Confirmed, not assumed, that the three provisioning
  functions (which write `audit_log` as `BYPASSRLS` roles) are unaffected
  — see `api/docs/rls.md`'s "Audit attribution is enforced in the
  database." `tests/Feature/Rls/AuditLogAttributionTest.php` covers:
  self-attribution succeeds, same-org misattribution is rejected
  (`42501`), cross-org is still rejected.
- **Constraint:** `docs/reference/clintra-cli-brief.md`, section 9, rule
  10 (quoted under Q1) is the explicit brief grounding for attribution —
  the shipped fix turns out to be a direct implementation of a named
  brief rule, not just a reasonable inference from precedent.
  `api/database/migrations/2026_09_11_170029_enable_rls_policies.php:169-178`
  (the original policy and `current_membership()`'s definition);
  `api/database/migrations/2026_09_12_000011_enforce_audit_attribution.php`
  (the fix).
- **Status:** decided, and shipped.

---

## Sources

- `docs/reference/clintra-cli-brief.md` — the CLI working brief itself,
  filed this session. Sections 8 (sync/offline architecture), 9 (mandatory
  code rules, rule 10 on audit attribution), and 10 (isolation and auth,
  trap #4 on token scope) are what most of the decisions above rest on.
- `web/src/sync/engine.ts` — the push cycle: what gets sent, in what
  order, and how results are applied (or not) to `sync_ops`/`sync_review`.
- `web/src/sync/transport.ts` — the `SyncTransport` interface a real
  Laravel backend must implement; the contract every question about
  endpoint shape is checked against.
- `web/src/sync/fakeTransport.ts` — the only implementation that exists
  today; its behavior (dedup, constraint-based conflict detection,
  timestamp-based cursor) is what every "current behavior" finding above
  is checked against.
- `web/src/sync/useOnlineStatus.ts`, `web/src/screens/day/SyncStatusChip.tsx`,
  `web/src/sync/reviewActions.ts`, `web/src/sync/reviewSummary.ts` — what
  the assistant actually sees and can do today.
- `web/src/db/mutate.ts`, `web/src/db/types.ts`, `web/src/db/database.ts` —
  how `audit_log`, `sync_ops`, and `sync_review` rows are shaped and
  written locally.
- `docs/schema.md` — `audit_log` (v1, "v11 additions"), `sync_ops` (v2),
  `sync_review` (v6), `device` (v8, "device.membership_id").
- `api/docs/rls.md` — "Sequence-backed audit ordering" (the seq-counter
  precedent Q9 reuses), "One role per provisioning function", "Audit
  attribution is enforced in the database" (Q13's shipped fix), and
  "Registration: the second door" (the token-derived-identity pattern
  Q12 leans on).
- `api/app/Http/Middleware/ApplyMembership.php`,
  `api/database/migrations/2026_09_11_170029_enable_rls_policies.php`,
  `api/database/migrations/2026_09_12_000011_enforce_audit_attribution.php`,
  `api/database/migrations/2026_09_11_170015_create_visits_table.php`,
  `2026_09_11_170016_create_day_state_table.php`,
  `2026_09_11_170014_create_patients_table.php` — server-side constraints
  cited above.
- `docs/hardening.md:433` — independent confirmation that `FakeTransport`
  cannot currently exercise real offline/transport-failure behavior.
