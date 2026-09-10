import { beforeEach, describe, expect, it } from "vitest";
import { generateSlotTimes } from "../domain/schedule";
import { weekdayOf } from "../domain/time";
import { ClintraDatabase } from "./database";
import { updateWorkingHours } from "./scheduleSettings";
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
