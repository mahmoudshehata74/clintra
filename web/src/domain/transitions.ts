import { VisitStatus } from "./visitStatus";

// Cancel, mark-no-show and move are administrative overrides available from
// the row's overflow menu on every occupied-but-not-yet-completed status, not
// only from booked: an assistant must be able to cancel or move a visit that
// already confirmed, arrived, or is in the room, not just a plain booking.
const ADMIN_OVERRIDES: readonly VisitStatus[] = [
  VisitStatus.Cancelled,
  VisitStatus.NoShow,
  VisitStatus.Rescheduled,
];

/** The only transitions the visit status machine permits. Every other transition, including any move out of a terminal status, is invalid. */
export const VISIT_TRANSITIONS: Readonly<Record<VisitStatus, readonly VisitStatus[]>> = {
  [VisitStatus.Booked]: [
    VisitStatus.Confirmed,
    // A patient can show up without ever being phoned to confirm; one-tap
    // attendance must work directly from booked, not only from confirmed.
    VisitStatus.Arrived,
    ...ADMIN_OVERRIDES,
  ],
  [VisitStatus.Confirmed]: [VisitStatus.Arrived, ...ADMIN_OVERRIDES],
  [VisitStatus.Arrived]: [VisitStatus.InRoom, ...ADMIN_OVERRIDES],
  [VisitStatus.InRoom]: [VisitStatus.Completed, ...ADMIN_OVERRIDES],
  [VisitStatus.Completed]: [],
  [VisitStatus.Cancelled]: [],
  [VisitStatus.NoShow]: [],
  [VisitStatus.Rescheduled]: [],
};

/** True only for a transition explicitly listed in VISIT_TRANSITIONS; every unlisted transition, including from a terminal status, is rejected. */
export function canTransitionVisitStatus(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from].includes(to);
}
