import { describe, expect, it } from "vitest";
import { ScheduleMode } from "../../domain/scheduleMode";
import { cairoInstant } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import type { Schedule, Visit } from "../../db/types";
import { computeGridRows } from "./dayGrid";

const TODAY = "2026-01-05";

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
};

function visit(overrides: Partial<Visit> & { id: string; position: number; time: string }): Visit {
  const { time, ...rest } = overrides;
  return {
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: TODAY,
    scheduled_at: cairoInstant(TODAY, time),
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
    ...rest,
  };
}

describe("computeGridRows", () => {
  it("renders one row per empty slot when there are no visits — the normal-day regression case", () => {
    const rows = computeGridRows(SCHEDULE, []);
    expect(rows).toEqual([
      { time: "09:00", visit: null, isExtraAtTime: false },
      { time: "09:30", visit: null, isExtraAtTime: false },
    ]);
  });

  it("renders exactly one row per visit when nothing shares a time — the normal-day regression case", () => {
    const first = visit({ id: "visit-1", position: 1, time: "09:00" });
    const second = visit({ id: "visit-2", position: 2, time: "09:30" });

    const rows = computeGridRows(SCHEDULE, [first, second]);

    expect(rows).toEqual([
      { time: "09:00", visit: first, isExtraAtTime: false },
      { time: "09:30", visit: second, isExtraAtTime: false },
    ]);
  });

  it("gives three visits sharing a time three rows, in position order, marking the second and third", () => {
    const normal = visit({ id: "visit-normal", position: 1, time: "09:00", is_overbooked: false });
    const overbook1 = visit({ id: "visit-overbook-1", position: 6, time: "09:00", is_overbooked: true });
    const overbook2 = visit({ id: "visit-overbook-2", position: 7, time: "09:00", is_overbooked: true });

    // Deliberately out of order, to prove sorting is by position, not input order.
    const rows = computeGridRows(SCHEDULE, [overbook2, normal, overbook1]);

    const rowsAtNine = rows.filter((row) => row.time === "09:00");
    expect(rowsAtNine).toEqual([
      { time: "09:00", visit: normal, isExtraAtTime: false },
      { time: "09:00", visit: overbook1, isExtraAtTime: true },
      { time: "09:00", visit: overbook2, isExtraAtTime: true },
    ]);
    // The other slot in the schedule is still a plain empty row.
    expect(rows.find((row) => row.time === "09:30")).toEqual({
      time: "09:30",
      visit: null,
      isExtraAtTime: false,
    });
  });
});
