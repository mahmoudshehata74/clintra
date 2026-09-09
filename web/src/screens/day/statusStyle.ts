import { VisitStatus, type VisitStatus as VisitStatusType } from "../../domain/visitStatus";
import { dayScreenStrings } from "./strings";

/** Shared by SlotRow (slots mode) and QueueRow (queue mode) — the same seven statuses read the same way regardless of how a day is scheduled. */
export const STATUS_LABEL: Record<string, string> = {
  [VisitStatus.Booked]: dayScreenStrings.statusBooked,
  [VisitStatus.Confirmed]: dayScreenStrings.statusConfirmed,
  [VisitStatus.Arrived]: dayScreenStrings.statusArrived,
  [VisitStatus.InRoom]: dayScreenStrings.statusInRoom,
  [VisitStatus.Completed]: dayScreenStrings.statusCompleted,
  [VisitStatus.Cancelled]: dayScreenStrings.statusCancelled,
  [VisitStatus.NoShow]: dayScreenStrings.statusNoShow,
};

export interface StatusVisual {
  /** Border/fill classes for the slot row container. */
  containerClassName: string;
  /** Classes for the patient name text. */
  nameClassName: string;
  /** Classes for everything else on the row: time, status word, service line, sub-lines, the "recorded by" byline. */
  metaClassName: string;
}

const WAITING = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed]);

/**
 * One authoritative full-row visual treatment per status, matching the
 * design reference's filled-card model (clintra-screens.html screen 3's
 * .sl/.now/.her/.mis/.pst classes) rather than a left-edge accent stripe:
 * in_room is a solid green fill (.now) because it is the loudest signal on
 * the screen and must not read as a plain booking; arrived gets a lighter
 * green fill (.her) so it visibly stands out from a plain booking without
 * competing with in_room; a finished visit fades into a muted grey fill
 * (.pst) so it visibly settles into the past; a no-show fills red (.mis)
 * since the slot was expected to be used and was not; booked/confirmed gets
 * the reference's plain, unfilled card outline (.sl with no modifier) —
 * colour is reserved for exceptions and highlights, not for "waiting as
 * normal." Cancelled has no equivalent in the reference (its slots-grid
 * sample never shows a cancelled slot): the pre-existing dashed-border,
 * struck-through-name treatment is kept, generalised from a left-edge
 * stripe to a full border so it still reads as "removed" without being the
 * only state left using the old stripe language.
 */
export function statusVisual(status: VisitStatusType): StatusVisual | null {
  if (WAITING.has(status)) {
    return {
      containerClassName: "border border-line bg-paper",
      nameClassName: "",
      metaClassName: "text-muted",
    };
  }
  if (status === VisitStatus.Arrived) {
    return {
      containerClassName: "border border-green/20 bg-green-soft",
      nameClassName: "font-semibold text-green",
      metaClassName: "text-green-medium",
    };
  }
  if (status === VisitStatus.InRoom) {
    return {
      containerClassName: "border border-green bg-green",
      nameClassName: "font-semibold text-paper",
      metaClassName: "text-paper/80",
    };
  }
  if (status === VisitStatus.Completed) {
    return {
      containerClassName: "border border-line bg-line-soft",
      nameClassName: "text-muted",
      metaClassName: "text-muted",
    };
  }
  if (status === VisitStatus.Cancelled) {
    return {
      containerClassName: "border border-dashed border-red bg-paper",
      nameClassName: "line-through",
      metaClassName: "text-muted",
    };
  }
  if (status === VisitStatus.NoShow) {
    return {
      containerClassName: "border border-red/20 bg-red-soft",
      nameClassName: "text-red",
      metaClassName: "text-red",
    };
  }
  return null;
}
