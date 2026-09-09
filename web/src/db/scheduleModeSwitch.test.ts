import { beforeEach, describe, expect, it } from "vitest";
import { ScheduleMode } from "../domain/scheduleMode";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import { switchScheduleMode } from "./scheduleModeSwitch";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-schedule-mode-switch-test-${crypto.randomUUID()}`);
});

const SEEDED_WEEKDAY = 1; // Monday — see seed.ts's SEEDED_VISITS_WEEKDAY.

// visits and schedules both only index practitioner_id as part of a
// compound key, not on its own — a plain scan-and-filter, matching how
// scheduleModeSwitch.ts itself has to read these small tables.
async function visitsForPractitioner(practitionerId: string) {
  return (await db.visits.toArray()).filter((visit) => visit.practitioner_id === practitionerId);
}

async function scheduleFor(practitionerId: string, weekday: number) {
  return (await db.schedules.toArray()).find(
    (schedule) => schedule.practitioner_id === practitionerId && schedule.weekday === weekday,
  );
}

describe("switchScheduleMode", () => {
  it("slots -> queue: assigns positions by scheduled_at order and clears scheduled_at, dropping no visit", async () => {
    await seedDatabase(db);
    const [practitioner] = await db.practitioners.toArray();
    const before = await visitsForPractitioner(practitioner.id);
    const idsBefore = before.map((v) => v.id).sort();

    const result = await switchScheduleMode(db, practitioner.id, SEEDED_WEEKDAY, ScheduleMode.Queue);
    expect(result).toEqual({ ok: true });

    const after = await visitsForPractitioner(practitioner.id);
    expect(after.map((v) => v.id).sort()).toEqual(idsBefore);
    for (const visit of after) {
      expect(visit.scheduled_at).toBeNull();
      expect(visit.unique_scheduled_at).toBeUndefined();
    }

    // The seed's original positions already matched scheduled_at order, so
    // the queue positions should come out the same.
    const beforeById = new Map(before.map((v) => [v.id, v.position]));
    for (const visit of after) {
      expect(visit.position).toBe(beforeById.get(visit.id));
    }

    const schedule = await scheduleFor(practitioner.id, SEEDED_WEEKDAY);
    expect(schedule?.mode).toBe(ScheduleMode.Queue);
  });

  it("queue -> slots: assigns scheduled_at from start_time + position * slot_minutes", async () => {
    await seedDatabase(db);
    const [practitioner] = await db.practitioners.toArray();
    await switchScheduleMode(db, practitioner.id, SEEDED_WEEKDAY, ScheduleMode.Queue);

    const result = await switchScheduleMode(db, practitioner.id, SEEDED_WEEKDAY, ScheduleMode.Slots);
    expect(result).toEqual({ ok: true });

    const after = await visitsForPractitioner(practitioner.id);
    for (const visit of after) {
      expect(visit.scheduled_at).not.toBeNull();
      expect(visit.unique_scheduled_at).toBe(visit.scheduled_at);
    }

    const schedule = await scheduleFor(practitioner.id, SEEDED_WEEKDAY);
    expect(schedule?.mode).toBe(ScheduleMode.Slots);
  });

  it("round trip (slots -> queue -> slots) preserves the exact set of visit ids and the total count", async () => {
    await seedDatabase(db);
    const [practitioner] = await db.practitioners.toArray();
    const before = await visitsForPractitioner(practitioner.id);
    const idsBefore = before.map((v) => v.id).sort();

    await switchScheduleMode(db, practitioner.id, SEEDED_WEEKDAY, ScheduleMode.Queue);
    const afterToQueue = await visitsForPractitioner(practitioner.id);
    expect(afterToQueue).toHaveLength(before.length);
    expect(afterToQueue.map((v) => v.id).sort()).toEqual(idsBefore);

    await switchScheduleMode(db, practitioner.id, SEEDED_WEEKDAY, ScheduleMode.Slots);
    const afterBackToSlots = await visitsForPractitioner(practitioner.id);
    expect(afterBackToSlots).toHaveLength(before.length);
    expect(afterBackToSlots.map((v) => v.id).sort()).toEqual(idsBefore);
  });

  it("refuses queue -> slots when the schedule has no slot_minutes, writing nothing", async () => {
    await seedDatabase(db);
    const [practitioner] = await db.practitioners.toArray();
    await switchScheduleMode(db, practitioner.id, SEEDED_WEEKDAY, ScheduleMode.Queue);
    const schedule = (await scheduleFor(practitioner.id, SEEDED_WEEKDAY))!;
    await db.schedules.update(schedule.id, { slot_minutes: null });

    const before = await visitsForPractitioner(practitioner.id);

    const result = await switchScheduleMode(db, practitioner.id, SEEDED_WEEKDAY, ScheduleMode.Slots);
    expect(result).toEqual({ ok: false, reason: "slot_minutes_required" });

    const after = await visitsForPractitioner(practitioner.id);
    expect(after).toEqual(before);
    const unchangedSchedule = await db.schedules.get(schedule.id);
    expect(unchangedSchedule?.mode).toBe(ScheduleMode.Queue);
  });

  it("reports schedule_not_found for a practitioner or weekday with no schedule row", async () => {
    await seedDatabase(db);
    const [practitioner] = await db.practitioners.toArray();
    const result = await switchScheduleMode(db, practitioner.id, 99, ScheduleMode.Queue);
    expect(result).toEqual({ ok: false, reason: "schedule_not_found" });
  });

  it("is a no-op when the schedule is already in the requested mode", async () => {
    await seedDatabase(db);
    const [practitioner] = await db.practitioners.toArray();
    const result = await switchScheduleMode(db, practitioner.id, SEEDED_WEEKDAY, ScheduleMode.Slots);
    expect(result).toEqual({ ok: true });
  });
});
