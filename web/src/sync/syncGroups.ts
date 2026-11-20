import type { Table } from "dexie";
import { id } from "../domain/id";
import type { ClintraDatabase } from "../db/database";
import { AuditAction, type SyncOp, type SyncReview } from "../db/types";
import { applyPulledRow, familyTables } from "./pullCollisions";

/**
 * Sync groups (SyncOp.group_id): ops written as one change — a queue
 * reorder's position moves (db/visitQueue.ts) — that the server applies
 * together or not at all (api's SyncPushController::applyGroup). When it
 * refuses a group, one op carries the real reason and every other op of
 * the group comes back `group_rejected`.
 */
export const GROUP_REJECTED_REASON = "group_rejected";

/** One op of a refused group, as its review keeps it. */
export interface RefusedGroupOp {
  entity: string;
  entity_id: string;
  payload: unknown;
}

/** A refused group's review payload: every op of the group, in write order. */
export interface RefusedGroupPayload {
  group: RefusedGroupOp[];
}

/** Whether a review is a refused group's (one review for the whole change). */
export function isRefusedGroupReview(review: Pick<SyncReview, "payload">): boolean {
  const payload = review.payload as Partial<RefusedGroupPayload> | null;
  return payload !== null && typeof payload === "object" && Array.isArray(payload.group);
}

type Row = { id: string; rev?: number } & Record<string, unknown>;

/**
 * Settles a refused group in one transaction: every op of the group leaves
 * the queue, each row the group wrote is put back as it was before the
 * group's first write of it — unless a pull has since brought a newer
 * version of it (a higher rev than that pre-image's), which is the
 * server's and stays — and one review is left — `head`'s reason, the whole group in its payload. The
 * other device's change, which won, arrives by pull like any other.
 *
 * The rows go back through applyPulledRow, the pull's own key-safe write:
 * every row of the group is removed first, so the group's rows never
 * collide with each other, and a row of the day that moved in meanwhile is
 * settled the way a pull settles it.
 */
export async function recordRefusedGroup(db: ClintraDatabase, head: SyncOp, reason: string, now: string): Promise<void> {
  const groupOps = (await db.sync_ops.toArray())
    .filter((op) => op.group_id === head.group_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const entities = [...new Set(groupOps.map((op) => op.entity))];
  const tables = entities.flatMap((entity) => familyTables(db, entity));

  await db.transaction("rw", [...tables, db.sync_ops, db.sync_review], async () => {
    // Each row's first write in the group decides what it goes back to: its
    // pre-image, or — for a row the group created (a correction's revision,
    // or the empty form it started) — nothing: the server never had it.
    const preImages = new Map<string, { entity: string; row: Row }>();
    const firstWrites = new Set<string>();
    for (const op of groupOps) {
      if (firstWrites.has(op.entity_id)) {
        continue;
      }
      firstWrites.add(op.entity_id);
      if (op.action === AuditAction.Create) {
        await (db.table(op.entity) as Table<Row, string>).delete(op.entity_id);
      } else if (op.group_before) {
        preImages.set(op.entity_id, { entity: op.entity, row: op.group_before as Row });
      }
    }

    const toRestore: { entity: string; row: Row }[] = [];
    for (const [entityId, { entity, row }] of preImages) {
      const table = db.table(entity) as Table<Row, string>;
      const current = await table.get(entityId);
      if (current !== undefined && (current.rev ?? 0) > (row.rev ?? 0)) {
        continue;
      }
      await table.delete(entityId);
      toRestore.push({ entity, row });
    }
    for (const { entity, row } of toRestore) {
      await applyPulledRow(db, entity, row);
    }

    await db.sync_ops.bulkDelete(groupOps.map((op) => op.op_id));
    const payload: RefusedGroupPayload = {
      group: groupOps.map((op) => ({ entity: op.entity, entity_id: op.entity_id, payload: op.payload })),
    };
    await db.sync_review.add({
      id: id(),
      op_id: head.op_id,
      entity: head.entity,
      entity_id: head.entity_id,
      reason,
      payload,
      needs_review: true,
      created_at: now,
      action: head.action,
      base_rev: head.base_rev,
    });
  });
}

/**
 * A failed op of a group backs the whole group off: sent without one of
 * its ops, a group would be applied in part.
 */
export async function backOffGroup(db: ClintraDatabase, groupId: string, failureCount: number, nextRetryAt: string): Promise<void> {
  const groupOps = (await db.sync_ops.toArray()).filter((op) => op.group_id === groupId && op.synced_at === null);
  for (const op of groupOps) {
    await db.sync_ops.update(op.op_id, { failure_count: failureCount, next_retry_at: nextRetryAt });
  }
}
