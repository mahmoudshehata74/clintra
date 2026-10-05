import type { BadgeTone } from "../../components/ui/Badge";
import { VisitStatus, type VisitStatus as VisitStatusType } from "../../domain/visitStatus";
import { dayScreenStrings } from "./strings";

// Mirrors Badge.tsx's own SoftBadgeVariant/SolidBadgeVariant/DashedBadgeVariant
// (minus `shape`, which SlotRow always sets to "pill" itself) so `<Badge
// {...visual.badge} shape="pill">` type-checks as a real Badge variant
// rather than a loose {appearance, tone} pair Badge would reject at the type
// level (e.g. a "dashed" appearance only ever accepts four of the six tones).
type SlotBadgeProps =
  | { appearance: "soft"; tone: Exclude<BadgeTone, "eligible"> }
  | { appearance: "solid"; tone: BadgeTone }
  | { appearance: "dashed"; tone: "green" | "copper" | "warning" | "danger" };

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
  /** `.slot::before` — the row's 3px left accent. */
  stripeClassName: string;
  /** `.slot.in-room`/`.no-show`'s own subtle background wash; empty for every other status. */
  rowBgClassName: string;
  /** Classes for the patient name text. */
  nameClassName: string;
  /** Classes for the time column's own text (not `.until`). */
  timeClassName: string;
  /** Classes for the `.until` sub-line under the time — copper for in_room, faint otherwise. */
  untilClassName: string;
  /** Classes for everything else on the row: service line, reopened-slot note, the "recorded by" byline. */
  metaClassName: string;
  /** The `.state` pill's Badge props (shape is always "pill" — SlotRow's own concern). */
  badge: SlotBadgeProps;
}

const WAITING = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed]);

/**
 * One authoritative visual treatment per status, matching the prototype's
 * `.slot` row (docs/reference/clintra-prototype.html #s2): a 3px left-edge
 * accent stripe plus a coloured state pill carry each status's meaning,
 * rather than filling the whole row — only in_room and no_show additionally
 * get a very subtle background wash, reproducing `.slot.in-room`/`.no-show`'s
 * own linear-gradient exactly. Cancelled has no equivalent in the reference's
 * own slots-grid sample; the pre-existing dashed-border, struck-through-name
 * treatment is kept, now expressed as a dashed stripe + dashed danger pill.
 */
export function statusVisual(status: VisitStatusType): StatusVisual | null {
  if (WAITING.has(status)) {
    return {
      stripeClassName: "before:bg-transparent",
      rowBgClassName: "",
      nameClassName: "",
      timeClassName: "",
      untilClassName: "text-faint",
      metaClassName: "text-muted",
      badge: { appearance: "soft", tone: "neutral" },
    };
  }
  if (status === VisitStatus.Arrived) {
    return {
      stripeClassName: "before:bg-eligible",
      rowBgClassName: "",
      nameClassName: "",
      timeClassName: "",
      untilClassName: "text-faint",
      metaClassName: "text-muted",
      badge: { appearance: "solid", tone: "eligible" },
    };
  }
  if (status === VisitStatus.InRoom) {
    return {
      stripeClassName: "before:bg-copper",
      rowBgClassName:
        "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-copper-wash)_65%,transparent)_0%,transparent_40%)]",
      nameClassName: "text-copper",
      timeClassName: "",
      untilClassName: "font-semibold text-copper-2",
      metaClassName: "text-muted",
      badge: { appearance: "solid", tone: "copper" },
    };
  }
  if (status === VisitStatus.Completed) {
    return {
      stripeClassName: "before:bg-rule",
      rowBgClassName: "",
      nameClassName: "text-muted",
      timeClassName: "text-muted",
      untilClassName: "text-faint",
      metaClassName: "text-faint",
      badge: { appearance: "soft", tone: "neutral" },
    };
  }
  if (status === VisitStatus.Cancelled) {
    return {
      stripeClassName: "before:bg-faint before:opacity-40",
      rowBgClassName: "",
      nameClassName: "text-muted line-through decoration-faint",
      timeClassName: "text-faint",
      untilClassName: "text-faint",
      metaClassName: "text-faint",
      badge: { appearance: "dashed", tone: "danger" },
    };
  }
  if (status === VisitStatus.NoShow) {
    return {
      stripeClassName: "before:bg-danger",
      rowBgClassName:
        "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-danger-wash)_55%,transparent)_0%,transparent_40%)]",
      nameClassName: "text-danger",
      timeClassName: "",
      untilClassName: "text-faint",
      metaClassName: "text-muted",
      badge: { appearance: "solid", tone: "danger" },
    };
  }
  return null;
}
