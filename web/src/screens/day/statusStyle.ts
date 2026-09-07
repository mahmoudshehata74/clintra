import { VisitStatus, type VisitStatus as VisitStatusType } from "../../domain/visitStatus";

export interface StatusVisual {
  /** Border/fill classes for the slot row container. */
  containerClassName: string;
  /** Classes for the patient name text. */
  nameClassName: string;
}

const WAITING = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed]);
const IN_PROGRESS_OR_DONE = new Set<string>([VisitStatus.InRoom, VisitStatus.Completed]);

/**
 * Visual treatment for a visit status. Five states are distinguished, not
 * just three colours: a booked/confirmed visit is a thin amber border only —
 * arrived gets that same amber border PLUS a soft fill and a bolder name,
 * because a patient sitting in the waiting room right now is the single most
 * important fact on this screen and must not look like a plain booking.
 * Likewise cancelled and no_show both use red but are never rendered the
 * same: cancelled is dashed with a struck-through name (removed from the
 * schedule), no_show is solid (was expected, did not appear) — the
 * specification treats them as distinct statuses for missed-revenue
 * reporting, so they must be visually distinct too. Neither is dimmed: staff
 * still need to read these rows clearly to decide whether to offer the slot
 * to someone else. A rescheduled visit no longer occupies its original slot
 * (the booking moved to a new visit), so it has no treatment here — the
 * caller renders that slot as empty instead of booked.
 */
export function statusVisual(status: VisitStatusType): StatusVisual | null {
  if (WAITING.has(status)) {
    return { containerClassName: "border-s-4 border-s-amber", nameClassName: "" };
  }
  if (status === VisitStatus.Arrived) {
    return {
      containerClassName: "border-s-4 border-s-amber bg-amber/10",
      nameClassName: "font-semibold",
    };
  }
  if (IN_PROGRESS_OR_DONE.has(status)) {
    return { containerClassName: "border-s-4 border-s-green", nameClassName: "" };
  }
  if (status === VisitStatus.Cancelled) {
    return {
      containerClassName: "border-s-4 border-dashed border-s-red",
      nameClassName: "line-through",
    };
  }
  if (status === VisitStatus.NoShow) {
    return { containerClassName: "border-s-4 border-s-red", nameClassName: "" };
  }
  return null;
}
