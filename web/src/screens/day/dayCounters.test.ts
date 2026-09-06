import { describe, expect, it } from "vitest";
import { VisitStatus } from "../../domain/visitStatus";
import { VisitSource } from "../../domain/visitSource";
import type { Visit } from "../../db/types";
import { computeDayCounters } from "./dayCounters";

function makeVisit(status: Visit["status"], position: number): Visit {
  return {
    id: `visit-${position}`,
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: `patient-${position}`,
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-06",
    position,
    scheduled_at: null,
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: "2026-09-06T06:00:00.000Z",
  };
}

describe("computeDayCounters", () => {
  it("counts an empty day as all zero", () => {
    expect(computeDayCounters([])).toEqual({ total: 0, arrived: 0, completed: 0, remaining: 0 });
  });

  it("counts total as every visit regardless of status", () => {
    const visits = [
      makeVisit(VisitStatus.Booked, 1),
      makeVisit(VisitStatus.Cancelled, 2),
      makeVisit(VisitStatus.NoShow, 3),
    ];
    expect(computeDayCounters(visits).total).toBe(3);
  });

  it("counts arrived, in_room and completed visits as arrived", () => {
    const visits = [
      makeVisit(VisitStatus.Booked, 1),
      makeVisit(VisitStatus.Confirmed, 2),
      makeVisit(VisitStatus.Arrived, 3),
      makeVisit(VisitStatus.InRoom, 4),
      makeVisit(VisitStatus.Completed, 5),
    ];
    expect(computeDayCounters(visits).arrived).toBe(3);
  });

  it("counts only completed visits as completed", () => {
    const visits = [
      makeVisit(VisitStatus.InRoom, 1),
      makeVisit(VisitStatus.Completed, 2),
      makeVisit(VisitStatus.Completed, 3),
    ];
    expect(computeDayCounters(visits).completed).toBe(2);
  });

  it("excludes completed, cancelled, no_show and rescheduled from remaining", () => {
    const visits = [
      makeVisit(VisitStatus.Booked, 1),
      makeVisit(VisitStatus.Confirmed, 2),
      makeVisit(VisitStatus.Arrived, 3),
      makeVisit(VisitStatus.InRoom, 4),
      makeVisit(VisitStatus.Completed, 5),
      makeVisit(VisitStatus.Cancelled, 6),
      makeVisit(VisitStatus.NoShow, 7),
      makeVisit(VisitStatus.Rescheduled, 8),
    ];
    expect(computeDayCounters(visits).remaining).toBe(4);
  });

  it("matches the seeded five-visit day", () => {
    const visits = [
      makeVisit(VisitStatus.Booked, 1),
      makeVisit(VisitStatus.Arrived, 2),
      makeVisit(VisitStatus.Completed, 3),
      makeVisit(VisitStatus.NoShow, 4),
      makeVisit(VisitStatus.Cancelled, 5),
    ];
    expect(computeDayCounters(visits)).toEqual({
      total: 5,
      arrived: 2,
      completed: 1,
      remaining: 2,
    });
  });
});
