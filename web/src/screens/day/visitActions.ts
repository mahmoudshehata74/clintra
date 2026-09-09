import { VisitStatus } from "../../domain/visitStatus";

// The status a single tap on an occupied row advances to. completed,
// cancelled and no_show all have nothing to do on a single tap.
const PRIMARY_ADVANCE_TARGET: Partial<Record<VisitStatus, VisitStatus>> = {
  [VisitStatus.Booked]: VisitStatus.Arrived,
  [VisitStatus.Confirmed]: VisitStatus.Arrived,
  [VisitStatus.Arrived]: VisitStatus.InRoom,
  [VisitStatus.InRoom]: VisitStatus.Completed,
};

/** The status a single tap on this row's visit advances to, or null if a tap does nothing. */
export function primaryAdvanceTarget(status: VisitStatus): VisitStatus | null {
  return PRIMARY_ADVANCE_TARGET[status] ?? null;
}

// Move / cancel / mark-no-show are available from the overflow menu on every
// occupied-but-not-yet-completed status — the same statuses a primary tap
// advances from — not only from booked. A completed visit has nothing left
// to administer, same as cancelled and no_show.
const MENU_ELIGIBLE_STATUSES = new Set<VisitStatus>([
  VisitStatus.Booked,
  VisitStatus.Confirmed,
  VisitStatus.Arrived,
  VisitStatus.InRoom,
]);

/** True when this row's visit should show the overflow (move/cancel/no-show) menu. */
export function isMenuEligible(status: VisitStatus): boolean {
  return MENU_ELIGIBLE_STATUSES.has(status);
}

// Queue mode's "send to the end" is narrower than the general menu-eligible
// set above: only a visit genuinely still waiting its turn (not yet called
// in) can be pushed back — an in_room visit is already being seen.
const QUEUE_WAITING_STATUSES = new Set<VisitStatus>([VisitStatus.Booked, VisitStatus.Arrived]);

/** True when a queue row's visit can be sent to the end of the line (see db/visitQueue.ts). */
export function isQueueWaiting(status: VisitStatus): boolean {
  return QUEUE_WAITING_STATUSES.has(status);
}
