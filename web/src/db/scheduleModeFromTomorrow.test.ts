import { beforeEach, describe, expect, it } from "vitest";
import { addMinutesToClockTime } from "../domain/schedule";
import { effectiveScheduleMode, ScheduleMode } from "../domain/scheduleMode";
import { addDaysToClinicDay, cairoInstant, todayInCairo, weekdayOf, type ClinicDay } from "../domain/time";
import { ClintraDatabase } from "./database";
import { modeFromTomorrow, switchModeFromTomorrow } from "./scheduleModeSwitch";
import { updateWorkingHours } from "./scheduleSettings";
import { findSeededQueuePractitioner, findSeededSlotsPractitioner, seedDatabase } from "./seed";
import type { Schedule, Visit } from "./types";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-mode-from-tomorrow-test-${crypto.randomUUID()}`);
});

async function schedulesOf(practitionerId: string): Promise<Schedule[]> {
  return (await db.schedules.toArray()).filter((schedule) => schedule.practitioner_id === practitionerId);
}

async function visitsOf(practitionerId: string): Promise<Visit[]> {
  return (await db.visits.toArray()).filter((visit) => visit.practitioner_id === practitionerId);
}

/** A booked slots visit on `date` at `time`, in slot order `position`, copied from a seeded visit. */
async function putSlotsVisit(practitionerId: string, id: string, date: ClinicDay, time: string, position: number) {
  const [template] = await db.visits.toArray();
  const location = (await schedulesOf(practitionerId))[0].location_id;
  const scheduledAt = cairoInstant(date, time);
  await db.visits.put({
    ...template,
    id,
    practitioner_id: practitionerId,
    location_id: location,
    visit_date: date,
    position,
    scheduled_at: scheduledAt,
    unique_scheduled_at: scheduledAt,
    is_overbooked: false,
  });
}

/** A queue visit on `date` at `position`, copied from a seeded visit. */
async function putQueueVisit(practitionerId: string, id: string, date: ClinicDay, position: number) {
  const [template] = await db.visits.toArray();
  const location = (await schedulesOf(practitionerId))[0].location_id;
  const visit: Visit = {
    ...template,
    id,
    practitioner_id: practitionerId,
    location_id: location,
    visit_date: date,
    position,
    scheduled_at: null,
    is_overbooked: false,
  };
  delete visit.unique_scheduled_at;
  await db.visits.put(visit);
}

describe("switchModeFromTomorrow", () => {
  it("writes next_mode and next_mode_from = tomorrow on every row, leaving today's mode and today's visits as they are", async () => {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const today = todayInCairo();
    const tomorrow = addDaysToClinicDay(today, 1);
    await putSlotsVisit(practitioner.id, "today-late", today, "10:00", 1);
    await putSlotsVisit(practitioner.id, "today-early", today, "09:00", 2);
    const before = await visitsOf(practitioner.id);
    const schedulesBefore = await schedulesOf(practitioner.id);
    const opsBefore = await db.sync_ops.count();

    const location = schedulesBefore[0].location_id;
    const result = await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId: location, newMode: ScheduleMode.Queue });
    expect(result).toEqual({ ok: true });

    const schedulesAfter = await schedulesOf(practitioner.id);
    expect(schedulesAfter).toHaveLength(7);
    for (const schedule of schedulesAfter) {
      expect(schedule).toMatchObject({ mode: ScheduleMode.Slots, next_mode: ScheduleMode.Queue, next_mode_from: tomorrow });
      expect(effectiveScheduleMode(schedule, today)).toBe(ScheduleMode.Slots);
      expect(effectiveScheduleMode(schedule, tomorrow)).toBe(ScheduleMode.Queue);
    }
    expect(modeFromTomorrow(schedulesAfter, today)).toBe(ScheduleMode.Queue);

    // No visit before tomorrow moved: today's two, and the seeded past day's.
    expect(await visitsOf(practitioner.id)).toEqual(before);

    // One audited, queued update per schedule row, and nothing else.
    const ops = (await db.sync_ops.toArray()).slice(opsBefore);
    expect(ops.map((op) => `${op.entity}:${op.action}`)).toEqual(Array(7).fill("schedules:update"));
  });

  it("converts the visits booked from tomorrow on, never one before, dropping or duplicating none", async () => {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const today = todayInCairo();
    const tomorrow = addDaysToClinicDay(today, 1);
    const sameWeekdayNextWeek = addDaysToClinicDay(today, 7);
    await putSlotsVisit(practitioner.id, "today", today, "09:30", 2);
    await putSlotsVisit(practitioner.id, "tomorrow-late", tomorrow, "10:00", 1);
    await putSlotsVisit(practitioner.id, "tomorrow-early", tomorrow, "09:00", 2);
    await putSlotsVisit(practitioner.id, "next-week", sameWeekdayNextWeek, "11:00", 1);
    const before = new Map((await visitsOf(practitioner.id)).map((visit) => [visit.id, visit]));

    const location = (await schedulesOf(practitioner.id))[0].location_id;
    await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId: location, newMode: ScheduleMode.Queue });

    const after = new Map((await visitsOf(practitioner.id)).map((visit) => [visit.id, visit]));
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

    for (const [id, visit] of after) {
      if (visit.visit_date < tomorrow) {
        expect(visit).toEqual(before.get(id));
      } else {
        expect(visit.scheduled_at).toBeNull();
        expect(visit.unique_scheduled_at).toBeUndefined();
      }
    }
    // Queue order follows the slot times: 09:00 first.
    expect(after.get("tomorrow-early")!.position).toBe(1);
    expect(after.get("tomorrow-late")!.position).toBe(2);
    expect(after.get("next-week")!.position).toBe(1);
    expect(after.get("today")).toEqual(before.get("today"));
  });

  it("switched back before tomorrow, clears both fields and puts tomorrow's visits back on their times", async () => {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const today = todayInCairo();
    const tomorrow = addDaysToClinicDay(today, 1);
    await putSlotsVisit(practitioner.id, "tomorrow-1", tomorrow, "09:00", 1);
    await putSlotsVisit(practitioner.id, "tomorrow-2", tomorrow, "09:30", 2);
    const before = await visitsOf(practitioner.id);
    const schedulesBefore = await schedulesOf(practitioner.id);
    const location = schedulesBefore[0].location_id;

    await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId: location, newMode: ScheduleMode.Queue });
    await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId: location, newMode: ScheduleMode.Slots });

    const byId = (rows: Schedule[]) => new Map(rows.map((row) => [row.id, { ...row, rev: 0 }]));
    const restored = await schedulesOf(practitioner.id);
    for (const schedule of restored) {
      expect(schedule.next_mode).toBeNull();
      expect(schedule.next_mode_from).toBeNull();
      expect(schedule.mode).toBe(ScheduleMode.Slots);
    }
    expect(byId(restored)).toEqual(byId(schedulesBefore.map((row) => ({ ...row, next_mode: null, next_mode_from: null }))));
    expect(modeFromTomorrow(restored, today)).toBe(ScheduleMode.Slots);

    const after = new Map((await visitsOf(practitioner.id)).map((visit) => [visit.id, visit]));
    for (const visit of before) {
      expect(after.get(visit.id)!.scheduled_at).toBe(visit.scheduled_at);
      expect(after.get(visit.id)!.unique_scheduled_at).toBe(visit.unique_scheduled_at);
    }
    expect(after.size).toBe(before.length);
  });

  it("switching to the mode already coming from tomorrow writes nothing", async () => {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const location = (await schedulesOf(practitioner.id))[0].location_id;
    const opsBefore = await db.sync_ops.count();

    expect(await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId: location, newMode: ScheduleMode.Slots })).toEqual({
      ok: true,
    });
    expect(await db.sync_ops.count()).toBe(opsBefore);
  });

  it("a queue doctor switched to slots gets the default slot length and tomorrow's queue placed on its slots", async () => {
    await seedDatabase(db, { includeQueueDemo: true });
    const practitioner = await findSeededQueuePractitioner(db);
    const today = todayInCairo();
    const tomorrow = addDaysToClinicDay(today, 1);
    await putQueueVisit(practitioner.id, "q-today", today, 1);
    await putQueueVisit(practitioner.id, "q-1", tomorrow, 1);
    await putQueueVisit(practitioner.id, "q-2", tomorrow, 2);
    const todayBefore = await db.visits.get("q-today");
    const schedules = await schedulesOf(practitioner.id);
    expect(schedules.every((schedule) => schedule.slot_minutes === null)).toBe(true);

    await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId: schedules[0].location_id, newMode: ScheduleMode.Slots });

    const after = await schedulesOf(practitioner.id);
    for (const schedule of after) {
      expect(schedule).toMatchObject({ mode: ScheduleMode.Queue, next_mode: ScheduleMode.Slots, next_mode_from: tomorrow, slot_minutes: 30 });
    }
    const start = after.find((schedule) => schedule.weekday === weekdayOf(tomorrow))!.start_time;
    expect((await db.visits.get("q-1"))!.scheduled_at).toBe(cairoInstant(tomorrow, start));
    expect((await db.visits.get("q-2"))!.scheduled_at).toBe(cairoInstant(tomorrow, addMinutesToClockTime(start, 30)));
    expect(await db.visits.get("q-today")).toEqual(todayBefore);
  });

  it("folds a row whose switch has already started before switching it again", async () => {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const today = todayInCairo();
    const yesterday = addDaysToClinicDay(today, -1);
    const schedules = await schedulesOf(practitioner.id);
    for (const schedule of schedules) {
      await db.schedules.put({ ...schedule, next_mode: ScheduleMode.Queue, next_mode_from: yesterday });
    }

    // Already queue from tomorrow: nothing to convert, but the row is folded.
    await switchModeFromTomorrow(db, { practitionerId: practitioner.id, locationId: schedules[0].location_id, newMode: ScheduleMode.Queue });
    for (const schedule of await schedulesOf(practitioner.id)) {
      expect(schedule).toMatchObject({ mode: ScheduleMode.Queue, next_mode: null, next_mode_from: null });
    }
  });
});

describe("updateWorkingHours and a doctor's switch", () => {
  it("folds a row whose switch has started on its next save, editing the capacity of today's queue", async () => {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const today = todayInCairo();
    const [schedule] = await schedulesOf(practitioner.id);
    await db.schedules.put({ ...schedule, next_mode: ScheduleMode.Queue, next_mode_from: today });

    const result = await updateWorkingHours(db, schedule.id, {
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      slotMinutes: null,
      maxCapacity: 15,
    });
    expect(result).toEqual({ ok: true });
    expect(await db.schedules.get(schedule.id)).toMatchObject({
      mode: ScheduleMode.Queue,
      next_mode: null,
      next_mode_from: null,
      max_capacity: 15,
      slot_minutes: schedule.slot_minutes,
    });
  });

  it("keeps a switch still to come on a save, editing today's slots", async () => {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const tomorrow = addDaysToClinicDay(todayInCairo(), 1);
    const [schedule] = await schedulesOf(practitioner.id);
    await db.schedules.put({ ...schedule, next_mode: ScheduleMode.Queue, next_mode_from: tomorrow });

    const result = await updateWorkingHours(db, schedule.id, {
      startTime: schedule.start_time,
      endTime: "13:00",
      slotMinutes: schedule.slot_minutes,
      maxCapacity: null,
    });
    expect(result).toEqual({ ok: true });
    expect(await db.schedules.get(schedule.id)).toMatchObject({
      mode: ScheduleMode.Slots,
      next_mode: ScheduleMode.Queue,
      next_mode_from: tomorrow,
      end_time: "13:00",
    });
  });
});
