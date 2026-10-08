import { describe, expect, it } from "vitest";
import type { Schedule, Visit } from "../../db/types";
import { ScheduleMode } from "../../domain/scheduleMode";
import { cairoInstant } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import { computePastDueVisits, pastDueVisitWhenLabel } from "./pastDueVisits";

const TODAY = "2026-09-07"; // Monday
const WEEKDAY = 1;

function slotVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: "visit-1",
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: TODAY,
    position: 1,
    scheduled_at: cairoInstant(TODAY, "09:00"),
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
    ...overrides,
  };
}

function queueVisit(overrides: Partial<Visit> = {}): Visit {
  return slotVisit({ scheduled_at: null, position: 1, ...overrides });
}

function scheduleFor(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "schedule-1",
    practitioner_id: "practitioner-1",
    location_id: "location-1",
    weekday: WEEKDAY,
    start_time: "09:00",
    end_time: "13:00",
    mode: ScheduleMode.Queue,
    slot_minutes: null,
    max_capacity: 20,
    resource_count: 1,
    rev: 1,
    ...overrides,
  };
}

describe("computePastDueVisits", () => {
  it("flags a booked slot visit whose scheduled time has passed today", () => {
    const visit = slotVisit({ scheduled_at: cairoInstant(TODAY, "09:00") });
    const now = new Date(cairoInstant(TODAY, "09:30"));
    expect(computePastDueVisits([visit], [], TODAY, now)).toEqual([visit]);
  });

  it("does not flag a slot visit whose scheduled time has not arrived yet", () => {
    const visit = slotVisit({ scheduled_at: cairoInstant(TODAY, "10:00") });
    const now = new Date(cairoInstant(TODAY, "09:30"));
    expect(computePastDueVisits([visit], [], TODAY, now)).toEqual([]);
  });

  it("flags a confirmed slot visit the same as booked", () => {
    const visit = slotVisit({ status: VisitStatus.Confirmed, scheduled_at: cairoInstant(TODAY, "09:00") });
    const now = new Date(cairoInstant(TODAY, "09:30"));
    expect(computePastDueVisits([visit], [], TODAY, now)).toEqual([visit]);
  });

  it("never flags any other status", () => {
    const now = new Date(cairoInstant(TODAY, "23:00"));
    for (const status of [VisitStatus.Arrived, VisitStatus.InRoom, VisitStatus.Completed, VisitStatus.Cancelled, VisitStatus.NoShow]) {
      const visit = slotVisit({ status, scheduled_at: cairoInstant(TODAY, "09:00") });
      expect(computePastDueVisits([visit], [], TODAY, now)).toEqual([]);
    }
  });

  it("flags a queue visit once the practitioner's schedule end for that day has passed", () => {
    const visit = queueVisit();
    const schedule = scheduleFor({ end_time: "13:00" });
    const beforeEnd = new Date(cairoInstant(TODAY, "12:00"));
    const afterEnd = new Date(cairoInstant(TODAY, "13:30"));
    expect(computePastDueVisits([visit], [schedule], TODAY, beforeEnd)).toEqual([]);
    expect(computePastDueVisits([visit], [schedule], TODAY, afterEnd)).toEqual([visit]);
  });

  it("never flags a queue visit with no matching schedule", () => {
    const visit = queueVisit();
    const now = new Date(cairoInstant(TODAY, "23:00"));
    expect(computePastDueVisits([visit], [], TODAY, now)).toEqual([]);
  });

  it("flags every eligible visit when the displayed day is in the past, regardless of time", () => {
    const pastDay = "2026-09-01";
    const slot = slotVisit({ visit_date: pastDay, scheduled_at: cairoInstant(pastDay, "23:00") });
    const queue = queueVisit({ visit_date: pastDay });
    const now = new Date(cairoInstant(TODAY, "00:01"));
    expect(computePastDueVisits([slot, queue], [], pastDay, now)).toEqual([slot, queue]);
  });

  it("never flags any visit when the displayed day is in the future", () => {
    const futureDay = "2026-09-14";
    // A schedule end time earlier in the clock than "now" would normally
    // flag a queue visit — proving the future-day check wins regardless.
    const slot = slotVisit({ visit_date: futureDay, scheduled_at: cairoInstant(futureDay, "00:01") });
    const queue = queueVisit({ visit_date: futureDay });
    const now = new Date(cairoInstant(TODAY, "23:59"));
    expect(computePastDueVisits([slot, queue], [scheduleFor({ end_time: "00:00" })], futureDay, now)).toEqual([]);
  });
});

describe("pastDueVisitWhenLabel", () => {
  it("shows a slot visit's own Cairo clock time", () => {
    expect(pastDueVisitWhenLabel(slotVisit({ scheduled_at: cairoInstant(TODAY, "09:30") }), "نمرة")).toBe("09:30");
  });

  it("shows a queue visit as its number behind the given prefix", () => {
    expect(pastDueVisitWhenLabel(queueVisit({ position: 3 }), "نمرة")).toBe("نمرة 3");
  });
});
