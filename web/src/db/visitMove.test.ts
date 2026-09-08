import { beforeEach, describe, expect, it } from "vitest";
import { CancelReason, VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { undoMostRecentVisitMutation } from "./mutate";
import { seedDatabase } from "./seed";
import { moveVisit } from "./visitMove";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-visit-move-test-${crypto.randomUUID()}`);
});

async function seededContext() {
  await seedDatabase(db);
  const [schedule] = await db.schedules.toArray();
  const visits = await db.visits.toArray();
  return { schedule, visits };
}

describe("moveVisit", () => {
  it("creates a new visit at the target slot and marks the original rescheduled", async () => {
    const { schedule, visits } = await seededContext();
    const bookedVisit = visits.find((v) => v.status === VisitStatus.Booked);
    if (!bookedVisit) throw new Error("seed did not produce a booked visit");

    const outcome = await moveVisit(db, {
      visitId: bookedVisit.id,
      toDate: bookedVisit.visit_date,
      toTime: "11:30",
      toSchedule: schedule,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");

    const oldVisit = await db.visits.get(bookedVisit.id);
    expect(oldVisit?.status).toBe(VisitStatus.Rescheduled);
    expect(oldVisit?.cancel_reason).toBe(CancelReason.Postpone);

    const newVisit = (await db.visits.toArray()).find((v) => v.position === 6);
    expect(newVisit).toBeTruthy();
    expect(newVisit?.status).toBe(VisitStatus.Booked);
    expect(newVisit?.patient_id).toBe(bookedVisit.patient_id);
    expect(newVisit?.rescheduled_from).toBe(bookedVisit.id);

    // Both writes are on record as separate audit_log rows, each undoable.
    const auditRows = await db.audit_log.toArray();
    expect(auditRows.find((r) => r.id === outcome.oldVisitAuditLogId)).toBeTruthy();
    expect(auditRows.find((r) => r.id === outcome.newVisitAuditLogId)).toBeTruthy();
  });

  it("reuses a freed (cancelled/no_show/rescheduled) row at the target slot rather than creating a new one", async () => {
    const { schedule, visits } = await seededContext();
    const bookedVisit = visits.find((v) => v.status === VisitStatus.Booked);
    const cancelledVisit = visits.find((v) => v.status === VisitStatus.Cancelled);
    if (!bookedVisit || !cancelledVisit) throw new Error("seed missing expected statuses");

    const visitCountBefore = await db.visits.count();

    const outcome = await moveVisit(db, {
      visitId: bookedVisit.id,
      toDate: bookedVisit.visit_date,
      toTime: "11:00", // the cancelled visit's own slot
      toSchedule: schedule,
    });

    expect(outcome.ok).toBe(true);
    expect(await db.visits.count()).toBe(visitCountBefore);

    const reused = await db.visits.get(cancelledVisit.id);
    expect(reused?.status).toBe(VisitStatus.Booked);
    expect(reused?.patient_id).toBe(bookedVisit.patient_id);
    expect(reused?.rescheduled_from).toBe(bookedVisit.id);
  });

  it("refuses when the target slot is occupied, and writes nothing", async () => {
    const { schedule, visits } = await seededContext();
    const bookedVisit = visits.find((v) => v.status === VisitStatus.Booked);
    const arrivedVisit = visits.find((v) => v.status === VisitStatus.Arrived);
    if (!bookedVisit || !arrivedVisit) throw new Error("seed missing expected statuses");

    const auditCountBefore = await db.audit_log.count();

    const outcome = await moveVisit(db, {
      visitId: bookedVisit.id,
      toDate: bookedVisit.visit_date,
      toTime: "09:30", // the arrived visit's own occupied slot
      toSchedule: schedule,
    });

    expect(outcome).toEqual({ ok: false, reason: "slot_taken" });
    const unchanged = await db.visits.get(bookedVisit.id);
    expect(unchanged?.status).toBe(VisitStatus.Booked);
    expect(await db.audit_log.count()).toBe(auditCountBefore);
  });

  it("a stale target slot cannot cause a lost update: the second of two moves to the same free slot is refused", async () => {
    const { schedule, visits } = await seededContext();
    const bookedVisit = visits.find((v) => v.status === VisitStatus.Booked);
    const arrivedVisit = visits.find((v) => v.status === VisitStatus.Arrived);
    if (!bookedVisit || !arrivedVisit) throw new Error("seed missing expected statuses");

    const firstOutcome = await moveVisit(db, {
      visitId: bookedVisit.id,
      toDate: bookedVisit.visit_date,
      toTime: "11:30",
      toSchedule: schedule,
    });
    expect(firstOutcome.ok).toBe(true);

    // A second, unrelated visit "sees" the same empty slot list (stale by
    // the time it acts) and tries to move into the exact same target.
    const secondOutcome = await moveVisit(db, {
      visitId: arrivedVisit.id,
      toDate: bookedVisit.visit_date,
      toTime: "11:30",
      toSchedule: schedule,
    });

    expect(secondOutcome).toEqual({ ok: false, reason: "slot_taken" });
    // The arrived visit was never touched by the refused move.
    const stillArrived = await db.visits.get(arrivedVisit.id);
    expect(stillArrived?.status).toBe(VisitStatus.Arrived);
  });

  it("undo restores the original date/time/position/status atomically, in reverse order", async () => {
    const { schedule, visits } = await seededContext();
    const bookedVisit = visits.find((v) => v.status === VisitStatus.Booked);
    if (!bookedVisit) throw new Error("seed did not produce a booked visit");

    const outcome = await moveVisit(db, {
      visitId: bookedVisit.id,
      toDate: bookedVisit.visit_date,
      toTime: "11:30",
      toSchedule: schedule,
    });
    if (!outcome.ok) throw new Error("expected success");

    // Mirrors DayScreen's undo handler: new visit first, then the old one.
    const newUndo = await undoMostRecentVisitMutation(db, outcome.newVisitAuditLogId);
    expect(newUndo).toEqual({ ok: true });

    const oldUndo = await undoMostRecentVisitMutation(db, outcome.oldVisitAuditLogId);
    expect(oldUndo).toEqual({ ok: true });

    const restoredOld = await db.visits.get(bookedVisit.id);
    expect(restoredOld).toEqual(bookedVisit);

    const newVisitStillExists = (await db.visits.toArray()).some((v) => v.position === 6);
    expect(newVisitStillExists).toBe(false);
  });
});
