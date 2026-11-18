import { describe, expect, it } from "vitest";
import { blocksArchiving, isArchived } from "./patientArchive";
import { VisitStatus } from "./visitStatus";

const TODAY = "2026-11-18";

describe("blocksArchiving", () => {
  it("allows a patient with no visits", () => {
    expect(blocksArchiving([], TODAY)).toBe(false);
  });

  it.each([
    [VisitStatus.Booked, "2026-11-25"],
    [VisitStatus.Confirmed, "2026-11-19"],
    [VisitStatus.Booked, TODAY],
    [VisitStatus.Arrived, TODAY],
    [VisitStatus.InRoom, TODAY],
  ])("refuses while a %s visit on %s is still to come", (status, day) => {
    expect(blocksArchiving([{ status, visit_date: day }], TODAY)).toBe(true);
  });

  it.each([
    [VisitStatus.Completed, TODAY],
    [VisitStatus.Cancelled, "2026-11-25"],
    [VisitStatus.NoShow, TODAY],
    [VisitStatus.Rescheduled, "2026-11-25"],
    // Left booked on a past day: history, not a booking.
    [VisitStatus.Booked, "2026-11-17"],
  ])("allows a %s visit on %s", (status, day) => {
    expect(blocksArchiving([{ status, visit_date: day }], TODAY)).toBe(false);
  });

  it("refuses when any one visit is still to come", () => {
    const visits = [
      { status: VisitStatus.Completed, visit_date: "2026-10-01" },
      { status: VisitStatus.Booked, visit_date: "2026-12-01" },
    ];
    expect(blocksArchiving(visits, TODAY)).toBe(true);
  });
});

describe("isArchived", () => {
  it("reads a set archived_at as archived, null or a missing field as not", () => {
    expect(isArchived({ archived_at: "2026-11-18T10:00:00.000Z" })).toBe(true);
    expect(isArchived({ archived_at: null })).toBe(false);
    expect(isArchived({})).toBe(false);
  });
});
