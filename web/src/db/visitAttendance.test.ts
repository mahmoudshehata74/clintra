import { beforeEach, describe, expect, it } from "vitest";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import { markVisitArrived, restoreVisitSnapshot } from "./visitAttendance";

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

    const previous = await markVisitArrived(db, bookedVisit.id);
    expect(previous.status).toBe(VisitStatus.Booked);
    expect(previous.arrived_at).toBeNull();

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
});

describe("restoreVisitSnapshot (undo)", () => {
  it("restores the previous status and arrived_at, and appends new audit and sync rows rather than removing any", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    const previous = await markVisitArrived(db, bookedVisit.id);
    expect(await db.audit_log.count()).toBe(1);
    expect(await db.sync_ops.count()).toBe(1);
    const [arriveAuditRow] = await db.audit_log.toArray();

    await restoreVisitSnapshot(db, previous);

    const restored = await db.visits.get(bookedVisit.id);
    expect(restored?.status).toBe(VisitStatus.Booked);
    expect(restored?.arrived_at).toBeNull();

    const auditRows = await db.audit_log.toArray();
    expect(auditRows).toHaveLength(2);
    expect(auditRows.find((row) => row.id === arriveAuditRow.id)).toBeTruthy();

    expect(await db.sync_ops.count()).toBe(2);
  });
});
