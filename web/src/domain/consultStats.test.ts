import { describe, expect, it } from "vitest";
import { computeMedianConsultMinutes, countCompletedConsultations } from "./consultStats";
import { VisitSource } from "./visitSource";
import { VisitStatus } from "./visitStatus";
import type { Visit } from "../db/types";

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: "visit-1",
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-07",
    position: 1,
    scheduled_at: null,
    status: VisitStatus.Completed,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: "2026-09-07T06:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

function completedVisit(startMinute: number, durationMinutes: number): Visit {
  const start = new Date(2026, 8, 7, 9, startMinute).toISOString();
  const end = new Date(2026, 8, 7, 9, startMinute + durationMinutes).toISOString();
  return makeVisit({ id: `visit-${startMinute}`, started_at: start, ended_at: end });
}

describe("computeMedianConsultMinutes", () => {
  it("returns null when there are no completed visits with recorded durations", () => {
    expect(computeMedianConsultMinutes([])).toBeNull();
    expect(computeMedianConsultMinutes([makeVisit({ status: VisitStatus.Booked })])).toBeNull();
  });

  it("returns the single value for exactly one completed visit", () => {
    expect(computeMedianConsultMinutes([completedVisit(0, 10)])).toBe(10);
  });

  it("returns the middle value for an odd count", () => {
    const visits = [completedVisit(0, 10), completedVisit(20, 20), completedVisit(40, 12)];
    expect(computeMedianConsultMinutes(visits)).toBe(12);
  });

  it("averages the two middle values for an even count", () => {
    const visits = [completedVisit(0, 10), completedVisit(20, 12)];
    expect(computeMedianConsultMinutes(visits)).toBe(11);
  });

  it("is not skewed by one very long outlier, unlike a mean would be", () => {
    const visits = [completedVisit(0, 10), completedVisit(20, 12), completedVisit(40, 200)];
    expect(computeMedianConsultMinutes(visits)).toBe(12);
  });

  it("ignores visits that are not completed, or missing a timestamp", () => {
    const visits = [
      completedVisit(0, 10),
      makeVisit({ id: "in-room", status: VisitStatus.InRoom, started_at: new Date().toISOString(), ended_at: null }),
      makeVisit({ id: "no-times", status: VisitStatus.Completed, started_at: null, ended_at: null }),
    ];
    expect(computeMedianConsultMinutes(visits)).toBe(10);
  });
});

describe("countCompletedConsultations", () => {
  it("counts only completed visits with both timestamps", () => {
    const visits = [
      completedVisit(0, 10),
      completedVisit(20, 12),
      makeVisit({ id: "booked", status: VisitStatus.Booked }),
    ];
    expect(countCompletedConsultations(visits)).toBe(2);
  });
});
