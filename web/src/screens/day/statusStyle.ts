import { VisitStatus, type VisitStatus as VisitStatusType } from "../../domain/visitStatus";

export type StatusColor = "amber" | "green" | "red";

const WAITING = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed, VisitStatus.Arrived]);
const IN_PROGRESS_OR_DONE = new Set<string>([VisitStatus.InRoom, VisitStatus.Completed]);
const STOPPED = new Set<string>([VisitStatus.Cancelled, VisitStatus.NoShow]);

/**
 * Muted display colour for a visit status: amber for waiting-type statuses,
 * green for in-progress and completed, red for cancelled and no_show. A
 * rescheduled visit no longer occupies its original slot (the booking moved
 * to a new visit), so it has no colour here — the caller renders that slot
 * as empty instead of booked.
 */
export function statusColor(status: VisitStatusType): StatusColor | null {
  if (WAITING.has(status)) {
    return "amber";
  }
  if (IN_PROGRESS_OR_DONE.has(status)) {
    return "green";
  }
  if (STOPPED.has(status)) {
    return "red";
  }
  return null;
}

// Muted: a small accent border, not a full saturated fill, since this screen
// is read continuously for eight hours a day. border-s-4 is the width
// (inline-start, i.e. the leading edge in RTL); the colour class is separate.
export const STATUS_ACCENT_BORDER_CLASS: Record<StatusColor, string> = {
  amber: "border-s-4 border-s-amber",
  green: "border-s-4 border-s-green",
  red: "border-s-4 border-s-red",
};
