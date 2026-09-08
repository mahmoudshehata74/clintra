import { beforeEach, describe, expect, it } from "vitest";
import { id } from "../domain/id";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { mutate, undoMostRecentPatientMutation, undoMostRecentVisitMutation } from "./mutate";
import { seedDatabase } from "./seed";
import { AuditAction, type Patient } from "./types";
import { markVisitArrived } from "./visitAttendance";

let db: ClintraDatabase;

function findByPosition<T extends { position: number }>(visits: readonly T[], position: number): T {
  const visit = visits.find((v) => v.position === position);
  if (!visit) throw new Error(`seed did not produce a visit at position ${position}`);
  return visit;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-mutate-test-${crypto.randomUUID()}`);
});

describe("mutate", () => {
  it("writes the entity change, an audit_log row and a sync_ops row together in one transaction", async () => {
    await seedDatabase(db);
    const visits = await db.visits.toArray();
    const visit = visits.find((v) => v.position === 1);
    if (!visit) throw new Error("seed did not produce a visit at position 1");
    const [membership] = await db.memberships.toArray();

    const before = visit;
    const after = { ...visit, status: VisitStatus.Confirmed };

    await mutate(db, {
      table: db.visits,
      entity: "visits",
      entityId: visit.id,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: membership.id,
      orgId: visit.org_id,
    });

    const stored = await db.visits.get(visit.id);
    expect(stored?.status).toBe(VisitStatus.Confirmed);

    const auditRows = await db.audit_log.toArray();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      org_id: visit.org_id,
      actor_membership_id: membership.id,
      entity: "visits",
      entity_id: visit.id,
      action: AuditAction.Update,
      before,
      after,
    });

    const syncRows = await db.sync_ops.toArray();
    expect(syncRows).toHaveLength(1);
    expect(syncRows[0]).toMatchObject({
      entity: "visits",
      entity_id: visit.id,
      action: AuditAction.Update,
      payload: after,
      synced_at: null,
    });
    expect(syncRows[0].op_id).toBeTruthy();
    expect(syncRows[0].device_id).toBeTruthy();
  });

  it("rolls back all three writes together when one part of the transaction fails", async () => {
    await seedDatabase(db);
    const visits = (await db.visits.toArray()).sort((a, b) => a.position - b.position);
    const [visit1, visit2] = visits;

    const before = visit1;
    // Colliding with visit2's position under the same practitioner_id+visit_date
    // violates the unique index, which must throw and roll back the whole transaction.
    const after = { ...visit1, position: visit2.position };

    await expect(
      mutate(db, {
        table: db.visits,
        entity: "visits",
        entityId: visit1.id,
        action: AuditAction.Update,
        before,
        after,
        actorMembershipId: "membership-1",
        orgId: visit1.org_id,
      }),
    ).rejects.toThrow();

    const stored = await db.visits.get(visit1.id);
    expect(stored).toEqual(visit1);
    expect(await db.audit_log.count()).toBe(0);
    expect(await db.sync_ops.count()).toBe(0);
  });
});

describe("undoMostRecentVisitMutation", () => {
  it("succeeds immediately after the operation, restoring status and arrived_at and appending new rows", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    const auditLogId = await markVisitArrived(db, bookedVisit.id);
    expect(await db.audit_log.count()).toBe(1);
    expect(await db.sync_ops.count()).toBe(1);

    const outcome = await undoMostRecentVisitMutation(db, auditLogId);
    expect(outcome).toEqual({ ok: true });

    const restored = await db.visits.get(bookedVisit.id);
    expect(restored?.status).toBe(VisitStatus.Booked);
    expect(restored?.arrived_at).toBeNull();

    const auditRows = await db.audit_log.toArray();
    expect(auditRows).toHaveLength(2);
    expect(auditRows.find((row) => row.id === auditLogId)).toBeTruthy();
    expect(await db.sync_ops.count()).toBe(2);
  });

  it("is refused once another mutation has touched the same visit since, and writes nothing", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    const auditLogId = await markVisitArrived(db, bookedVisit.id);
    const arrivedVisit = await db.visits.get(bookedVisit.id);
    if (!arrivedVisit) throw new Error("visit disappeared");

    // An unrelated later mutation touches the same visit before any undo.
    await mutate(db, {
      table: db.visits,
      entity: "visits",
      entityId: bookedVisit.id,
      action: AuditAction.Update,
      before: arrivedVisit,
      after: { ...arrivedVisit, status: VisitStatus.InRoom },
      actorMembershipId: "membership-1",
      orgId: bookedVisit.org_id,
    });

    const outcome = await undoMostRecentVisitMutation(db, auditLogId);
    expect(outcome).toEqual({ ok: false, reason: "stale" });

    const unchanged = await db.visits.get(bookedVisit.id);
    expect(unchanged?.status).toBe(VisitStatus.InRoom);
    expect(await db.audit_log.count()).toBe(2);
    expect(await db.sync_ops.count()).toBe(2);
  });

  it("is refused once the undo window has expired, and writes nothing", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    const auditLogId = await markVisitArrived(db, bookedVisit.id);
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await db.audit_log.update(auditLogId, { at: sixMinutesAgo });

    const outcome = await undoMostRecentVisitMutation(db, auditLogId);
    expect(outcome).toEqual({ ok: false, reason: "expired" });

    const unchanged = await db.visits.get(bookedVisit.id);
    expect(unchanged?.status).toBe(VisitStatus.Arrived);
    expect(await db.audit_log.count()).toBe(1);
    expect(await db.sync_ops.count()).toBe(1);
  });

  it("is refused when auditLogId does not identify a recorded visits mutation, and writes nothing", async () => {
    await seedDatabase(db);

    const outcome = await undoMostRecentVisitMutation(db, "not-a-real-audit-log-id");
    expect(outcome).toEqual({ ok: false, reason: "not_found" });

    expect(await db.audit_log.count()).toBe(0);
    expect(await db.sync_ops.count()).toBe(0);
  });

  it("deletes the row when undoing a create, rather than updating it back to a non-existent 'before'", async () => {
    await seedDatabase(db);
    const [membership] = await db.memberships.toArray();
    const patientId = id();

    const auditLogId = await mutate(db, {
      table: db.patients,
      entity: "patients",
      entityId: patientId,
      action: AuditAction.Create,
      before: null,
      after: {
        id: patientId,
        org_id: membership.org_id,
        full_name: "مريض جديد",
        phone: null,
        gender: null,
        birth_year: null,
        note: null,
        created_at: new Date().toISOString(),
      } satisfies Patient,
      actorMembershipId: membership.id,
      orgId: membership.org_id,
    });

    const outcome = await undoMostRecentPatientMutation(db, auditLogId);
    expect(outcome).toEqual({ ok: true });

    expect(await db.patients.get(patientId)).toBeUndefined();
    const auditRows = await db.audit_log.toArray();
    const undoRow = auditRows.find((row) => row.action === AuditAction.Delete && row.entity_id === patientId);
    expect(undoRow).toBeTruthy();
  });
});
