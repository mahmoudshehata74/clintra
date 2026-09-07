import Ltr from "../../components/Ltr";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Service, Visit } from "../../db/types";
import { dayScreenStrings } from "./strings";
import { statusVisual } from "./statusStyle";

interface SlotRowProps {
  time: string;
  visit?: Visit;
  patient?: Patient;
  service?: Service;
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

export default function SlotRow({ time, visit, patient, service }: SlotRowProps) {
  // A visit with no visual treatment (only "rescheduled" today) no longer
  // occupies this slot, so it renders as empty rather than booked.
  const visual = visit ? statusVisual(visit.status) : null;

  const className = visual
    ? `flex items-center gap-3 rounded-[--radius-el] border border-line bg-paper p-3 ${visual.containerClassName}`
    : "flex items-center gap-3 rounded-[--radius-el] border border-dashed border-line p-3";

  return (
    <li className={className}>
      <span className="w-16 shrink-0 text-muted">
        <Ltr>{time}</Ltr>
      </span>
      {visual && visit ? (
        <span className="flex flex-col">
          <span className="flex items-baseline gap-2">
            <span className={visual.nameClassName}>{patient?.full_name}</span>
            <span className="text-sm text-muted">{STATUS_LABEL[visit.status]}</span>
          </span>
          {REOPENED_STATUSES.has(visit.status) && (
            <span className="text-sm text-muted">{dayScreenStrings.slotAvailableAgain}</span>
          )}
          {service && <span className="text-sm text-muted">{service.name}</span>}
        </span>
      ) : (
        <span className="text-muted">{dayScreenStrings.emptySlot}</span>
      )}
    </li>
  );
}
