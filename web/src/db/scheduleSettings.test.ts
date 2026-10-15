import { beforeEach, describe, expect, it } from "vitest";
import { generateSlotTimes } from "../domain/schedule";
import { ScheduleMode } from "../domain/scheduleMode";
import { addDaysToClinicDay, todayInCairo, weekdayOf } from "../domain/time";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { addWorkingDay, removeWorkingDay, updateWorkingHours, workingDayTemplate } from "./scheduleSettings";
import { findSeededSlotsPractitioner, seedDatabase, seededVisitsDate } from "./seed";
import type { Schedule } from "./types";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-schedule-settings-test-${crypto.randomUUID()}`);
});

async function schedulesForSlotsPractitioner(): Promise<Schedule[]> {
  const practitioner = await findSeededSlotsPractitioner(db);
  return (await db.schedules.toArray()).filter((schedule) => schedule.practitioner_id === practitioner.id);
}

describe("updateWorkingHours", () => {
  it("refuses a slot_minutes change on a weekday that already has visits", async () => {
    await seedDatabase(db);
    const seededWeekday = weekdayOf(seededVisitsDate());
    const schedule = (await schedulesForSlotsPractitioner()).find((s) => s.weekday === seededWeekday)!;

    const result = await updateWorkingHours(db, schedule.id, {
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      slotMinutes: (schedule.slot_minutes ?? 30) + 15,
      maxCapacity: null,
    });

    expect(result).toEqual({ ok: false, reason: "visits_on_old_grid" });
    const unchanged = await db.schedules.get(schedule.id);
    expect(unchanged?.slot_minutes).toBe(schedule.slot_minutes);
  });

  it("allows a slot_minutes change on a weekday with no visits and regenerates the grid", async () => {
    await seedDatabase(db);
    const seededWeekday = weekdayOf(seededVisitsDate());
    const emptyWeekday = (seededWeekday + 1) % 7;
    const schedule = (await schedulesForSlotsPractitioner()).find((s) => s.weekday === emptyWeekday)!;
    const before = generateSlotTimes(schedule).length;

    const result = await updateWorkingHours(db, schedule.id, {
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      slotMinutes: (schedule.slot_minutes ?? 30) * 2,
      maxCapacity: null,
    });

    expect(result).toEqual({ ok: true });
    const updated = await db.schedules.get(schedule.id);
    expect(updated?.slot_minutes).toBe((schedule.slot_minutes ?? 30) * 2);
    // Doubling the slot length halves (roughly) the number of generated slots.
    expect(generateSlotTimes(updated!).length).toBeLessThan(before);
  });

  it("allows editing start/end hours on a weekday with visits (slot length unchanged)", async () => {
    await seedDatabase(db);
    const seededWeekday = weekdayOf(seededVisitsDate());
    const schedule = (await schedulesForSlotsPractitioner()).find((s) => s.weekday === seededWeekday)!;

    const result = await updateWorkingHours(db, schedule.id, {
      startTime: "08:00",
      endTime: "15:00",
      slotMinutes: schedule.slot_minutes,
      maxCapacity: null,
    });

    expect(result).toEqual({ ok: true });
    const updated = await db.schedules.get(schedule.id);
    expect(updated?.start_time).toBe("08:00");
    expect(updated?.end_time).toBe("15:00");
  });

  it("rejects end before start and non-positive slot minutes", async () => {
    await seedDatabase(db);
    const seededWeekday = weekdayOf(seededVisitsDate());
    const emptyWeekday = (seededWeekday + 1) % 7;
    const schedule = (await schedulesForSlotsPractitioner()).find((s) => s.weekday === emptyWeekday)!;

    expect(
      await updateWorkingHours(db, schedule.id, {
        startTime: "14:00",
        endTime: "09:00",
        slotMinutes: 30,
        maxCapacity: null,
      }),
    ).toEqual({ ok: false, reason: "end_before_start" });

    expect(
      await updateWorkingHours(db, schedule.id, {
        startTime: "09:00",
        endTime: "14:00",
        slotMinutes: 0,
        maxCapacity: null,
      }),
    ).toEqual({ ok: false, reason: "invalid_slot_minutes" });
  });
});

function scheduleRow(weekday: number, startTime: string, endTime: string, overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: `schedule-${weekday}-${startTime}`,
    practitioner_id: "practitioner-1",
    location_id: "location-1",
    weekday,
    start_time: startTime,
    end_time: endTime,
    mode: ScheduleMode.Slots,
    slot_minutes: 20,
    max_capacity: null,
    resource_count: 1,
    rev: 1,
    ...overrides,
  };
}

describe("workingDayTemplate", () => {
  it.each([
    ["no working day", [], "09:00", "17:00"],
    ["one working day", [scheduleRow(1, "10:00", "14:00")], "10:00", "14:00"],
    [
      "the most common hours",
      [scheduleRow(0, "08:00", "12:00"), scheduleRow(1, "10:00", "14:00"), scheduleRow(2, "10:00", "14:00")],
      "10:00",
      "14:00",
    ],
    [
      "a tie, to the earlier start",
      [scheduleRow(0, "11:00", "15:00"), scheduleRow(1, "08:00", "12:00")],
      "08:00",
      "12:00",
    ],
    [
      "a tie on the start, to the earlier end",
      [scheduleRow(0, "08:00", "16:00"), scheduleRow(1, "08:00", "12:00")],
      "08:00",
      "12:00",
    ],
  ])("%s", (_label, schedules, startTime, endTime) => {
    const template = workingDayTemplate(schedules);
    expect([template.startTime, template.endTime]).toEqual([startTime, endTime]);
  });

  it("copies from the earliest weekday with those hours", () => {
    const template = workingDayTemplate([
      scheduleRow(4, "10:00", "14:00", { slot_minutes: 45 }),
      scheduleRow(2, "10:00", "14:00", { slot_minutes: 15 }),
    ]);
    expect(template.copyFrom?.weekday).toBe(2);
  });
});

describe("addWorkingDay / removeWorkingDay", () => {
  async function slotsPractitionerScope() {
    const practitioner = await findSeededSlotsPractitioner(db);
    const [schedule] = await schedulesForSlotsPractitioner();
    return { practitionerId: practitioner.id, locationId: schedule.location_id };
  }

  it("turns a working day off and back on, with the most common hours and the same mode, audited and queued", async () => {
    await seedDatabase(db);
    const scope = await slotsPractitionerScope();
    const weekday = (weekdayOf(todayInCairo()) + 3) % 7;

    expect(await removeWorkingDay(db, { ...scope, weekday })).toEqual({ ok: true });
    expect((await schedulesForSlotsPractitioner()).some((s) => s.weekday === weekday)).toBe(false);

    const remaining = await schedulesForSlotsPractitioner();
    const template = workingDayTemplate(remaining);
    const added = await addWorkingDay(db, { ...scope, weekday, startTime: template.startTime, endTime: "13:00" });
    expect(added.ok).toBe(true);

    const restored = (await schedulesForSlotsPractitioner()).filter((s) => s.weekday === weekday);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      start_time: template.startTime,
      end_time: "13:00",
      mode: remaining[0].mode,
      slot_minutes: remaining[0].slot_minutes,
      rev: 1,
    });

    const ops = (await db.sync_ops.toArray())
      .filter((op) => op.entity === "schedules")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(ops.map((op) => op.action)).toEqual(["delete", "create"]);
    const audit = (await db.audit_log.orderBy("seq").toArray()).filter((row) => row.entity === "schedules");
    expect(audit.map((row) => row.action)).toEqual(["delete", "create"]);
  });

  it("refuses to add a working day that already is one, or hours that end before they start", async () => {
    await seedDatabase(db);
    const scope = await slotsPractitionerScope();
    const weekday = weekdayOf(todayInCairo());

    expect(await addWorkingDay(db, { ...scope, weekday, startTime: "09:00", endTime: "17:00" })).toEqual({
      ok: false,
      reason: "already_working_day",
    });
    await removeWorkingDay(db, { ...scope, weekday: (weekday + 1) % 7 });
    expect(await addWorkingDay(db, { ...scope, weekday: (weekday + 1) % 7, startTime: "17:00", endTime: "09:00" })).toEqual({
      ok: false,
      reason: "end_before_start",
    });
  });

  it("refuses to remove a day off, and a day with a booked visit today or later; a past visit does not block", async () => {
    await seedDatabase(db);
    const scope = await slotsPractitionerScope();
    const seededWeekday = weekdayOf(seededVisitsDate());

    // The seeded visits are on a past day of this weekday.
    expect(await removeWorkingDay(db, { ...scope, weekday: seededWeekday })).toEqual({ ok: true });
    expect(await removeWorkingDay(db, { ...scope, weekday: seededWeekday })).toEqual({ ok: false, reason: "not_working_day" });

    // A day next week on another weekday than the one just turned off.
    const nextWeek = addDaysToClinicDay(todayInCairo(), weekdayOf(todayInCairo()) === seededWeekday ? 8 : 7);
    const [seeded] = (await db.visits.toArray()).filter((visit) => visit.practitioner_id === scope.practitionerId);
    await db.visits.put({ ...seeded, id: "upcoming-visit", visit_date: nextWeek, status: VisitStatus.Booked, position: 99 });
    const upcomingWeekday = weekdayOf(nextWeek);
    expect(await removeWorkingDay(db, { ...scope, weekday: upcomingWeekday })).toEqual({
      ok: false,
      reason: "upcoming_visits_on_day",
    });
    expect((await schedulesForSlotsPractitioner()).some((s) => s.weekday === upcomingWeekday)).toBe(true);

    await db.visits.update("upcoming-visit", { status: VisitStatus.Cancelled });
    expect(await removeWorkingDay(db, { ...scope, weekday: upcomingWeekday })).toEqual({ ok: true });
  });
});
