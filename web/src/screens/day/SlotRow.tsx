import Ltr from "../../components/Ltr";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Service, Visit } from "../../db/types";
import { dayScreenStrings } from "./strings";
import { statusVisual } from "./statusStyle";
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
}

const STATUS_LABEL: Record<string, string> = {
  [VisitStatus.Booked]: dayScreenStrings.statusBooked,
  [VisitStatus.Confirmed]: dayScreenStrings.statusConfirmed,
  [VisitStatus.Arrived]: dayScreenStrings.statusArrived,
  [VisitStatus.InRoom]: dayScreenStrings.statusInRoom,
  [VisitStatus.Completed]: dayScreenStrings.statusCompleted,
  [VisitStatus.Cancelled]: dayScreenStrings.statusCancelled,
  [VisitStatus.NoShow]: dayScreenStrings.statusNoShow,
};

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
}: SlotRowProps) {
  // A visit with no visual treatment (only "rescheduled" today) no longer
  // occupies this slot, so it renders as empty rather than booked.
  const visual = visit ? statusVisual(visit.status) : null;
  const isTappable = Boolean(onPrimaryAction);

  const containerClassName = visual
    ? `flex w-full items-center gap-1 rounded-[--radius-el] border border-line bg-paper p-3 ${visual.containerClassName}`
    : "flex w-full items-center gap-1 rounded-[--radius-el] border border-dashed border-line p-3";

  const rowContent = (
    <>
      <span className="w-16 shrink-0 text-muted">{showTime && <Ltr>{time}</Ltr>}</span>
      {visual && visit ? (
        <span className="flex flex-col">
          <span className="flex items-baseline gap-2">
            <span className={visual.nameClassName}>{patient?.full_name}</span>
            <span className="text-sm text-muted">{STATUS_LABEL[visit.status]}</span>
          </span>
          {service && <span className="text-sm text-muted">{service.name}</span>}
          {REOPENED_STATUSES.has(visit.status) && (
            <span className="text-sm text-muted">{dayScreenStrings.slotAvailableAgain}</span>
          )}
          {isExtraAtTime && (
            <span className="text-sm text-muted">{dayScreenStrings.overbookedRowBadge}</span>
          )}
        </span>
      ) : (
        <span className="text-muted">{dayScreenStrings.emptySlot}</span>
      )}
    </>
  );

  return (
    <li className={containerClassName}>
      {isTappable ? (
        <button type="button" onClick={onPrimaryAction} className="flex flex-1 items-center gap-3 text-start">
          {rowContent}
        </button>
      ) : (
        <div className="flex flex-1 items-center gap-3 text-start">{rowContent}</div>
      )}
      {menu && <VisitMenu actions={menu} />}
    </li>
  );
}
