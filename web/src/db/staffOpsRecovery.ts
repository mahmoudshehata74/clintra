import type { Table } from "dexie";
import type { SyncOp } from "./types";

const LINK_ENTITIES = new Set(["membership_locations", "membership_practitioners"]);

export interface StrandedStaffOps {
  users: number;
  memberships: number;
  links: number;
}

function payloadField(op: SyncOp, field: string): unknown {
  return op.payload !== null && typeof op.payload === "object" ? (op.payload as Record<string, unknown>)[field] : undefined;
}

/**
 * Database version 21's recovery for a device stuck since it added staff
 * locally: that write queued a `users` op, which the server never syncs, and
 * a push containing it was refused as a whole (422), so every upload
 * stayed queued behind it. Removes, from the ops not yet sent:
 * - every `users` op;
 * - every op of a membership created in the same local write — a
 *   memberships create naming one of those users — and any later op on that
 *   membership (a rename, a PIN change), since the server never had it;
 * - every op of that membership's membership_locations /
 *   membership_practitioners links.
 * Ops already sent are history and stay. Nothing but sync_ops is touched:
 * the local rows remain, so whoever was added can still sign in on this
 * device. Returns what it removed, by kind.
 */
export async function dropStrandedStaffOps(syncOps: Table<SyncOp, string>): Promise<StrandedStaffOps> {
  const unsent = await syncOps.filter((op) => op.synced_at === null).toArray();

  const userOps = unsent.filter((op) => op.entity === "users");
  const userIds = new Set(userOps.map((op) => op.entity_id));
  const membershipIds = new Set(
    unsent
      .filter((op) => op.entity === "memberships" && op.action === "create" && userIds.has(String(payloadField(op, "user_id"))))
      .map((op) => op.entity_id),
  );
  const linkIds = new Set(
    unsent
      .filter(
        (op) =>
          LINK_ENTITIES.has(op.entity) &&
          op.action === "create" &&
          membershipIds.has(String(payloadField(op, "membership_id"))),
      )
      .map((op) => op.entity_id),
  );

  const membershipOps = unsent.filter((op) => op.entity === "memberships" && membershipIds.has(op.entity_id));
  const linkOps = unsent.filter((op) => LINK_ENTITIES.has(op.entity) && linkIds.has(op.entity_id));
  await syncOps.bulkDelete([...userOps, ...membershipOps, ...linkOps].map((op) => op.op_id));

  return { users: userOps.length, memberships: membershipOps.length, links: linkOps.length };
}
