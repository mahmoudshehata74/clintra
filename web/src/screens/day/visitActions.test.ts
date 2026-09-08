import { describe, expect, it } from "vitest";
import { VisitStatus } from "../../domain/visitStatus";
import { isMenuEligible, primaryAdvanceTarget } from "./visitActions";

describe("primaryAdvanceTarget", () => {
  it.each([
    [VisitStatus.Booked, VisitStatus.Arrived],
    [VisitStatus.Confirmed, VisitStatus.Arrived],
    [VisitStatus.Arrived, VisitStatus.InRoom],
    [VisitStatus.InRoom, VisitStatus.Completed],
  ] as const)("advances %s to %s on a single tap", (from, to) => {
    expect(primaryAdvanceTarget(from)).toBe(to);
  });

  it.each([VisitStatus.Completed, VisitStatus.Cancelled, VisitStatus.NoShow, VisitStatus.Rescheduled])(
    "does nothing on a single tap for %s",
    (status) => {
      expect(primaryAdvanceTarget(status)).toBeNull();
    },
  );
});

describe("isMenuEligible", () => {
  it.each([VisitStatus.Booked, VisitStatus.Confirmed, VisitStatus.Arrived, VisitStatus.InRoom])(
    "shows the overflow menu for %s",
    (status) => {
      expect(isMenuEligible(status)).toBe(true);
    },
  );

  it.each([VisitStatus.Completed, VisitStatus.Cancelled, VisitStatus.NoShow, VisitStatus.Rescheduled])(
    "hides the overflow menu for %s",
    (status) => {
      expect(isMenuEligible(status)).toBe(false);
    },
  );
});
