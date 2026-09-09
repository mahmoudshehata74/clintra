import { id } from "../domain/id";
import type { ClintraDatabase } from "../db/database";
import { MUTATION_EVENT_NAME } from "../db/mutate";
import type { SyncTransport } from "./transport";

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * One push cycle: reads every unsent sync_ops row (synced_at is null),
 * excludes any that already have an open (undismissed) sync_review row so a
 * standing conflict is not re-pushed and re-reviewed on every single tick,
 * pushes the rest in chronological order, and applies the result per op —
 * accepted or duplicate marks synced_at; rejected writes a sync_review row
 * and leaves the sync_op exactly as it was, so nothing is lost and nothing
 * is silently retried forever.
 */
export async function runSyncCycle(db: ClintraDatabase, transport: SyncTransport): Promise<void> {
  const allOps = await db.sync_ops.toArray();
  const unsent = allOps.filter((op) => op.synced_at === null);
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

  const results = await transport.pushOps(toSend);
  const now = new Date().toISOString();

  for (const result of results) {
    if (result.status === "accepted" || result.status === "duplicate") {
      await db.sync_ops.update(result.op_id, { synced_at: now });
      continue;
    }

    const op = toSend.find((candidate) => candidate.op_id === result.op_id);
    if (!op) {
      continue;
    }
    await db.sync_review.add({
      id: id(),
      op_id: op.op_id,
      entity: op.entity,
      entity_id: op.entity_id,
      reason: result.reason,
      payload: op.payload,
      needs_review: true,
      created_at: now,
    });
  }
}

export interface SyncEngineHandle {
  /** Runs a cycle immediately (subject to the same never-concurrent guard as the timer). */
  triggerSync: () => void;
  /** Detaches every listener and stops the timer. */
  stop: () => void;
}

/**
 * Drives runSyncCycle: on a timer while the tab is visible, immediately on
 * visibilitychange to visible, and immediately after any mutate() commit
 * (via the MUTATION_EVENT_NAME window event) — including calls made through
 * the returned handle's triggerSync. A cycle already in flight is never
 * re-entered; a trigger that arrives mid-cycle is simply dropped; the next
 * cycle picks up whatever remains unsent. Runs in the background — no
 * caller ever awaits a cycle to render a screen.
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
