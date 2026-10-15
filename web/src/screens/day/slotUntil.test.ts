import { describe, expect, it } from "vitest";
import type { Visit } from "../../db/types";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import { slotUntilText } from "./slotUntil";

const TODAY = "2026-09-07";
// Noon Cairo on TODAY (UTC+3 in September).
const NOW = new Date("2026-09-07T09:00:00.000Z");
const before = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

function makeVisit(overrides: Partial<Visit>): Visit {
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
    note: null,
    rev: 1,
    ...overrides,
  };
}

describe("slotUntilText", () => {
  it.each([
    [0, "دلوقتي"],
    [59, "دلوقتي"],
    [60, "من 1د"],
    [7 * 60, "من 7د"],
  ])("an in-room visit started %i seconds ago reads %s", (seconds, expected) => {
    expect(slotUntilText(makeVisit({ status: VisitStatus.InRoom, started_at: before(seconds) }), undefined, TODAY, NOW)).toBe(
      expected,
    );
  });

  it.each([
    [30, "دلوقتي"],
    [12 * 60, "من 12د"],
  ])("a no-show scheduled %i seconds ago reads %s", (seconds, expected) => {
    expect(slotUntilText(makeVisit({ status: VisitStatus.NoShow, scheduled_at: before(seconds) }), undefined, TODAY, NOW)).toBe(
      expected,
    );
  });

  it("a completed visit shows its duration, even under a minute", () => {
    const completed = makeVisit({ status: VisitStatus.Completed, started_at: before(30 * 60), ended_at: before(18 * 60) });
    expect(slotUntilText(completed, undefined, TODAY, NOW)).toBe("12د");
    const quick = makeVisit({ status: VisitStatus.Completed, started_at: before(40), ended_at: before(10) });
    expect(slotUntilText(quick, undefined, TODAY, NOW)).toBe("1د");
  });

  it("an arrived visit shows its arrival time with the patient's gender", () => {
    const arrived = makeVisit({ status: VisitStatus.Arrived, arrived_at: "2026-09-07T05:52:00.000Z" });
    expect(slotUntilText(arrived, undefined, TODAY, NOW)).toBe("وصل 08:52");
  });

  it("shows nothing off the live day", () => {
    const inRoom = makeVisit({ status: VisitStatus.InRoom, started_at: "2026-08-03T07:00:00.000Z" });
    expect(slotUntilText(inRoom, undefined, "2026-08-03", NOW)).toBeNull();
  });

  it("shows nothing for a booked visit", () => {
    expect(slotUntilText(makeVisit({ scheduled_at: before(60) }), undefined, TODAY, NOW)).toBeNull();
  });
});
