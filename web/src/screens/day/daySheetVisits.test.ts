import { describe, expect, it } from "vitest";
import { selectDaySheetVisits } from "./daySheetVisits";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import type { Visit } from "../../db/types";

function visit(overrides: Partial<Visit>): Visit {
  return {
    id: "visit",
    org_id: "org",
    location_id: "loc",
    practitioner_id: "prac",
    patient_id: "patient",
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-10",
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
    created_by: "membership",
    created_at: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectDaySheetVisits", () => {
  it("orders slots-mode visits by scheduled_at, earliest first", () => {
    const visits = [
      visit({ id: "c", scheduled_at: "2026-09-10T10:00:00.000Z" }),
      visit({ id: "a", scheduled_at: "2026-09-10T08:00:00.000Z" }),
      visit({ id: "b", scheduled_at: "2026-09-10T09:00:00.000Z" }),
    ];
    const result = selectDaySheetVisits(visits, false);
    expect(result.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("orders queue-mode visits by position, not by scheduled_at (which is always null)", () => {
    const visits = [
      visit({ id: "c", position: 3, scheduled_at: null }),
      visit({ id: "a", position: 1, scheduled_at: null }),
      visit({ id: "b", position: 2, scheduled_at: null }),
    ];
    const result = selectDaySheetVisits(visits, true);
    expect(result.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("excludes cancelled, no-show and rescheduled visits, keeping every other status", () => {
    const visits = [
      visit({ id: "booked", status: VisitStatus.Booked, scheduled_at: "2026-09-10T08:00:00.000Z" }),
      visit({ id: "confirmed", status: VisitStatus.Confirmed, scheduled_at: "2026-09-10T08:30:00.000Z" }),
      visit({ id: "cancelled", status: VisitStatus.Cancelled, scheduled_at: "2026-09-10T09:00:00.000Z" }),
      visit({ id: "no_show", status: VisitStatus.NoShow, scheduled_at: "2026-09-10T09:30:00.000Z" }),
      visit({ id: "rescheduled", status: VisitStatus.Rescheduled, scheduled_at: "2026-09-10T10:00:00.000Z" }),
    ];
    const result = selectDaySheetVisits(visits, false);
    expect(result.map((v) => v.id)).toEqual(["booked", "confirmed"]);
  });
});
