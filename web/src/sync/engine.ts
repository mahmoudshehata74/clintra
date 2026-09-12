import type { Table } from "dexie";
import { id } from "../domain/id";
import type { ClintraDatabase } from "../db/database";
import { getDeviceId } from "../db/deviceRegistration";
import { MUTATION_EVENT_NAME } from "../db/mutate";
import { AuditAction, type SyncOp } from "../db/types";
import { SyncAuthError, type SyncTransport } from "./transport";

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
 *   leaves the sync_op exactly as it was — unchanged from before this task.
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
    results = await transport.pushOps(toSend);
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
    await db.sync_review.add({
      id: id(),
      op_id: op.op_id,
      entity: op.entity,
      entity_id: op.entity_id,
      reason: result.reason,
      payload: op.payload,
      needs_review: true,
      created_at: now,
      action: op.action,
      base_rev: op.base_rev,
    });
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
 */
export async function runPullCycle(db: ClintraDatabase, transport: SyncTransport): Promise<void> {
  const deviceId = getDeviceId();
  const device = await db.device.get(deviceId);
  if (!device) {
    throw new Error("pull_requires_registered_device");
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
      const table = resolveTable(db, change.entity);
      if (change.payload === null) {
        await table.delete(change.entity_id);
      } else {
        await table.put(change.payload);
      }
    }

    cursor = result.cursor;
    hasMore = result.hasMore;
    await db.device.update(deviceId, { pull_cursor: cursor });
  }
}

export interface SyncEngineHandle {
  /** Runs a cycle immediately (subject to the same never-concurrent guard as the timer). */
  triggerSync: () => void;
  /** Detaches every listener and stops the timer. */
  stop: () => void;
}

/**
 * Drives runSyncCycle then runPullCycle, in that order, every cycle: on a
 * timer while the tab is visible, immediately on visibilitychange to
 * visible, and immediately after any mutate() commit (via the
 * MUTATION_EVENT_NAME window event) — including calls made through the
 * returned handle's triggerSync. A cycle already in flight is never
 * re-entered; a trigger that arrives mid-cycle is simply dropped; the next
 * cycle picks up whatever remains unsent or unpulled. Runs in the
 * background — no caller ever awaits a cycle to render a screen.
 */
export function startSyncEngine(
  db: ClintraDatabase,
  transport: SyncTransport,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): SyncEngineHandle {
  let isRunning = false;
  let timerId: ReturnType<typeof setInterval> | null = null;

  function runGuarded() {
    if (isRunning) {
      return;
    }
    isRunning = true;
    runSyncCycle(db, transport)
      .then(() => runPullCycle(db, transport))
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
      stopTimer();
    },
  };
}
