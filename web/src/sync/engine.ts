import type { Table } from "dexie";
import { id } from "../domain/id";
import type { ClintraDatabase } from "../db/database";
import { getDeviceId } from "../db/deviceRegistration";
import { MUTATION_EVENT_NAME } from "../db/mutate";
import { AuditAction, type SyncOp } from "../db/types";
import { chainBaseRevs, rebaseUnsent } from "./baseRevChain";
import { applyPulledRow, familyTables, foldChildOpsOfRejectedCreate } from "./pullCollisions";
import { pruneRemoteAuditRows, runAuditPull, runAuditPush, type AuditSyncOutcome } from "./auditSync";
import { hasAuditEndpoints, SyncAuthError, type SyncTransport } from "./transport";

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * Resolves a sync_ops/pulled-change "entity" string to its Dexie table by
 * asking the database itself, the same reasoning as
 * fakeTransport.ts's own tableForEntity: the single source of truth for
 * what a name maps to is the schema declared in database.ts, not a second
 * hand-maintained list here.
 */
function resolveTable(db: ClintraDatabase, entity: string): Table<unknown, string> {
  try {
    return db.table(entity) as Table<unknown, string>;
  } catch {
    throw new Error(`sync_engine_unknown_entity:${entity}`);
  }
}

/**
 * Dispatched on `window` when a transport call fails with a 401 — the one
 * transport failure this app must never let sit as an invisible
 * `console.error` (docs/sync-plan.md's Q10; see SyncAuthError's own doc
 * comment). No listener exists yet (SyncStatusChip's fourth state is a
 * separate, later step), but the event fires regardless so that step has
 * something to attach to rather than needing engine.ts changed again.
 */
export const SYNC_AUTH_ERROR_EVENT_NAME = "clintra:sync-auth-error";

function notifySyncAuthError(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SYNC_AUTH_ERROR_EVENT_NAME));
  }
}

/**
 * How many consecutive transport-level failures (a thrown error from
 * `pushOps`/`pullSince` itself — the network is down, or the server isn't
 * responding at all, as opposed to an ordinary per-op `rejected`/`failed`
 * result) before `SyncStatusChip` distinguishes "server not responding"
 * from a plain "شغّال محلي" (docs/sync-plan.md's Q10). Three is enough to
 * absorb one transient blip (a single dropped request) without flapping
 * the indicator, and few enough that a real outage surfaces within about
 * 30 seconds of normal cycle activity — not derived from the brief, which
 * only constrains the UI treatment ("a small indicator only"), not the
 * threshold.
 */
const TRANSPORT_FAILURE_THRESHOLD = 3;

let consecutiveTransportFailures = 0;

/** Dispatched whenever the transport-health counter crosses the threshold in either direction — SyncStatusChip's fourth state listens for this. */
export const SYNC_TRANSPORT_STATUS_EVENT_NAME = "clintra:sync-transport-status";

function notifyTransportStatusChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SYNC_TRANSPORT_STATUS_EVENT_NAME));
  }
}

/** True once the transport has failed outright (not a per-op rejection) enough consecutive times in a row to call it "not responding" rather than a blip. */
export function isServerUnreachable(): boolean {
  return consecutiveTransportFailures >= TRANSPORT_FAILURE_THRESHOLD;
}

/** Test-only: reset between tests so one test's failures never leak into the next. */
export function resetTransportHealthForTests(): void {
  consecutiveTransportFailures = 0;
}

function recordTransportFailure(): void {
  const wasUnreachable = isServerUnreachable();
  consecutiveTransportFailures += 1;
  if (!wasUnreachable && isServerUnreachable()) {
    notifyTransportStatusChanged();
  }
}

function recordTransportSuccess(): void {
  const wasUnreachable = isServerUnreachable();
  consecutiveTransportFailures = 0;
  if (wasUnreachable) {
    notifyTransportStatusChanged();
  }
}

