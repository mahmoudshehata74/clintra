import { describe, expect, it } from "vitest";
import { cairoInstant } from "../../domain/time";
import { ScheduleMode } from "../../domain/scheduleMode";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import type { Schedule, Visit } from "../../db/types";
import { computeEmptySlots } from "./emptySlots";

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

function visitAt(time: string, status: Visit["status"], overrides: Partial<Visit> = {}): Visit {
  return {
    id: `visit-${time}`,
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: TODAY,
    position: 1,
    scheduled_at: cairoInstant(TODAY, time),
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeEmptySlots", () => {
  it("returns every slot in time order when there are no visits", () => {
    const slots = computeEmptySlots(SCHEDULE, []);
    expect(slots.map((s) => s.time)).toEqual(["09:00", "09:30"]);
    expect(slots.every((s) => s.existingVisit === null)).toBe(true);
  });

  it("excludes a slot occupied by a booked, confirmed, arrived, in_room or completed visit", () => {
    for (const status of [
      VisitStatus.Booked,
      VisitStatus.Confirmed,
      VisitStatus.Arrived,
      VisitStatus.InRoom,
      VisitStatus.Completed,
    ]) {
      const slots = computeEmptySlots(SCHEDULE, [visitAt("09:00", status)]);
      expect(slots.map((s) => s.time)).toEqual(["09:30"]);
    }
  });

  it("offers a slot whose visit was cancelled or a no-show, carrying that visit for reuse", () => {
    for (const status of [VisitStatus.Cancelled, VisitStatus.NoShow]) {
      const visit = visitAt("09:00", status);
      const slots = computeEmptySlots(SCHEDULE, [visit]);
      expect(slots.map((s) => s.time)).toEqual(["09:00", "09:30"]);
      expect(slots.find((s) => s.time === "09:00")?.existingVisit).toEqual(visit);
    }
  });

  it("offers a slot whose visit was rescheduled away", () => {
    const visit = visitAt("09:00", VisitStatus.Rescheduled);
    const slots = computeEmptySlots(SCHEDULE, [visit]);
    expect(slots.map((s) => s.time)).toEqual(["09:00", "09:30"]);
  });

  it("treats a time as occupied if any visit there occupies it, even alongside a freed one (overbooking can put two visits at the same time)", () => {
    const active = visitAt("09:00", VisitStatus.Booked, { id: "visit-active" });
    const freed = visitAt("09:00", VisitStatus.Cancelled, { id: "visit-freed" });

    // Order must not matter: the still-active visit must never be hidden by
    // a freed one that happens to be processed after it.
    const slotsActiveFirst = computeEmptySlots(SCHEDULE, [active, freed]);
    expect(slotsActiveFirst.map((s) => s.time)).toEqual(["09:30"]);

    const slotsFreedFirst = computeEmptySlots(SCHEDULE, [freed, active]);
    expect(slotsFreedFirst.map((s) => s.time)).toEqual(["09:30"]);
  });
});
