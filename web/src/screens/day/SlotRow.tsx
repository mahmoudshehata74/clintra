import Ltr from "../../components/Ltr";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Service, Visit } from "../../db/types";
import { dayScreenStrings } from "./strings";
import { STATUS_LABEL, statusVisual } from "./statusStyle";
import VisitMenu, { type VisitMenuActions } from "./VisitMenu";

interface SlotRowProps {
  time: string;
  /**
   * Kept for interface stability, but no longer varied by the caller: each
   * tile is now its own visually separate cell in a 3-column grid (not a
   * continuous list), so every occupied tile shows its own time regardless
   * of whether a neighbour shares it — see PractitionerColumn.tsx's own note
   * on why an overbooked pair no longer hides the second tile's time.
   */
  showTime?: boolean;
  visit?: Visit;
  patient?: Patient;
  service?: Service;
  /** True for every visit after the first sharing this clock time (only reachable through the overbook flow). */
  isExtraAtTime?: boolean;
  /** Present only when a single tap on this row does something (see visitActions.ts). */
  onPrimaryAction?: () => void;
  /** Present only when this row's visit is eligible for the overflow menu. */
  menu?: VisitMenuActions;
  /** Present only for a genuinely (or visually) empty slot when booking is currently possible. */
  onTapEmptySlot?: () => void;
  /** Resolved "recorded by" label for the visit's created_by membership — see actorLabel.ts. */
  actorLabel?: string;
  /** Present only when this row's visit is in_room or completed — opens the visit form sheet (see VisitFormSheet.tsx). */
  onOpenVisitForm?: () => void;
  /** True for a completed visit with no visit_form_data row at all — a passive note, never a warning. */
  showEmptyFormHint?: boolean;
}

const REOPENED_STATUSES = new Set<string>([VisitStatus.Cancelled, VisitStatus.NoShow]);

/**
 * One cell of the day grid — clintra-screens.html's `.sl` tile: a compact
 * card (`min-height:64px`) stacking time, name and a status/service line,
 * rather than the wide horizontal row this used to be. `.sl.free` is a
 * dashed, centered "+" with no time label at all, reproduced exactly (an
 * empty tile in the reference carries no clock text); every occupied
 * status keeps its exact fill/border/text-colour treatment from
 * statusStyle.ts — only the container's shape changed, per this task's
 * scope. The overflow menu and the visit-form pill, absent from the
 * reference's own minimal mockup, sit as a small trailing footer row
 * pinned to the tile's bottom edge instead of trailing inline siblings.
 */
export default function SlotRow({
  time,
  showTime = true,
  visit,
  patient,
  service,
  isExtraAtTime = false,
  onPrimaryAction,
  menu,
  onTapEmptySlot,
  actorLabel,
  onOpenVisitForm,
  showEmptyFormHint = false,
}: SlotRowProps) {
  // A visit with no visual treatment (only "rescheduled" today) no longer
  // occupies this slot, so it renders as empty rather than booked.
  const visual = visit ? statusVisual(visit.status) : null;
  const handleClick = onPrimaryAction ?? onTapEmptySlot;
  const isTappable = Boolean(handleClick);

  const containerClassName = visual
    ? `flex min-h-16 flex-col rounded-[--radius-el] p-2 ${visual.containerClassName}`
    : "flex min-h-16 flex-col rounded-[--radius-el] border border-dashed border-line bg-paper p-2";

  if (!visual || !visit) {
    // .sl.free: no time shown, just a centered plus glyph filling the tile —
    // exact visual match to the reference, but that leaves nothing on the
    // page for a test (or a screen reader) to tell one empty tile from the
    // next by time. data-slot-time is a plain, non-visual, non-ARIA hook for
    // that — it does not change the accessible name (still exactly
    // dayScreenStrings.emptySlot, matching every other empty-slot test) and
    // is not rendered.
    return (
      <li className={containerClassName}>
        {isTappable ? (
          <button
            type="button"
            onClick={handleClick}
            aria-label={dayScreenStrings.emptySlot}
            data-slot-time={time}
            className="flex flex-1 items-center justify-center text-xl text-muted"
          >
            +
          </button>
        ) : (
          <span className="flex flex-1 items-center justify-center text-xl text-muted" aria-hidden="true">
            +
          </span>
        )}
      </li>
    );
  }

  const occupiedContent = (
    <>
      <span className={`text-xs ${visual.metaClassName}`}>{showTime && <Ltr>{time}</Ltr>}</span>
      <span className={`text-sm leading-tight ${visual.nameClassName}`}>{patient?.full_name}</span>
      <span className={`text-xs ${visual.metaClassName}`}>{STATUS_LABEL[visit.status]}</span>
      {isExtraAtTime && (
        <span className="mt-0.5 self-start rounded-[5px] bg-line-soft px-1.5 py-0.5 text-[10px] text-muted">
          {dayScreenStrings.overbookedRowBadge}
        </span>
      )}
      {service && <span className={`text-xs ${visual.metaClassName}`}>{service.name}</span>}
      {REOPENED_STATUSES.has(visit.status) && (
        <span className={`text-xs ${visual.metaClassName}`}>{dayScreenStrings.slotAvailableAgain}</span>
      )}
      {actorLabel && (
        <span className={`text-[10px] ${visual.metaClassName}`}>
          {dayScreenStrings.recordedByPrefix} {actorLabel}
        </span>
      )}
      {showEmptyFormHint && <span className="text-[10px] text-muted">{dayScreenStrings.visitFormEmptyHint}</span>}
    </>
  );

  return (
    <li className={containerClassName}>
      {isTappable ? (
        <button type="button" onClick={handleClick} className="flex w-full flex-1 flex-col items-start gap-0.5 text-start">
          {occupiedContent}
        </button>
      ) : (
        <div className="flex w-full flex-1 flex-col items-start gap-0.5 text-start">{occupiedContent}</div>
      )}
      {(onOpenVisitForm || menu) && (
        <div className="mt-auto flex items-center justify-end gap-1 pt-1">
          {onOpenVisitForm && (
            <button
              type="button"
              onClick={onOpenVisitForm}
              className="shrink-0 rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted hover:bg-green-soft hover:text-green"
            >
              {dayScreenStrings.visitFormPillLabel}
            </button>
          )}
          {menu && <VisitMenu actions={menu} />}
        </div>
      )}
    </li>
  );
}
