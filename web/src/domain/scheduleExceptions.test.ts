import { describe, expect, it } from "vitest";
import { ScheduleExceptionType, type Schedule, type ScheduleException, type Visit } from "../db/types";
import { computeGridRows, closedDayRows } from "../screens/day/dayGrid";
import { computeEmptySlots } from "../screens/day/emptySlots";
import { computeMoveTargets } from "../screens/day/moveTargets";
import { closureOn, isClosureReasonTooLong, isOutsideWorkingHours, normalizeClosureReason, scheduleOnDate } from "./scheduleExceptions";
import { ScheduleMode } from "./scheduleMode";
import { cairoInstant, type ClinicDay } from "./time";
import { VisitSource } from "./visitSource";
import { VisitStatus } from "./visitStatus";

// 2026-11-23 is a Monday (weekday 1); the doctor works Mondays 09:00–12:00
// in 30-minute slots and Tuesdays, nothing else.
const MONDAY = "2026-11-23" as ClinicDay;
const NEXT_MONDAY = "2026-11-30" as ClinicDay;
const WEDNESDAY = "2026-11-25" as ClinicDay;

function row(weekday: number, start: string, end: string): Schedule {
  return {
    id: `schedule-${weekday}`,
    practitioner_id: "dr",
    location_id: "loc",
    weekday,
    start_time: start,
    end_time: end,
    mode: ScheduleMode.Slots,
    slot_minutes: 30,
    max_capacity: null,
    resource_count: 1,
    rev: 1,
  } as Schedule;
}

const ROWS = [row(1, "09:00", "12:00"), row(2, "16:00", "18:00")];

function exception(date: ClinicDay, type: ScheduleException["type"], start: string | null = null, end: string | null = null, practitionerId = "dr"): ScheduleException {
  return { id: `exception-${date}-${practitionerId}`, practitioner_id: practitionerId, date, type, start_time: start, end_time: end, shift_minutes: null, rev: 1 } as ScheduleException;
}

function visit(id: string, date: ClinicDay, time: string, status: VisitStatus = VisitStatus.Booked): Visit {
  return {
    id,
    org_id: "org",
    location_id: "loc",
    practitioner_id: "dr",
    patient_id: "p",
    service_id: null,
    care_plan_item_id: null,
    visit_date: date,
    position: 1,
    scheduled_at: cairoInstant(date, time),
    unique_scheduled_at: cairoInstant(date, time),
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "m",
    created_at: "2026-11-20T08:00:00.000Z",
    note: null,
    rev: 1,
  } as Visit;
}

describe("scheduleOnDate", () => {
  it("is the weekday's row on a date with no exception", () => {
    expect(scheduleOnDate(ROWS, [], "dr", MONDAY)).toEqual(ROWS[0]);
    expect(scheduleOnDate(ROWS, [], "dr", WEDNESDAY)).toBeUndefined();
  });

  it("is nothing on a closed date, and only on that date", () => {
    const closed = [exception(MONDAY, ScheduleExceptionType.Closed)];
    expect(scheduleOnDate(ROWS, closed, "dr", MONDAY)).toBeUndefined();
    expect(scheduleOnDate(ROWS, closed, "dr", NEXT_MONDAY)).toEqual(ROWS[0]);
  });

  it("takes the date's own hours, keeping the weekday's mode and slot length", () => {
    const hours = [exception(MONDAY, ScheduleExceptionType.Shifted, "10:00", "11:00")];
    expect(scheduleOnDate(ROWS, hours, "dr", MONDAY)).toEqual({ ...ROWS[0], start_time: "10:00", end_time: "11:00" });
  });

  it("opens a usual day off with the date's own hours, on the doctor's first row's mode and slot length", () => {
    const hours = [exception(WEDNESDAY, ScheduleExceptionType.Shifted, "13:00", "14:00")];
    expect(scheduleOnDate(ROWS, hours, "dr", WEDNESDAY)).toEqual({ ...ROWS[0], weekday: 3, start_time: "13:00", end_time: "14:00" });
  });

  it("ignores another doctor's exception", () => {
    expect(scheduleOnDate(ROWS, [exception(MONDAY, ScheduleExceptionType.Closed, null, null, "other")], "dr", MONDAY)).toEqual(ROWS[0]);
  });
});

