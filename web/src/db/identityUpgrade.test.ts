import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { generateIdentityKey } from "../auth/identityClient";
import { signProof } from "../auth/proof";
import { ClintraDatabase } from "./database";

describe("version 29 identity stores", () => {
  it("preserves v28 history and attributes an old operation from its audit row", async () => {
    const name = `clintra-identity-upgrade-${crypto.randomUUID()}`;
    const db = new ClintraDatabase(name);
    const stores = Object.fromEntries(db.tables
      .filter((table) => !["credentials", "device_keys"].includes(table.name))
      .map((table) => [table.name, [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(", ")]));
    const old = new Dexie(name);
    old.version(28).stores(stores);
    const entry = { entity: "patients", entity_id: "patient", action: "create", after: { id: "patient", full_name: "منى" } };
    const at = "2026-11-20T07:00:00.000Z";
    await old.table("patients").add(entry.after);
    await old.table("audit_log").add({ ...entry, id: "audit", seq: 1, at, actor_membership_id: "assistant", before: null });
    await old.table("sync_ops").add({ ...entry, op_id: "op", created_at: at, payload: entry.after, synced_at: null });
    old.close();

    try {
      expect(await db.patients.get("patient")).toEqual(entry.after);
      expect(await db.sync_ops.count()).toBe(1);
      expect(await db.audit_log.count()).toBe(1);
      expect(await db.sync_ops.get("op")).toMatchObject({ actor_membership_id: "assistant", credential_id: null, proof: null });
      expect(await db.audit_log.get("audit")).toMatchObject({ id: "audit", seq: 1, credential_id: null, proof: null });
      expect(await db.credentials.count()).toBe(0);
    } finally {
      await db.delete();
    }
  });

  it("clones a non-extractable signing key through IndexedDB", async () => {
    const db = new ClintraDatabase(`clintra-identity-keys-${crypto.randomUUID()}`);
    try {
      const keys = await generateIdentityKey();
      await db.device_keys.add({ device_id: "device", ...keys });
      db.close();
      await db.open();
      const stored = await db.device_keys.get("device");
      expect(stored?.private_key.extractable).toBe(false);
      expect(await signProof(stored!.private_key, "clintra-req-v1")).toMatch(/^[A-Za-z0-9_-]{86}$/);
    } finally {
      await db.delete();
    }
  });
});
