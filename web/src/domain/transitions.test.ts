import { describe, expect, it } from "vitest";
import { canTransitionVisitStatus } from "./transitions";
import { VisitStatus } from "./visitStatus";

const ALL_STATUSES = Object.values(VisitStatus);

const VALID_TRANSITIONS: readonly (readonly [VisitStatus, VisitStatus])[] = [
  [VisitStatus.Booked, VisitStatus.Confirmed],
  [VisitStatus.Confirmed, VisitStatus.Arrived],
  [VisitStatus.Arrived, VisitStatus.InRoom],
  [VisitStatus.InRoom, VisitStatus.Completed],
  [VisitStatus.Booked, VisitStatus.Cancelled],
  [VisitStatus.Booked, VisitStatus.NoShow],
  [VisitStatus.Booked, VisitStatus.Rescheduled],
];

describe("canTransitionVisitStatus", () => {
  it.each(VALID_TRANSITIONS)("allows %s -> %s", (from, to) => {
    expect(canTransitionVisitStatus(from, to)).toBe(true);
  });

  it.each([
    [VisitStatus.Confirmed, VisitStatus.Cancelled],
    [VisitStatus.Booked, VisitStatus.Arrived],
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
