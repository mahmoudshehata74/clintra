import { beforeEach, describe, expect, it } from "vitest";
import { addDaysToClinicDay, cairoInstant, todayInCairo, type ClinicDay } from "../domain/time";
import { VisitStatus } from "../domain/visitStatus";
import { runSyncCycle } from "../sync/engine";
import { FakeTransport } from "../sync/fakeTransport";
import { ClintraDatabase } from "./database";
import { activeVisitsOn, addScheduleException, deleteScheduleException } from "./scheduleExceptions";
import { findSeededSlotsPractitioner, seedDatabase } from "./seed";
import { ScheduleExceptionType, type ScheduleException, type Visit } from "./types";

let db: ClintraDatabase;
let practitionerId: string;
const NOW = new Date();
const TODAY = todayInCairo(NOW);
const LATER = addDaysToClinicDay(TODAY, 10) as ClinicDay;

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-schedule-exceptions-test-${crypto.randomUUID()}`);
  await seedDatabase(db);
  practitionerId = (await findSeededSlotsPractitioner(db)).id;
  await db.sync_ops.clear();
  await db.audit_log.clear();
});

async function bookOn(date: ClinicDay, time: string, status: VisitStatus = VisitStatus.Booked): Promise<Visit> {
  const [template] = await db.visits.toArray();
  const scheduledAt = cairoInstant(date, time);
  const visit: Visit = { ...template, id: crypto.randomUUID(), practitioner_id: practitionerId, visit_date: date, position: 900 + Number(time.slice(0, 2)), scheduled_at: scheduledAt, unique_scheduled_at: scheduledAt, status };
  await db.visits.put(visit);
  return visit;
}

describe("addScheduleException", () => {
  it("adds a closed date as one synced, audited row", async () => {
    const result = await addScheduleException(db, { practitionerId, date: LATER, kind: "closed" }, NOW);

    expect(result.ok).toBe(true);
    const [row] = await db.schedule_exceptions.toArray();
    expect(row).toMatchObject({ practitioner_id: practitionerId, date: LATER, type: ScheduleExceptionType.Closed, start_time: null, end_time: null, rev: 1 });
    const ops = await db.sync_ops.toArray();
    expect(ops.map((op) => [op.entity, op.action, op.entity_id])).toEqual([["schedule_exceptions", "create", row.id]]);
    expect((await db.audit_log.toArray()).map((entry) => entry.entity)).toEqual(["schedule_exceptions"]);
  });

  it("adds a date's own hours", async () => {
    await addScheduleException(db, { practitionerId, date: LATER, kind: "hours", startTime: "10:00", endTime: "13:00" }, NOW);
    expect(await db.schedule_exceptions.toArray()).toEqual([
      expect.objectContaining({ type: ScheduleExceptionType.Shifted, start_time: "10:00", end_time: "13:00" }),
    ]);
  });

  it("refuses a second exception on the same date, a past date, a malformed date and hours ending before they start", async () => {
    await addScheduleException(db, { practitionerId, date: LATER, kind: "closed" }, NOW);
    expect(await addScheduleException(db, { practitionerId, date: LATER, kind: "hours", startTime: "10:00", endTime: "11:00" }, NOW)).toEqual({ ok: false, reason: "already_has_exception" });
    expect(await addScheduleException(db, { practitionerId, date: addDaysToClinicDay(TODAY, -1), kind: "closed" }, NOW)).toEqual({ ok: false, reason: "past_date" });
    expect(await addScheduleException(db, { practitionerId, date: "2026-02-30" as ClinicDay, kind: "closed" }, NOW)).toEqual({ ok: false, reason: "invalid_date" });
    expect(await addScheduleException(db, { practitionerId, date: addDaysToClinicDay(LATER, 1), kind: "hours", startTime: "12:00", endTime: "12:00" }, NOW)).toEqual({ ok: false, reason: "end_before_start" });
    expect(await db.schedule_exceptions.count()).toBe(1);
  });

  it("never touches the visits booked on a closed date", async () => {
    const booked = await bookOn(LATER, "10:00");
    const arrived = await bookOn(LATER, "11:00", VisitStatus.Arrived);
    await bookOn(LATER, "12:00", VisitStatus.Cancelled);
    const before = await db.visits.toArray();

    expect(await activeVisitsOn(db, practitionerId, LATER)).toEqual([booked, arrived]);
    await addScheduleException(db, { practitionerId, date: LATER, kind: "closed" }, NOW);

    expect(await db.visits.toArray()).toEqual(before);
    expect((await db.sync_ops.toArray()).map((op) => op.entity)).toEqual(["schedule_exceptions"]);
  });
});

describe("deleteScheduleException", () => {
  it("removes the row with a synced delete", async () => {
    const result = await addScheduleException(db, { practitionerId, date: LATER, kind: "closed" }, NOW);
    if (!result.ok) {
      throw new Error("not added");
    }

    expect(await deleteScheduleException(db, result.exceptionId)).toEqual({ ok: true });
    expect(await db.schedule_exceptions.count()).toBe(0);
    expect((await db.sync_ops.toCollection().sortBy("created_at")).map((op) => op.action)).toEqual(["create", "delete"]);
    expect(await deleteScheduleException(db, result.exceptionId)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("an exception through the sync engine", () => {
  it("is pushed and accepted like any syncable row", async () => {
    await addScheduleException(db, { practitionerId, date: LATER, kind: "hours", startTime: "10:00", endTime: "12:00" }, NOW);
    const serverName = `clintra-schedule-exceptions-server-${crypto.randomUUID()}`;

    await runSyncCycle(db, new FakeTransport(serverName));

    expect((await db.sync_ops.toArray()).every((op) => op.synced_at !== null)).toBe(true);
    expect(await db.sync_review.count()).toBe(0);
    const onServer: ScheduleException[] = await new ClintraDatabase(serverName).schedule_exceptions.toArray();
    expect(onServer.map((row) => [row.date, row.start_time, row.end_time])).toEqual([[LATER, "10:00", "12:00"]]);
  });
});
