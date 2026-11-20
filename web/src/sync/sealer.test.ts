import Dexie from "dexie";
import { expect, it, vi } from "vitest";
import { generateIdentityKey } from "../auth/identityClient";
import { clearActiveSession, setActiveMembershipId } from "../auth/session";
import { ClintraDatabase } from "../db/database";
import type { SyncOp } from "../db/types";
import { prepareIdentityAudit, prepareIdentityOps } from "./sealer";
import type { WireAuditRow } from "./transport";

it("holds unsigned work, later operations on its entity and entire dependent groups", async () => {
  const db = new ClintraDatabase(`clintra-sealer-${crypto.randomUUID()}`);
  const op = (op_id: string, entity_id: string, actor_membership_id: string, group_id?: string): SyncOp => ({
    op_id, entity_id, actor_membership_id, group_id, entity: "patients", action: "create", payload: { id: entity_id },
    device_id: "device", created_at: op_id, synced_at: null, base_rev: null, failure_count: 0, next_retry_at: null,
  });
  const batch = [
    op("1", "held", "unsigned"),
    op("2", "other-entity", "signed", "group"),
    op("3", "held", "signed", "group"),
    op("4", "other-entity", "signed"),
    op("5", "unrelated", "signed"),
  ];
  const originalSign = crypto.subtle.sign.bind(crypto.subtle);
  const sign = vi.spyOn(crypto.subtle, "sign").mockImplementation((algorithm, key, data) => {
    expect(Dexie.currentTransaction).toBeNull();
    return originalSign(algorithm, key, data);
  });

  try {
    await db.table("device").add({ id: "device", token: "fixture", org_id: "org", identity_enforced_at: "2026-11-20T10:34:56Z" });
    await db.credentials.add({
      id: "credential", membership_id: "signed", device_id: "device", must_change_password: false, ...await generateIdentityKey(),
    });
    await db.sync_ops.bulkAdd(batch);

    const sealed = await prepareIdentityOps(db, "device", batch, batch);

    expect(sealed.map(({ op_id }) => op_id)).toEqual(["5"]);
    expect(await db.sync_ops.get("5")).toMatchObject({ credential_id: "credential", proof: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/) });
    expect(await db.sync_ops.get("3")).not.toHaveProperty("proof");
    expect(sign).toHaveBeenCalledTimes(1);
  } finally {
    sign.mockRestore();
    await db.delete();
  }
});

it.each([
  { title: "leaves A's operation and audit row unsigned while B is signed in here", author: "a", enrollAuthor: false },
  { title: "signs A's operation and audit row once A has a credential on this device", author: "a", enrollAuthor: true },
  { title: "leaves ambiguous authorship unsigned even when A and B have local credentials", author: null, enrollAuthor: true },
])("$title", async ({ author, enrollAuthor }) => {
  const db = new ClintraDatabase(`clintra-author-proof-${crypto.randomUUID()}`);
  const addCredential = async (member: string, device: string) => {
    await db.credentials.add({
      id: `${member}-${device}`, membership_id: member, device_id: device, must_change_password: false, ...await generateIdentityKey(),
    });
  };
  try {
    // Permissions by themselves do not enable hold mode. In legacy mode
    // the unsigned row can still be sent without either proof field.
    await db.table("device").add({ id: "here", token: "fixture", org_id: "org" });
    await db.table("memberships").add({ id: "b", org_id: "org", permissions: [] });
    await addCredential("b", "here");
    await addCredential("a", "elsewhere");
    setActiveMembershipId("b");

    const at = "2026-11-20T10:34:56Z";
    const op: SyncOp = {
      op_id: "op", entity: "patients", entity_id: "patient", action: "create", payload: { id: "patient" },
      actor_membership_id: author, created_at: at, device_id: "here", synced_at: null, base_rev: null,
      failure_count: 0, next_retry_at: null, credential_id: "b-here", proof: "old-proof",
    };
    const audit: WireAuditRow = {
      id: "audit", entity: op.entity, entity_id: op.entity_id, action: op.action, at, org_id: "org",
      actor_membership_id: author ?? "", before: null, after: op.payload, location_id: null, practitioner_id: null,
    };
    await db.sync_ops.add(op);
    await db.audit_log.add({ ...audit, seq: 1, credential_id: "b-here", proof: "old-proof" });
    if (enrollAuthor) await addCredential("a", "here");

    const operations = await prepareIdentityOps(db, "here", [op], [op]);
    const auditRows = await prepareIdentityAudit(db, "here", [audit]);

    if (author && enrollAuthor) {
      const evidence = { credential_id: "a-here", proof: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/) };
      expect(operations).toMatchObject([evidence]);
      expect(auditRows).toMatchObject([evidence]);
    } else {
      expect(operations).toMatchObject([{ credential_id: null, proof: null }]);
      expect(auditRows).toEqual([audit]);
      expect(await db.sync_ops.get(op.op_id)).toMatchObject({ credential_id: null, proof: null });
      expect(await db.audit_log.get(audit.id)).toMatchObject({ credential_id: null, proof: null });
    }
  } finally {
    clearActiveSession();
    await db.delete();
  }
});
