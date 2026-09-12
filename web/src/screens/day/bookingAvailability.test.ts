import { describe, expect, it } from "vitest";
import { ScheduleMode } from "../../domain/scheduleMode";
import type { Schedule } from "../../db/types";
import {
  computeBookableSlots,
  findNextSlotAtOrAfter,
  resolveBookingScheduleNote,
} from "./bookingAvailability";
import { dayScreenStrings } from "./strings";

const SCHEDULE: Schedule = {
  id: "schedule-1",
  practitioner_id: "practitioner-1",
  location_id: "location-1",
  weekday: 1,
  start_time: "09:00",
  end_time: "10:00",
  mode: ScheduleMode.Slots,
  slot_minutes: 30,
  max_capacity: null,
  resource_count: 1,
  rev: 1,
};

describe("resolveBookingScheduleNote", () => {
  it("explains a day off (Case A) with the same wording the day grid uses", () => {
    expect(resolveBookingScheduleNote({ kind: "day_off" })).toBe(dayScreenStrings.noScheduleToday);
  });

  it("explains a never-configured schedule (Case B) with the same wording the day grid uses", () => {
    expect(resolveBookingScheduleNote({ kind: "not_configured" })).toBe(
      dayScreenStrings.scheduleNotConfigured,
    );
  });

  it("has nothing to explain once a schedule exists", () => {
    expect(resolveBookingScheduleNote({ kind: "scheduled", schedule: SCHEDULE })).toBeNull();
  });
});

describe("computeBookableSlots", () => {
  it("offers no slots on a day off (Case A)", () => {
    expect(computeBookableSlots({ kind: "day_off" }, [])).toEqual([]);
  });

  it("offers no slots when the schedule was never configured (Case B)", () => {
    expect(computeBookableSlots({ kind: "not_configured" }, [])).toEqual([]);
  });

  it("offers the schedule's empty slots once one exists", () => {
    const slots = computeBookableSlots({ kind: "scheduled", schedule: SCHEDULE }, []);
    expect(slots.map((s) => s.time)).toEqual(["09:00", "09:30"]);
  });
});

describe("findNextSlotAtOrAfter", () => {
  const slots = [
    { time: "09:00", existingVisit: null },
    { time: "09:30", existingVisit: null },
    { time: "10:00", existingVisit: null },
  ];

  it("returns the earliest slot at or after the given time", () => {
    expect(findNextSlotAtOrAfter(slots, "09:15")).toBe("09:30");
  });

  it("returns the exact slot when the given time matches one", () => {
    expect(findNextSlotAtOrAfter(slots, "09:30")).toBe("09:30");
  });

  it("returns null once every slot has already passed", () => {
    expect(findNextSlotAtOrAfter(slots, "10:30")).toBeNull();
  });
});
