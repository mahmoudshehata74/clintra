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
