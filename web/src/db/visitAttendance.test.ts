import { beforeEach, describe, expect, it } from "vitest";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { seedDatabase } from "./seed";
import { AuditAction } from "./types";
import { markVisitArrived, undoMostRecentVisitArrival } from "./visitAttendance";

let db: ClintraDatabase;

function findByPosition<T extends { position: number }>(visits: readonly T[], position: number): T {
  const visit = visits.find((v) => v.position === position);
  if (!visit) throw new Error(`seed did not produce a visit at position ${position}`);
  return visit;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-attendance-test-${crypto.randomUUID()}`);
});

describe("markVisitArrived", () => {
  it("marks a booked visit arrived and stamps arrived_at", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);
    expect(bookedVisit.status).toBe(VisitStatus.Booked);

    const auditLogId = await markVisitArrived(db, bookedVisit.id);
    expect(auditLogId).toBeTruthy();

    const updated = await db.visits.get(bookedVisit.id);
    expect(updated?.status).toBe(VisitStatus.Arrived);
    expect(updated?.arrived_at).not.toBeNull();
  });

  it("writes nothing when the transition is invalid", async () => {
    await seedDatabase(db);
    const completedVisit = findByPosition(await db.visits.toArray(), 3);
    expect(completedVisit.status).toBe(VisitStatus.Completed);

    await expect(markVisitArrived(db, completedVisit.id)).rejects.toThrow(/invalid_transition/);

    const unchanged = await db.visits.get(completedVisit.id);
    expect(unchanged).toEqual(completedVisit);
    expect(await db.audit_log.count()).toBe(0);
    expect(await db.sync_ops.count()).toBe(0);
  });

  it("survives closing and reopening the same database, simulating a page reload", async () => {
    const name = `clintra-attendance-reload-test-${crypto.randomUUID()}`;
    const dbBeforeReload = new ClintraDatabase(name);
    await seedDatabase(dbBeforeReload);
    const bookedVisit = findByPosition(await dbBeforeReload.visits.toArray(), 1);

    await markVisitArrived(dbBeforeReload, bookedVisit.id);
    dbBeforeReload.close();

    // A fresh connection to the same database name, running the exact
    // startup sequence the day screen runs on every mount.
    const dbAfterReload = new ClintraDatabase(name);
    await seedDatabase(dbAfterReload);

    const reread = await dbAfterReload.visits.get(bookedVisit.id);
    expect(reread?.status).toBe(VisitStatus.Arrived);
  });
});

describe("undoMostRecentVisitArrival", () => {
  it("succeeds immediately after the operation, restoring status and arrived_at and appending new rows", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    const auditLogId = await markVisitArrived(db, bookedVisit.id);
    expect(await db.audit_log.count()).toBe(1);
    expect(await db.sync_ops.count()).toBe(1);

    const outcome = await undoMostRecentVisitArrival(db, auditLogId);
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

    const outcome = await undoMostRecentVisitArrival(db, auditLogId);
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

    const outcome = await undoMostRecentVisitArrival(db, auditLogId);
    expect(outcome).toEqual({ ok: false, reason: "expired" });

    const unchanged = await db.visits.get(bookedVisit.id);
    expect(unchanged?.status).toBe(VisitStatus.Arrived);
    expect(await db.audit_log.count()).toBe(1);
    expect(await db.sync_ops.count()).toBe(1);
  });

  it("is refused when auditLogId does not identify a recorded visits mutation, and writes nothing", async () => {
    await seedDatabase(db);

    const outcome = await undoMostRecentVisitArrival(db, "not-a-real-audit-log-id");
    expect(outcome).toEqual({ ok: false, reason: "not_found" });

    expect(await db.audit_log.count()).toBe(0);
    expect(await db.sync_ops.count()).toBe(0);
  });
});
