import Ltr from "../../components/Ltr";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Service, Visit } from "../../db/types";
import { dayScreenStrings } from "./strings";
import { STATUS_LABEL, statusVisual } from "./statusStyle";
import VisitMenu, { type VisitMenuActions } from "./VisitMenu";

interface SlotRowProps {
  time: string;
  /** False for every row after the first sharing this clock time — the time is only shown once per group. */
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
    ? `flex w-full items-center gap-1 rounded-[--radius-el] p-3 ${visual.containerClassName}`
    : "flex w-full items-center gap-1 rounded-[--radius-el] border border-dashed border-line bg-paper p-3";

  const timeClassName = visual ? visual.metaClassName : "text-muted";

  const rowContent = (
    <>
      <span className={`w-16 shrink-0 ${timeClassName}`}>{showTime && <Ltr>{time}</Ltr>}</span>
      {visual && visit ? (
        <span className="flex flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className={visual.nameClassName}>{patient?.full_name}</span>
            <span className={`text-sm ${visual.metaClassName}`}>{STATUS_LABEL[visit.status]}</span>
            {isExtraAtTime && (
              <span className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted">
                {dayScreenStrings.overbookedRowBadge}
              </span>
            )}
          </span>
          {service && <span className={`text-sm ${visual.metaClassName}`}>{service.name}</span>}
          {REOPENED_STATUSES.has(visit.status) && (
            <span className={`text-sm ${visual.metaClassName}`}>{dayScreenStrings.slotAvailableAgain}</span>
          )}
          {actorLabel && (
            <span className={`text-sm ${visual.metaClassName}`}>
              {dayScreenStrings.recordedByPrefix} {actorLabel}
            </span>
          )}
          {showEmptyFormHint && <span className="text-sm text-muted">{dayScreenStrings.visitFormEmptyHint}</span>}
        </span>
      ) : (
        <span className="flex flex-1 items-center justify-center text-xl text-muted" aria-hidden="true">
          +
        </span>
      )}
    </>
  );

  return (
    <li className={containerClassName}>
      {isTappable ? (
        <button
          type="button"
          onClick={handleClick}
          aria-label={visual ? undefined : dayScreenStrings.emptySlot}
          className="flex flex-1 items-center gap-3 text-start"
        >
          {rowContent}
        </button>
      ) : (
        <div className="flex flex-1 items-center gap-3 text-start">{rowContent}</div>
      )}
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
    </li>
  );
}
