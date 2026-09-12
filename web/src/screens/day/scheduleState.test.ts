import { describe, expect, it } from "vitest";
import type { Schedule } from "../../db/types";
import { ScheduleMode } from "../../domain/scheduleMode";
import { resolveDayScheduleState } from "./scheduleState";

const SCHEDULE: Schedule = {
  id: "schedule-1",
  practitioner_id: "practitioner-1",
  location_id: "location-1",
  weekday: 0,
  start_time: "09:00",
  end_time: "14:00",
  mode: ScheduleMode.Slots,
  slot_minutes: 30,
  max_capacity: null,
  resource_count: 1,
  rev: 1,
};

describe("resolveDayScheduleState", () => {
  it("case A: reports a day off when other schedule rows exist but none for today", () => {
    expect(resolveDayScheduleState(undefined, true)).toEqual({ kind: "day_off" });
  });

  it("case B: reports missing configuration when there is no schedule row at all", () => {
    expect(resolveDayScheduleState(undefined, false)).toEqual({ kind: "not_configured" });
  });

  it("reports today's schedule when one exists for today's weekday", () => {
    expect(resolveDayScheduleState(SCHEDULE, true)).toEqual({ kind: "scheduled", schedule: SCHEDULE });
  });
});
