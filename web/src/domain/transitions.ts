import { VisitStatus } from "./visitStatus";

/** The only transitions the visit status machine permits. Every other transition, including any move out of a terminal status, is invalid. */
export const VISIT_TRANSITIONS: Readonly<Record<VisitStatus, readonly VisitStatus[]>> = {
  [VisitStatus.Booked]: [
    VisitStatus.Confirmed,
    VisitStatus.Cancelled,
    VisitStatus.NoShow,
    VisitStatus.Rescheduled,
  ],
  [VisitStatus.Confirmed]: [VisitStatus.Arrived],
  [VisitStatus.Arrived]: [VisitStatus.InRoom],
  [VisitStatus.InRoom]: [VisitStatus.Completed],
  [VisitStatus.Completed]: [],
  [VisitStatus.Cancelled]: [],
  [VisitStatus.NoShow]: [],
  [VisitStatus.Rescheduled]: [],
};

/** True only for a transition explicitly listed in VISIT_TRANSITIONS; every unlisted transition, including from a terminal status, is rejected. */
export function canTransitionVisitStatus(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from].includes(to);
}
