import { beforeEach, describe, expect, it } from "vitest";
import { CancelReason, VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { undoMostRecentVisitMutation } from "./mutate";
import { seedDatabase } from "./seed";
import { cancelVisit, markVisitNoShow } from "./visitCancel";

let db: ClintraDatabase;

function findByPosition<T extends { position: number }>(visits: readonly T[], position: number): T {
  const visit = visits.find((v) => v.position === position);
  if (!visit) throw new Error(`seed did not produce a visit at position ${position}`);
  return visit;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-visit-cancel-test-${crypto.randomUUID()}`);
});

describe("cancelVisit", () => {
  it("writes status and cancel_reason together", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    await cancelVisit(db, bookedVisit.id, CancelReason.Patient);

    const updated = await db.visits.get(bookedVisit.id);
    expect(updated?.status).toBe(VisitStatus.Cancelled);
    expect(updated?.cancel_reason).toBe(CancelReason.Patient);
  });

  it("accepts the clinic reason too", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    await cancelVisit(db, bookedVisit.id, CancelReason.Clinic);

    const updated = await db.visits.get(bookedVisit.id);
    expect(updated?.cancel_reason).toBe(CancelReason.Clinic);
  });

  it("works from confirmed, arrived and in_room, not only booked", async () => {
    await seedDatabase(db);
    const arrivedVisit = findByPosition(await db.visits.toArray(), 2);
    expect(arrivedVisit.status).toBe(VisitStatus.Arrived);

    await cancelVisit(db, arrivedVisit.id, CancelReason.Clinic);

    const updated = await db.visits.get(arrivedVisit.id);
    expect(updated?.status).toBe(VisitStatus.Cancelled);
  });

  it("undo restores status and clears cancel_reason together", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    const auditLogId = await cancelVisit(db, bookedVisit.id, CancelReason.Patient);
    const outcome = await undoMostRecentVisitMutation(db, auditLogId);
    expect(outcome).toEqual({ ok: true });

    const restored = await db.visits.get(bookedVisit.id);
    expect(restored?.status).toBe(VisitStatus.Booked);
    expect(restored?.cancel_reason).toBeNull();
  });

  it("writes nothing when the transition is invalid", async () => {
    await seedDatabase(db);
    const completedVisit = findByPosition(await db.visits.toArray(), 3);

    await expect(cancelVisit(db, completedVisit.id, CancelReason.Patient)).rejects.toThrow(
      /invalid_transition/,
    );

    const unchanged = await db.visits.get(completedVisit.id);
    expect(unchanged).toEqual(completedVisit);
  });
});

describe("markVisitNoShow", () => {
  it("writes status=no_show and cancel_reason=no_show together", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    await markVisitNoShow(db, bookedVisit.id);

    const updated = await db.visits.get(bookedVisit.id);
    expect(updated?.status).toBe(VisitStatus.NoShow);
    expect(updated?.cancel_reason).toBe(CancelReason.NoShow);
  });

  it("undo restores status and clears cancel_reason together", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    const auditLogId = await markVisitNoShow(db, bookedVisit.id);
    const outcome = await undoMostRecentVisitMutation(db, auditLogId);
    expect(outcome).toEqual({ ok: true });

    const restored = await db.visits.get(bookedVisit.id);
    expect(restored?.status).toBe(VisitStatus.Booked);
    expect(restored?.cancel_reason).toBeNull();
  });

  it("writes nothing when the transition is invalid", async () => {
    await seedDatabase(db);
    const completedVisit = findByPosition(await db.visits.toArray(), 3);

    await expect(markVisitNoShow(db, completedVisit.id)).rejects.toThrow(/invalid_transition/);
  });
});
