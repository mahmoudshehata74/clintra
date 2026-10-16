import { AuditAction, type SyncOp } from "../db/types";
import type { PushOpResult } from "./transport";

/**
 * A local write never changes a row's rev: only the server does, and an
 * accepted push writes the new rev back (sync/engine.ts's runSyncCycle). So
 * when a device writes the same row twice before the first push is
 * acknowledged — a patient marked arrived, then called in a second later —
 * both ops carry the same base_rev: the server accepts the first (rev + 1)
 * and refuses the second as stale, a conflict the device had with itself.
 *
 * The server raises a row's rev by exactly one for each accepted update
 * (and a create starts it at 1), so this device's own chain of writes on
 * one row is known in advance: every op after the first in a run on the
 * same row, written on the same unacknowledged pre-image, is based on the
 * rev the op before it will produce. A different base_rev (a pull landed a
 * newer server version in between) is left alone, so a genuine conflict
 * with another device is still caught.
 */

/** The rev the server gives a row once `op` is accepted; null for a delete (no row left). */
function revAfter(op: SyncOp): number | null {
  if (op.action === AuditAction.Create) {
    return 1;
  }
  if (op.action === AuditAction.Delete || op.base_rev === null) {
    return null;
  }
  return op.base_rev + 1;
}

/**
 * The batch as it is sent: in send order, each update or delete that
 * follows an earlier op of the same row with the same stored base_rev (or
 * follows that row's create) is based on the rev that earlier op produces.
 * The stored ops are not changed.
 */
export function chainBaseRevs(batch: readonly SyncOp[]): SyncOp[] {
  const previousByRow = new Map<string, { stored: SyncOp; sent: SyncOp }>();
  return batch.map((op) => {
    const key = `${op.entity}:${op.entity_id}`;
    const previous = previousByRow.get(key);
    let sent = op;
    if (previous && op.action !== AuditAction.Create) {
      const expected = revAfter(previous.sent);
      const writtenOnSamePreImage =
        previous.stored.action === AuditAction.Create ? op.base_rev === 1 : op.base_rev === previous.stored.base_rev;
      if (expected !== null && writtenOnSamePreImage) {
        sent = { ...op, base_rev: expected };
      }
    }
    previousByRow.set(key, { stored: op, sent });
    return sent;
  });
}

/**
 * After a batch's results: the ops of a row left unsent (blocked, failed,
 * or written meanwhile) that were written on the same pre-image as an
 * update the server accepted (same stored base_rev) are now based on the
 * rev of that row's last accepted update. Resolves to each op id and the
 * base_rev to store for it.
 */
export function rebaseUnsent(
  batch: readonly SyncOp[],
  results: readonly PushOpResult[],
  unsent: readonly SyncOp[],
): { opId: string; baseRev: number }[] {
  const settled = new Set(
    results.filter((result) => result.status === "accepted" || result.status === "duplicate").map((result) => result.op_id),
  );
  // Per row: the stored base_rev its accepted updates were written on, and the last rev the server gave.
  const lastAccepted = new Map<string, { storedBaseRev: number; rev: number }>();
  for (const result of results) {
    if (result.status !== "accepted") {
      continue;
    }
    const op = batch.find((candidate) => candidate.op_id === result.op_id);
    if (!op || op.action !== AuditAction.Update || op.base_rev === null) {
      continue;
    }
    lastAccepted.set(`${op.entity}:${op.entity_id}`, { storedBaseRev: op.base_rev, rev: result.rev });
  }
  return unsent.flatMap((op) => {
    const accepted = lastAccepted.get(`${op.entity}:${op.entity_id}`);
    if (!accepted || settled.has(op.op_id) || op.action === AuditAction.Create || op.base_rev !== accepted.storedBaseRev) {
      return [];
    }
    return [{ opId: op.op_id, baseRev: accepted.rev }];
  });
}
