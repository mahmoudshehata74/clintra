import { describe, expect, it } from "vitest";
import type { Schedule } from "../../db/types";
import { ScheduleMode } from "../../domain/scheduleMode";
import { buildWorkingHoursRows, formatWorkingHoursMode, workingHoursErrorField } from "./workingHoursRows";

function schedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: "s-1",
    practitioner_id: "p-1",
    location_id: "l-1",
    weekday: 0,
    start_time: "09:00",
    end_time: "14:00",
    mode: ScheduleMode.Slots,
    slot_minutes: 30,
    max_capacity: null,
    resource_count: 1,
    rev: 1,
    ...overrides,
  };
}

const STRINGS = { slots: "مواعيد", queue: "طابور", dayOff: "إجازة", minutesUnit: "د", patientsUnit: "مريض" };

describe("buildWorkingHoursRows", () => {
  it("lists all seven weekdays in order, a day with no schedule as a day off", () => {
    const rows = buildWorkingHoursRows([
      schedule({ id: "mon", weekday: 1 }),
      schedule({ id: "thu", weekday: 4, mode: ScheduleMode.Queue, slot_minutes: null, max_capacity: 20, start_time: "17:00", end_time: "21:00" }),
    ]);
    expect(rows.map((row) => row.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows[0]).toEqual({ key: "off-0", weekday: 0, schedule: undefined, hours: "—", mode: { kind: "day_off" } });
    expect(rows[1]).toMatchObject({ key: "mon", hours: "09:00 — 14:00", mode: { kind: "slots", slotMinutes: 30 } });
    expect(rows[4]).toMatchObject({ key: "thu", hours: "17:00 — 21:00", mode: { kind: "queue", maxCapacity: 20 } });
  });

  it("gives a split day one row per schedule, earliest first", () => {
    const rows = buildWorkingHoursRows([
      schedule({ id: "late", weekday: 2, start_time: "17:00", end_time: "20:00" }),
      schedule({ id: "early", weekday: 2, start_time: "09:00", end_time: "12:00" }),
    ]);
    expect(rows.filter((row) => row.weekday === 2).map((row) => row.key)).toEqual(["early", "late"]);
    expect(rows).toHaveLength(8);
  });
});

describe("formatWorkingHoursMode", () => {
  it("formats slots, queue and day off per the prototype", () => {
    expect(formatWorkingHoursMode({ kind: "slots", slotMinutes: 30 }, STRINGS)).toBe("مواعيد 30د");
    expect(formatWorkingHoursMode({ kind: "queue", maxCapacity: 20 }, STRINGS)).toBe("طابور · 20 مريض");
    expect(formatWorkingHoursMode({ kind: "day_off" }, STRINGS)).toBe("إجازة");
  });

  it("drops the number when none is set", () => {
    expect(formatWorkingHoursMode({ kind: "slots", slotMinutes: null }, STRINGS)).toBe("مواعيد");
    expect(formatWorkingHoursMode({ kind: "queue", maxCapacity: null }, STRINGS)).toBe("طابور");
  });
});

describe("workingHoursErrorField", () => {
  it("puts each refusal under the field it is about", () => {
    expect(workingHoursErrorField("end_before_start")).toBe("end");
    expect(workingHoursErrorField("invalid_capacity")).toBe("capacity");
    expect(workingHoursErrorField("invalid_slot_minutes")).toBe("slotMinutes");
    expect(workingHoursErrorField("visits_on_old_grid")).toBe("slotMinutes");
    expect(workingHoursErrorField("schedule_not_found")).toBe("slotMinutes");
  });
});
