import { describe, expect, it } from "vitest";
import type { Visit } from "../../db/types";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import { computeExpectedWaitMinutes, computeQueueSummary } from "./queueSummary";

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: `visit-${overrides.position ?? 1}`,
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-07",
    position: 1,
    scheduled_at: null,
    status: VisitStatus.Booked,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: "2026-09-07T06:00:00.000Z",
    ...overrides,
  };
}

describe("computeQueueSummary", () => {
  it("uses the in_room visit's position as the current turn, and counts booked/arrived as waiting", () => {
    const visits = [
      makeVisit({ position: 1, status: VisitStatus.Completed }),
      makeVisit({ position: 2, status: VisitStatus.Completed }),
      makeVisit({ position: 3, status: VisitStatus.InRoom }),
      makeVisit({ position: 4, status: VisitStatus.Arrived }),
      makeVisit({ position: 5, status: VisitStatus.Booked }),
      makeVisit({ position: 6, status: VisitStatus.NoShow }),
    ];

    const summary = computeQueueSummary(visits);
    expect(summary.currentTurnPosition).toBe(3);
    expect(summary.waitingCount).toBe(2);
    expect(summary.nextVisitId).toBe("visit-4");
  });

  it("falls back to the earliest waiting visit when no one is in_room", () => {
    const visits = [
      makeVisit({ position: 1, status: VisitStatus.Completed }),
      makeVisit({ position: 2, status: VisitStatus.Booked }),
      makeVisit({ position: 3, status: VisitStatus.Arrived }),
    ];

    const summary = computeQueueSummary(visits);
    expect(summary.currentTurnPosition).toBe(2);
    expect(summary.waitingCount).toBe(2);
    expect(summary.nextVisitId).toBe("visit-2");
  });

  it("reports null current turn and zero waiting when the queue has neither", () => {
    const visits = [
      makeVisit({ position: 1, status: VisitStatus.Completed }),
      makeVisit({ position: 2, status: VisitStatus.Cancelled }),
    ];

    const summary = computeQueueSummary(visits);
    expect(summary.currentTurnPosition).toBeNull();
    expect(summary.waitingCount).toBe(0);
    expect(summary.nextVisitId).toBeNull();
  });

  it("does not count cancelled or no_show visits as waiting", () => {
    const visits = [
      makeVisit({ position: 1, status: VisitStatus.Cancelled }),
      makeVisit({ position: 2, status: VisitStatus.NoShow }),
      makeVisit({ position: 3, status: VisitStatus.Booked }),
    ];

    expect(computeQueueSummary(visits).waitingCount).toBe(1);
  });
});

describe("computeExpectedWaitMinutes", () => {
  it("multiplies the number of turns away by the average consult length", () => {
    expect(computeExpectedWaitMinutes(5, 3, 11)).toBe(22);
  });

  it("is zero for the current turn itself", () => {
    expect(computeExpectedWaitMinutes(3, 3, 11)).toBe(0);
  });

  it("never goes negative", () => {
    expect(computeExpectedWaitMinutes(1, 3, 11)).toBe(0);
  });
});