/**
 * How many consecutive `failed` results (never `rejected` — see
 * PushOpResult's own doc comment) an op can accumulate before it's treated
 * as needing support rather than quietly retried forever. Chosen as "more
 * than enough attempts for a transient blip to clear on its own, few enough
 * that a genuine server bug surfaces within a few minutes of normal sync
 * activity," not derived from any brief or server constraint.
 */
const FAILURE_ESCALATION_CAP = 5;

/** Exponential backoff between retries of a `failed` op, capped so a long-broken op still retries occasionally rather than never again. */
const MAX_BACKOFF_MS = 5 * 60_000;

function backoffMsFor(failureCount: number): number {
  return Math.min(1000 * 2 ** failureCount, MAX_BACKOFF_MS);
}

/**
 * A stable, quotable reference for an op that has failed enough times to
 * need support — derived from op_id rather than stored separately, so
 * there is nothing extra to persist or keep in sync. Returns null below the
 * cap: per docs/sync-plan.md's Q11, the assistant is never shown anything
 * about a `failed` op — no raw reason, no code — until it actually is one.
 */
export function describeFailedOpEscalation(op: SyncOp): { referenceCode: string } | null {
  if (op.failure_count < FAILURE_ESCALATION_CAP) {
    return null;
  }
  return { referenceCode: op.op_id.slice(0, 8).toUpperCase() };
}

/**
 * One push cycle: reads every unsent sync_ops row (synced_at is null) that
 * is not currently backed off (next_retry_at is null or already past),
 * excludes any that already have an open (undismissed) sync_review row so a
 * standing conflict is not re-pushed and re-reviewed on every single tick,
 * pushes the rest in chronological order, and applies the result per op:
 *
 * - accepted/duplicate mark synced_at and clear any backoff state; accepted
 *   additionally writes the server's returned rev back to the local row
 *   (skipped for a delete — there is no local row left to write it to).
 * - rejected (a genuine business conflict) writes a sync_review row and
 *   leaves the sync_op exactly as it was. A rejected create also takes its
 *   children's queued ops out of the queue and into that review row's
 *   payload (sync/pullCollisions.ts's foldChildOpsOfRejectedCreate): on the
 *   server each would only fail on its foreign key, and a failed op is
 *   retried indefinitely.
 * - failed (a server bug, never a business conflict — docs/sync-plan.md's
 *   Q11) never enters sync_review; it increments the op's own failure
 *   counter and sets next_retry_at per backoffMsFor, so it is retried
 *   automatically rather than resent on every tick regardless of outcome.
 * - blocked (an earlier op in the same batch, same entity_id, already
 *   failed or was rejected — Q2) is left exactly as it was, to be resent
 *   next cycle once whatever blocked it has resolved.
 */
