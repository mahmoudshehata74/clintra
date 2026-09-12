import { describe, expect, it } from "vitest";
import { ScheduleMode } from "../../domain/scheduleMode";
import { cairoInstant } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import type { Schedule, Visit } from "../../db/types";
import { computeMoveTargets } from "./moveTargets";

const START_DATE = "2026-09-07"; // Monday

function scheduleFor(weekday: number): Schedule {
  return {
    id: `schedule-${weekday}`,
    practitioner_id: "practitioner-1",
    location_id: "location-1",
    weekday,
    start_time: "09:00",
    end_time: "10:00",
    mode: ScheduleMode.Slots,
    slot_minutes: 30,
    max_capacity: null,
    resource_count: 1,
    rev: 1,
  };
}

function bookedVisit(date: string, time: string): Visit {
  return {
    id: `visit-${date}-${time}`,
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: date,
    position: 1,
    scheduled_at: cairoInstant(date, time),
    status: VisitStatus.Booked,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: new Date().toISOString(),
    rev: 1,
  };
}

describe("computeMoveTargets", () => {
  it("covers today and the next 7 days", () => {
    const groups = computeMoveTargets(
      START_DATE,
      () => scheduleFor(1), // pretend every weekday uses the Monday schedule, for a simple full-coverage check
      () => [],
    );
    // Every one of the 8 days has slots since nothing is booked.
    expect(groups).toHaveLength(8);
    expect(groups[0].date).toBe("2026-09-07");
    expect(groups[7].date).toBe("2026-09-14");
  });

  it("omits a day with no schedule at all", () => {
    // The 8-day window (today + 7) starting on a Monday contains two
    // Mondays: today itself and the same weekday next week.
    const groups = computeMoveTargets(
      START_DATE,
      (weekday) => (weekday === 1 ? scheduleFor(1) : undefined), // only Monday has a schedule
      () => [],
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.date)).toEqual(["2026-09-07", "2026-09-14"]);
    expect(groups.every((g) => g.weekday === 1)).toBe(true);
  });

  it("omits a day whose schedule is fully booked", () => {
    const groups = computeMoveTargets(
      START_DATE,
      (weekday) => (weekday === 1 ? scheduleFor(1) : undefined),
      (date) => [bookedVisit(date, "09:00"), bookedVisit(date, "09:30")],
    );
    expect(groups).toHaveLength(0);
  });

  it("carries only the empty slots for each included day", () => {
    const groups = computeMoveTargets(
      START_DATE,
      (weekday) => (weekday === 1 ? scheduleFor(1) : undefined),
      (date) => (date === START_DATE ? [bookedVisit(date, "09:00")] : [bookedVisit(date, "09:00"), bookedVisit(date, "09:30")]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe(START_DATE);
    expect(groups[0].slots.map((s) => s.time)).toEqual(["09:30"]);
  });

  it("never offers a normally-occupied time as a move target, even alongside an overbooked visit at the same time", () => {
    const normal = bookedVisit(START_DATE, "09:00");
    const overbooked: Visit = { ...bookedVisit(START_DATE, "09:00"), id: "visit-overbook", position: 6, is_overbooked: true };

    const groups = computeMoveTargets(
      START_DATE,
      (weekday) => (weekday === 1 ? scheduleFor(1) : undefined),
      (date) => (date === START_DATE ? [normal, overbooked] : []),
    );

    const startGroup = groups.find((g) => g.date === START_DATE);
    // 09:00 is occupied (by two visits, even); only 09:30 is offered.
    expect(startGroup?.slots.map((s) => s.time)).toEqual(["09:30"]);
  });
});