describe("availability with a closure or new hours", () => {
  it("a closed date offers no slot to book and no slot to move to", () => {
    const closed = [exception(MONDAY, ScheduleExceptionType.Closed)];
    const targets = computeMoveTargets(MONDAY, (_weekday, date) => scheduleOnDate(ROWS, closed, "dr", date), () => []);
    expect(targets.map((group) => group.date)).not.toContain(MONDAY);
    expect(targets.map((group) => group.date)).toContain(NEXT_MONDAY);
  });

  it("a date with its own hours offers only the slots inside them", () => {
    const schedule = scheduleOnDate(ROWS, [exception(MONDAY, ScheduleExceptionType.Shifted, "10:00", "11:00")], "dr", MONDAY)!;
    expect(computeEmptySlots(schedule, []).map((slot) => slot.time)).toEqual(["10:00", "10:30"]);
    expect(computeEmptySlots(schedule, [visit("v", MONDAY, "10:00")]).map((slot) => slot.time)).toEqual(["10:30"]);
  });
});

describe("visits left outside working hours", () => {
  it("are the still-active ones outside the day's interval, or on a closed date", () => {
    const schedule = { ...ROWS[0], start_time: "10:00", end_time: "11:00" };
    expect(isOutsideWorkingHours(visit("early", MONDAY, "09:00"), schedule)).toBe(true);
    expect(isOutsideWorkingHours(visit("inside", MONDAY, "10:30"), schedule)).toBe(false);
    expect(isOutsideWorkingHours(visit("end", MONDAY, "11:00"), schedule)).toBe(true);
    expect(isOutsideWorkingHours(visit("done", MONDAY, "09:00", VisitStatus.Completed), schedule)).toBe(false);
    expect(isOutsideWorkingHours(visit("cancelled", MONDAY, "09:00", VisitStatus.Cancelled), undefined)).toBe(false);
    expect(isOutsideWorkingHours(visit("closed", MONDAY, "09:00"), undefined)).toBe(true);
  });

  it("keep a row of their own, in time order, on a day with new hours", () => {
    const schedule = { ...ROWS[0], start_time: "10:00", end_time: "11:00" };
    const rows = computeGridRows(schedule, [visit("early", MONDAY, "09:00"), visit("inside", MONDAY, "10:30"), visit("late", MONDAY, "11:30")]);
    expect(rows.map((gridRow) => [gridRow.time, gridRow.visit?.id ?? null, gridRow.isOutsideHours ?? false])).toEqual([
      ["09:00", "early", true],
      ["10:00", null, false],
      ["10:30", "inside", false],
      ["11:30", "late", true],
    ]);
  });

  it("are every row of a closed date, the finished and cancelled ones left out", () => {
    const rows = closedDayRows([
      visit("late", MONDAY, "11:00"),
      visit("early", MONDAY, "09:00", VisitStatus.Arrived),
      visit("gone", MONDAY, "10:00", VisitStatus.Cancelled),
    ]);
    expect(rows.map((gridRow) => [gridRow.time, gridRow.visit?.id, gridRow.isOutsideHours])).toEqual([
      ["09:00", "early", true],
      ["11:00", "late", true],
    ]);
  });
});

describe("a closure's reason", () => {
  const closed: ScheduleException = {
    id: "closed",
    practitioner_id: "dr",
    date: MONDAY,
    type: ScheduleExceptionType.Closed,
    start_time: null,
    end_time: null,
    shift_minutes: null,
    reason: "سفر",
    rev: 1,
  };
  const hours: ScheduleException = { ...closed, id: "hours", date: WEDNESDAY, type: ScheduleExceptionType.Shifted, start_time: "10:00", end_time: "11:00", reason: null };

  it("is trimmed, and nothing left reads as none", () => {
    expect(normalizeClosureReason("  سفر  ")).toBe("سفر");
    expect(normalizeClosureReason("   ")).toBeNull();
    expect(normalizeClosureReason("")).toBeNull();
    expect(normalizeClosureReason(null)).toBeNull();
    expect(normalizeClosureReason(undefined)).toBeNull();
  });

  it("is too long past 200 characters, counted as characters, not UTF-16 units", () => {
    expect(isClosureReasonTooLong("س".repeat(200))).toBe(false);
    expect(isClosureReasonTooLong("س".repeat(201))).toBe(true);
    expect(isClosureReasonTooLong("🙂".repeat(200))).toBe(false);
  });

  it("belongs to the doctor's closure on the date, never to a date's own hours or another doctor", () => {
    expect(closureOn([closed, hours], "dr", MONDAY)?.reason).toBe("سفر");
    expect(closureOn([closed, hours], "dr", WEDNESDAY)).toBeUndefined();
    expect(closureOn([closed, hours], "other", MONDAY)).toBeUndefined();
    expect(closureOn([closed, hours], "dr", NEXT_MONDAY)).toBeUndefined();
  });
});
