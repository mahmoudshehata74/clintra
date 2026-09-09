import { toArabicIndicDigits } from "../../domain/arabicNumerals";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Service, Visit } from "../../db/types";
import { STATUS_LABEL } from "./statusStyle";
import { dayScreenStrings } from "./strings";
import VisitMenu, { type VisitMenuActions } from "./VisitMenu";

interface QueueRowProps {
  visit: Visit;
  patient?: Patient;
  service?: Service;
  /** The single waiting row currently first in line — see screens/day/queueSummary.ts. */
  isNext: boolean;
  /** Null for a non-waiting row, or a waiting row shown before this label is known — see queueSummary.ts's gating. */
  expectedWaitLabel: string | null;
  onPrimaryAction?: () => void;
  menu?: VisitMenuActions;
}

const MUTED_STATUSES = new Set<string>([VisitStatus.Completed, VisitStatus.Cancelled, VisitStatus.NoShow]);

/**
 * The three visual weights queue mode calls for, in order of priority: the
 * in_room visit is unmissable (full green fill), the next-in-line waiting
 * visit gets a subtle accent (never the same treatment as in_room), and a
 * finished or dropped row is muted but still legible.
 */
function containerClassName(visit: Visit, isNext: boolean): string {
  if (visit.status === VisitStatus.InRoom) {
    return "flex w-full items-center gap-3 rounded-[--radius-el] bg-green p-3 text-paper";
  }
  if (isNext) {
    return "flex w-full items-center gap-3 rounded-[--radius-el] border border-line bg-green-soft p-3";
  }
  if (MUTED_STATUSES.has(visit.status)) {
    return "flex w-full items-center gap-3 rounded-[--radius-el] border border-line p-3 opacity-60";
  }
  return "flex w-full items-center gap-3 rounded-[--radius-el] border border-line bg-paper p-3";
}

export default function QueueRow({
  visit,
  patient,
  service,
  isNext,
  expectedWaitLabel,
  onPrimaryAction,
  menu,
}: QueueRowProps) {
  const isTappable = Boolean(onPrimaryAction);
  const isInRoom = visit.status === VisitStatus.InRoom;
  const mutedTextClassName = isInRoom ? "" : "text-muted";

  const rowContent = (
    <>
      <span className={`w-8 shrink-0 text-center ${mutedTextClassName}`}>{toArabicIndicDigits(visit.position)}</span>
      <span className="flex flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span className={visit.status === VisitStatus.Cancelled ? "line-through" : ""}>{patient?.full_name}</span>
          <span className={`text-sm ${mutedTextClassName}`}>{STATUS_LABEL[visit.status]}</span>
          {isNext && !isInRoom && (
            <span className="text-sm font-semibold text-green">{dayScreenStrings.queueNextBadge}</span>
          )}
        </span>
        {service && <span className={`text-sm ${mutedTextClassName}`}>{service.name}</span>}
        {expectedWaitLabel && <span className="text-sm text-muted">{expectedWaitLabel}</span>}
      </span>
    </>
  );

  return (
    <li className={containerClassName(visit, isNext)}>
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
