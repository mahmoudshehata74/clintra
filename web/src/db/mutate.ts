import type { Table } from "dexie";
import { id } from "../domain/id";
import { getDeviceId } from "./deviceId";
import type { ClintraDatabase } from "./database";
import { AuditAction } from "./types";

export interface MutationInput<T> {
  table: Table<T, string>;
  /** Matches audit_log.entity / sync_ops.entity, normally the table name. */
  entity: string;
  entityId: string;
  action: AuditAction;
  /** The full prior record, or null when action is "create". */
  before: T | null;
  /** The full new record, or null when action is "delete". */
  after: T | null;
  actorMembershipId: string;
  orgId: string;
}

/**
 * The single entry point every write in this application must use. In one
 * Dexie transaction it (a) applies the change to the entity table, (b) writes
 * an audit_log row, and (c) appends a sync_ops row for the future sync
 * transport. If any part fails, all three roll back together — a change that
 * is applied but unlogged, or logged but unqueued, is a defect.
 */
export async function mutate<T>(db: ClintraDatabase, input: MutationInput<T>): Promise<void> {
  const now = new Date().toISOString();

  await db.transaction("rw", input.table, db.audit_log, db.sync_ops, async () => {
    if (input.action === AuditAction.Delete) {
      await input.table.delete(input.entityId);
    } else {
      if (input.after === null) {
        throw new Error("mutate_requires_after_unless_deleting");
      }
      await input.table.put(input.after);
    }

    await db.audit_log.add({
      id: id(),
      org_id: input.orgId,
      actor_membership_id: input.actorMembershipId,
      entity: input.entity,
      entity_id: input.entityId,
      action: input.action,
      before: input.before,
      after: input.after,
      at: now,
    });

    await db.sync_ops.add({
      op_id: id(),
      entity: input.entity,
      entity_id: input.entityId,
      action: input.action,
      payload: input.after,
      device_id: getDeviceId(),
      created_at: now,
      synced_at: null,
    });
  });
}
