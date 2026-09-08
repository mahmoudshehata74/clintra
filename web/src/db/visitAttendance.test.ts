import { beforeEach, describe, expect, it } from "vitest";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import { markVisitArrived } from "./visitAttendance";

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