export async function runSyncCycle(db: ClintraDatabase, transport: SyncTransport): Promise<void> {
  const allOps = await db.sync_ops.toArray();
  const nowIso = new Date().toISOString();
  const unsent = allOps.filter(
    (op) => op.synced_at === null && (op.next_retry_at === null || op.next_retry_at <= nowIso),
  );
  if (unsent.length === 0) {
    return;
  }

  const reviews = await db.sync_review.toArray();
  const openReviewOpIds = new Set(reviews.filter((review) => review.needs_review).map((review) => review.op_id));

  const toSend = unsent
    .filter((op) => !openReviewOpIds.has(op.op_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (toSend.length === 0) {
    return;
  }

  let results;
  try {
    results = await transport.pushOps(chainBaseRevs(toSend));
    recordTransportSuccess();
  } catch (error) {
    if (error instanceof SyncAuthError) {
      notifySyncAuthError();
      return;
    }
    recordTransportFailure();
    return;
  }

  const now = new Date().toISOString();

  for (const result of results) {
    if (result.status === "blocked") {
      continue;
    }

    if (result.status === "accepted" || result.status === "duplicate") {
      await db.sync_ops.update(result.op_id, { synced_at: now, failure_count: 0, next_retry_at: null });

      if (result.status === "accepted") {
        const op = toSend.find((candidate) => candidate.op_id === result.op_id);
        if (op && op.action !== AuditAction.Delete) {
          await resolveTable(db, op.entity).update(op.entity_id, { rev: result.rev });
        }
      }
      continue;
    }

    const op = toSend.find((candidate) => candidate.op_id === result.op_id);
    if (!op) {
      continue;
    }

    if (result.status === "failed") {
      const failureCount = op.failure_count + 1;
      await db.sync_ops.update(op.op_id, {
        failure_count: failureCount,
        next_retry_at: new Date(Date.now() + backoffMsFor(failureCount)).toISOString(),
      });
      continue;
    }

    // rejected
    const reason = result.reason;
    await db.transaction("rw", [...familyTables(db, op.entity), db.sync_ops, db.sync_review], async () => {
      const payload = op.action === AuditAction.Create ? await foldChildOpsOfRejectedCreate(db, op) : op.payload;
      await db.sync_review.add({
        id: id(),
        op_id: op.op_id,
        entity: op.entity,
        entity_id: op.entity_id,
        reason,
        payload,
        needs_review: true,
        created_at: now,
        action: op.action,
        base_rev: op.base_rev,
      });
    });
  }

  // This device's own later writes of a row an accepted update just moved on.
  const stillUnsent = (await db.sync_ops.toArray()).filter((op) => op.synced_at === null);
  for (const { opId, baseRev } of rebaseUnsent(toSend, results, stillUnsent)) {
    await db.sync_ops.update(opId, { base_rev: baseRev });
  }
}

/**
 * Applies one pulled/bootstrapped change to its entity's local table — an
 * upsert by id (sync/pullCollisions.ts's applyPulledRow, which also settles a
 * local row of a different id holding the same unique key, so a collision
 * never fails the cycle), or a delete when payload is null. Shared by
 * runBootstrapWindow and runPullCycle's own loop below: both receive the
 * identical PulledChange shape, and both apply it the same way.
 */
async function applyChange(db: ClintraDatabase, change: { entity: string; entity_id: string; payload: Record<string, unknown> | null }): Promise<void> {
  const table = resolveTable(db, change.entity);
  if (change.payload === null) {
    await table.delete(change.entity_id);
  } else {
    await applyPulledRow(db, change.entity, change.payload);
  }
}

/** The sync_review reason recordDeviceSeries leaves when the server reports a different series than the one this device already mints in. */
export const DEVICE_SERIES_CONFLICT_REASON = "device_series_conflict";

/**
 * Records this device's number series from a pull or bootstrap page
 * (docs/schema.md's v16 additions). The only expected change is null to a
 * number: a device registered before series existed learning its own. A
 * series this device already holds is never overwritten — numbers already
 * printed in it must keep meaning what they meant — so a different non-null
 * value from the server is logged and left for a person as one sync_review
 * row (entity "device", reason device_series_conflict, both values in its
 * payload; one open row at a time, not one per cycle). That row has no op
 * behind it and no rev to compare, so the review sheet shows it — with its
 * reference code — but never offers to resolve it: it needs support, not a
 * choice between two versions.
 */
async function recordDeviceSeries(db: ClintraDatabase, deviceSeries: number | null | undefined): Promise<void> {
  if (deviceSeries === null || deviceSeries === undefined) {
    return;
  }

  const deviceId = getDeviceId();
  const device = await db.device.get(deviceId);
  if (!device || device.series === deviceSeries) {
    return;
  }

  if (device.series === null || device.series === undefined) {
    await db.device.update(deviceId, { series: deviceSeries });
    return;
  }

  console.error(`sync_engine_device_series_conflict: stored ${device.series}, server reports ${deviceSeries}`);
  const reviews = await db.sync_review.toArray();
  const alreadyOpen = reviews.some(
    (review) => review.needs_review && review.entity === "device" && review.reason === DEVICE_SERIES_CONFLICT_REASON,
  );
  if (alreadyOpen) {
    return;
  }
  await db.sync_review.add({
    id: id(),
    op_id: id(),
    entity: "device",
    entity_id: deviceId,
    reason: DEVICE_SERIES_CONFLICT_REASON,
    payload: { stored_series: device.series, server_series: deviceSeries },
    needs_review: true,
    created_at: new Date().toISOString(),
    action: AuditAction.Update,
    base_rev: null,
  });
}

/**
 * Drains GET /api/sync/bootstrap before this device's very first ever
 * pullSince — see SyncTransport.pullBootstrap's own doc comment for the
 * full design (docs/dry-run.md's scenario 17: a replacement device used to
 * see the org's *oldest* history before today's schedule, since pullSince
 * pages strictly oldest-first). Deliberately does not touch
 * device.pull_cursor — that field's only writer remains runPullCycle's own
 * loop below, so this function's success or failure can never change what
 * "has this device ever completed a pull cycle" means. A transport failure
 * here is swallowed, not rethrown: runPullCycle's ordinary backfill still
 * runs immediately afterward regardless, and since pull_cursor is still
 * null, the very next cycle retries bootstrap from the start — safe and
 * idempotent, since every row it delivers is also reachable by the
 * ordinary backfill that always follows it.
 */
async function runBootstrapWindow(db: ClintraDatabase, transport: SyncTransport): Promise<void> {
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    let result;
    try {
      result = await transport.pullBootstrap(cursor);
      recordTransportSuccess();
    } catch (error) {
      if (error instanceof SyncAuthError) {
        notifySyncAuthError();
      } else {
        recordTransportFailure();
      }
      return;
    }

    for (const change of result.changes) {
      await applyChange(db, change);
    }
    await recordDeviceSeries(db, result.deviceSeries);

    cursor = result.cursor;
    hasMore = result.hasMore;
  }
}

/**
 * One pull cycle: resumes from this device's own persisted cursor
 * (device.pull_cursor — never localStorage, same reasoning as the device id
 * itself, db/deviceRegistration.ts), applies every returned change to its
 * entity's local table (a plain upsert by id, or a delete when payload is
 * null — a pulled row's rev travels with it, same as an accepted push's
 * does), and follows `hasMore` to completion before returning, so a first
 * pull over a paginated history does not stop halfway and call itself
 * "done" (docs/sync-plan.md's Q9; api/docs/rls.md's "The sync pull
 * endpoint"). Requires a registered device — the same standing assumption
 * every other sync entry point makes.
 *
 * device.pull_cursor being null means this device has never completed a
 * pull cycle at all (it starts null at registration and becomes a real
 * string, "0" or higher, the moment the loop below writes it even once) —
 * exactly the signal that distinguishes a genuinely fresh/replacement
 * device from one merely behind by a few minutes. Only that first case
 * ever runs runBootstrapWindow; every other call to this function skips it
 * entirely, unchanged from before that function existed.
 */
export async function runPullCycle(db: ClintraDatabase, transport: SyncTransport): Promise<void> {
  const deviceId = getDeviceId();
  const device = await db.device.get(deviceId);
  if (!device) {
    throw new Error("pull_requires_registered_device");
  }

  if (device.pull_cursor === null) {
    await runBootstrapWindow(db, transport);
  }

  let cursor = device.pull_cursor;
  let hasMore = true;

  while (hasMore) {
    let result;
    try {
      result = await transport.pullSince(cursor);
      recordTransportSuccess();
    } catch (error) {
      if (error instanceof SyncAuthError) {
        notifySyncAuthError();
        return;
      }
      recordTransportFailure();
      return;
    }

    for (const change of result.changes) {
      await applyChange(db, change);
    }
    await recordDeviceSeries(db, result.deviceSeries);

    cursor = result.cursor;
    hasMore = result.hasMore;
    await db.device.update(deviceId, { pull_cursor: cursor });
  }
}

/** Feeds an audit pass's outcome into the same transport health the entity sync reports. */
function recordAuditOutcome(outcome: AuditSyncOutcome): void {
  if (outcome === "unauthenticated") {
    notifySyncAuthError();
  } else if (outcome === "unreachable") {
    recordTransportFailure();
  } else {
    recordTransportSuccess();
  }
}

/**
 * The audit rows' part of a cycle (sync/auditSync.ts; docs/audit-sync.md):
 * this device's rows up, then the other devices' rows down. Skipped for a
 * transport with no audit endpoints (a test double), and stopped after the
 * push when the push could not reach the server.
 */
export async function runAuditCycle(db: ClintraDatabase, transport: SyncTransport): Promise<void> {
  if (!hasAuditEndpoints(transport)) {
    return;
  }
  const pushed = await runAuditPush(db, transport);
  recordAuditOutcome(pushed);
  if (pushed !== "done") {
    return;
  }
  recordAuditOutcome(await runAuditPull(db, transport));
}

export interface SyncEngineHandle {
  /** Runs a cycle immediately (subject to the same never-concurrent guard as the timer). */
  triggerSync: () => void;
  /** Detaches every listener and stops the timer. */
  stop: () => void;
}

/**
 * Whether this device can run a cycle yet, and a way to hear the moment it
 * can (db/deviceRegistration.ts's deviceReadiness): a pull needs the device
 * row, which the day screen's load writes after the engine has started.
 */
export interface DeviceReadiness {
  isReady: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

const ALWAYS_READY: DeviceReadiness = {
  isReady: () => true,
  subscribe: () => () => {},
};

/**
 * Drives runSyncCycle then runPullCycle, in that order, every cycle: on a
 * timer while the tab is visible, immediately on visibilitychange to
 * visible, and immediately after any mutate() commit (via the
 * MUTATION_EVENT_NAME window event) — including calls made through the
 * returned handle's triggerSync. A cycle already in flight is never
 * re-entered; a trigger that arrives mid-cycle is simply dropped; the next
 * cycle picks up whatever remains unsent or unpulled. Runs in the
 * background — no caller ever awaits a cycle to render a screen.
 *
 * No cycle runs before deviceReadiness says the device is ready; the first
 * one runs the moment it does, so a fresh load's first pull never waits for
 * the timer.
 */
export function startSyncEngine(
  db: ClintraDatabase,
  transport: SyncTransport,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  deviceReadiness: DeviceReadiness = ALWAYS_READY,
): SyncEngineHandle {
  let isRunning = false;
  let hasPrunedAudit = false;
  let timerId: ReturnType<typeof setInterval> | null = null;

  // Once per start: pulled audit rows past the 60-day window go.
  async function pruneAuditOnce(): Promise<void> {
    if (!hasPrunedAudit) {
      await pruneRemoteAuditRows(db);
      hasPrunedAudit = true;
    }
  }

  function runGuarded() {
    if (isRunning || !deviceReadiness.isReady()) {
      return;
    }
    isRunning = true;
    // Entity ops go up before audit rows, so the server holds the entities
    // first; each pull follows its push.
    runSyncCycle(db, transport)
      .then(() => pruneAuditOnce())
      .then(() => runPullCycle(db, transport))
      .then(() => runAuditCycle(db, transport))
      .catch((error: unknown) => {
        console.error(error);
      })
      .finally(() => {
        isRunning = false;
      });
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(runGuarded, intervalMs);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      runGuarded();
      startTimer();
    } else {
      stopTimer();
    }
  }

  const hasDom = typeof document !== "undefined" && typeof window !== "undefined";

  if (hasDom) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(MUTATION_EVENT_NAME, runGuarded);
  }
  const unsubscribeDeviceReady = deviceReadiness.subscribe(runGuarded);

  if (!hasDom || document.visibilityState === "visible") {
    runGuarded();
    startTimer();
  }

  return {
    triggerSync: runGuarded,
    stop: () => {
      if (hasDom) {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener(MUTATION_EVENT_NAME, runGuarded);
      }
      unsubscribeDeviceReady();
      stopTimer();
    },
  };
}
