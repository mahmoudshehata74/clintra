import Dexie from "dexie";
import { auditMessage, opMessage, signProof } from "../auth/proof";
import type { ClintraDatabase } from "../db/database";
import type { SyncOp } from "../db/types";
import { chainBaseRevs } from "./baseRevChain";
import type { WireAuditRow } from "./transport";

export async function prepareIdentityOps(
  db: ClintraDatabase, deviceId: string, unsent: readonly SyncOp[], sendable: readonly SyncOp[],
): Promise<SyncOp[]> {
  const device = await db.device.get(deviceId);
  if (!device?.token) return chainBaseRevs(sendable);

  const enforced = device.identity_enforced_at != null;
  const credentials = await db.credentials.toArray();
  const keys = new Map(credentials.filter((row) => row.device_id === deviceId && !row.must_change_password)
    .map((row) => [row.membership_id, row]));
  const keyFor = (op: SyncOp) => op.device_id === deviceId && op.actor_membership_id
    ? keys.get(op.actor_membership_id)
    : undefined;
  const unsigned = { credential_id: null, proof: null, proof_message: undefined };
  const stale = unsent.filter((op) => !keyFor(op) && (op.credential_id || op.proof));
  if (stale.length > 0) {
    await db.sync_ops.bulkUpdate(stale.map((op) => ({ key: op.op_id, changes: unsigned })));
  }
  let eligible = sendable;

  if (enforced) {
    const sendableIds = new Set(sendable.filter((op) => keyFor(op)).map((op) => op.op_id));
    const heldGroups = new Set<string>();
    const inOrder = [...unsent].sort((a, b) => a.created_at.localeCompare(b.created_at));
    let changed: boolean;
    do {
      changed = false;
      const heldEntities = new Set<string>();
      for (const op of inOrder) {
        if (sendableIds.has(op.op_id) && !heldEntities.has(op.entity_id) && !(op.group_id && heldGroups.has(op.group_id))) {
          continue;
        }
        heldEntities.add(op.entity_id);
        if (op.group_id && !heldGroups.has(op.group_id)) {
          heldGroups.add(op.group_id);
          changed = true;
        }
        if (sendableIds.delete(op.op_id)) changed = true;
      }
    } while (changed);
    eligible = sendable.filter((op) => sendableIds.has(op.op_id));
  }

  return Dexie.ignoreTransaction(async () => {
    const sealed: SyncOp[] = [];
    for (const op of chainBaseRevs(eligible)) {
      const key = keyFor(op);
      if (!key) {
        sealed.push(op.credential_id || op.proof ? { ...op, ...unsigned } : op);
        continue;
      }
      const message = await opMessage(op, key.id);
      if (op.credential_id === key.id && op.proof && op.proof_message === message) {
        sealed.push(op);
        continue;
      }
      const proof = await signProof(key.private_key, message);
      const evidence = { credential_id: key.id, proof, proof_message: message };
      await db.sync_ops.update(op.op_id, evidence);
      sealed.push({ ...op, ...evidence });
    }
    return sealed;
  });
}

export async function prepareIdentityAudit(
  db: ClintraDatabase, deviceId: string, rows: readonly WireAuditRow[],
): Promise<WireAuditRow[]> {
  const device = await db.device.get(deviceId);
  if (!device?.token) return [...rows];

  const enforced = device.identity_enforced_at != null;
  const signed: WireAuditRow[] = [];
  for (const row of rows) {
    const key = row.actor_membership_id
      ? await db.credentials.where("[device_id+membership_id]").equals([deviceId, row.actor_membership_id]).first()
      : undefined;
    const current = await db.audit_log.get(row.id);
    if (!key || key.must_change_password) {
      if (current?.credential_id || current?.proof) {
        await db.audit_log.update(row.id, { credential_id: null, proof: null });
      }
      if (enforced) break;
      const unsigned = { ...row };
      delete unsigned.credential_id;
      delete unsigned.proof;
      signed.push(unsigned);
      continue;
    }
    const proof = current?.credential_id === key.id && current.proof
      ? current.proof
      : await Dexie.ignoreTransaction(async () => signProof(key.private_key, await auditMessage(row, deviceId, key.id)));
    const evidence = { credential_id: key.id, proof };
    if (proof !== current?.proof) await db.audit_log.update(row.id, evidence);
    signed.push({ ...row, ...evidence });
  }
  return signed;
}
