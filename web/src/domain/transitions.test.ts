import { describe, expect, it } from "vitest";
import { canTransitionVisitStatus } from "./transitions";
import { VisitStatus } from "./visitStatus";

const ALL_STATUSES = Object.values(VisitStatus);

const VALID_TRANSITIONS: readonly (readonly [VisitStatus, VisitStatus])[] = [
  [VisitStatus.Booked, VisitStatus.Confirmed],
  [VisitStatus.Booked, VisitStatus.Arrived],
  [VisitStatus.Confirmed, VisitStatus.Arrived],
  [VisitStatus.Arrived, VisitStatus.InRoom],
  [VisitStatus.InRoom, VisitStatus.Completed],
  // Cancel, no-show and move (rescheduled) are administrative overrides
  // reachable from every occupied-but-not-yet-completed status, per the
  // overflow menu's requirements — not only from booked.
  [VisitStatus.Booked, VisitStatus.Cancelled],
  [VisitStatus.Booked, VisitStatus.NoShow],
  [VisitStatus.Booked, VisitStatus.Rescheduled],
  [VisitStatus.Confirmed, VisitStatus.Cancelled],
  [VisitStatus.Confirmed, VisitStatus.NoShow],
  [VisitStatus.Confirmed, VisitStatus.Rescheduled],
  [VisitStatus.Arrived, VisitStatus.Cancelled],
  [VisitStatus.Arrived, VisitStatus.NoShow],
  [VisitStatus.Arrived, VisitStatus.Rescheduled],
  [VisitStatus.InRoom, VisitStatus.Cancelled],
  [VisitStatus.InRoom, VisitStatus.NoShow],
  [VisitStatus.InRoom, VisitStatus.Rescheduled],
];

describe("canTransitionVisitStatus", () => {
  it.each(VALID_TRANSITIONS)("allows %s -> %s", (from, to) => {
    expect(canTransitionVisitStatus(from, to)).toBe(true);
  });

  it.each([
    [VisitStatus.Booked, VisitStatus.Completed],
    [VisitStatus.Arrived, VisitStatus.Completed],
    [VisitStatus.InRoom, VisitStatus.Arrived],
    [VisitStatus.Confirmed, VisitStatus.Booked],
    [VisitStatus.NoShow, VisitStatus.Cancelled],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(canTransitionVisitStatus(from, to)).toBe(false);
  });

  const terminalStatuses = [
    VisitStatus.Completed,
    VisitStatus.Cancelled,
    VisitStatus.NoShow,
    VisitStatus.Rescheduled,
  ];

  it.each(terminalStatuses)("rejects every transition out of terminal status %s", (from) => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionVisitStatus(from, to)).toBe(false);
    }
  });
});
