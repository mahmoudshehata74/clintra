import { beforeEach, describe, expect, it } from "vitest";
import { auditEntriesOfDay, findAuditEntry, remoteAuditRowOf } from "./auditEntries";
import { ClintraDatabase } from "./database";
import { AuditAction, type AuditLog, type RemoteAuditLog } from "./types";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-audit-entries-test-${crypto.randomUUID()}`);
});

function ownRow(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: crypto.randomUUID(),
    seq: 1,
    org_id: "org-1",
    actor_membership_id: "membership-1",
    entity: "invoices",
    entity_id: "invoice-1",
    action: AuditAction.Create,
    before: null,
    after: { id: "invoice-1" },
    at: "2026-10-17T07:00:00.000Z",
    ...overrides,
  };
}

function remoteRow(overrides: Partial<RemoteAuditLog> = {}): RemoteAuditLog {
  return {
    id: crypto.randomUUID(),
    org_id: "org-1",
    location_id: null,
    practitioner_id: null,
    actor_membership_id: "membership-2",
    device_id: "device-b",
    entity: "invoices",
    entity_id: "invoice-2",
    action: AuditAction.Create,
    before: null,
    after: { id: "invoice-2" },
    at: "2026-10-17T08:00:00.000Z",
    ...overrides,
  };
}

describe("auditEntriesOfDay", () => {
  it("lists both stores' rows of the Cairo day, and no other day's", async () => {
    // 2026-10-17 in Cairo (UTC+3) runs from 2026-10-16T21:00Z to 2026-10-17T21:00Z.
    const own = ownRow({ at: "2026-10-16T21:00:00.000Z" });
    const ownYesterday = ownRow({ seq: 2, at: "2026-10-16T20:59:59.999Z" });
    const remote = remoteRow({ at: "2026-10-17T20:59:59.999Z" });
    const remoteTomorrow = remoteRow({ at: "2026-10-17T21:00:00.000Z" });
    await db.audit_log.bulkAdd([own, ownYesterday]);
    await db.remote_audit_log.bulkAdd([remote, remoteTomorrow]);

    const entries = await auditEntriesOfDay(db, "2026-10-17");

    expect(entries.map((entry) => entry.id).sort()).toEqual([own.id, remote.id].sort());
    // An own row reads without its device-local seq.
    expect(entries.find((entry) => entry.id === own.id)).not.toHaveProperty("seq");
  });
});

describe("findAuditEntry", () => {
  it("finds an entity's action in this device's rows, else in the pulled ones", async () => {
    await db.audit_log.add(ownRow());
    await db.remote_audit_log.add(remoteRow());

    expect((await findAuditEntry(db, "invoices", "invoice-1", AuditAction.Create))?.actor_membership_id).toBe("membership-1");
    expect((await findAuditEntry(db, "invoices", "invoice-2", AuditAction.Create))?.actor_membership_id).toBe("membership-2");
    expect(await findAuditEntry(db, "invoices", "invoice-2", AuditAction.Update)).toBeUndefined();
    expect(await findAuditEntry(db, "invoices", "invoice-3", AuditAction.Create)).toBeUndefined();
  });
});

describe("remoteAuditRowOf", () => {
  it("keeps exactly a pulled row's fields", () => {
    const row = remoteRow();
    expect(remoteAuditRowOf({ ...row, seq: 41 } as RemoteAuditLog)).toEqual(row);
  });
});
