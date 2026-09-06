import Ltr from "../../components/Ltr";
import type { Patient, Service, Visit } from "../../db/types";
import { dayScreenStrings } from "./strings";
import { statusColor, STATUS_ACCENT_BORDER_CLASS } from "./statusStyle";

interface SlotRowProps {
  time: string;
  visit?: Visit;
  patient?: Patient;
  service?: Service;
}

export default function SlotRow({ time, visit, patient, service }: SlotRowProps) {
  // A visit with no colour category (only "rescheduled" today) no longer
  // occupies this slot, so it renders as empty rather than booked.
  const color = visit ? statusColor(visit.status) : null;

  const className = color
    ? `flex items-center gap-3 rounded-[--radius-el] border border-line bg-paper p-3 ${STATUS_ACCENT_BORDER_CLASS[color]}`
    : "flex items-center gap-3 rounded-[--radius-el] border border-dashed border-line p-3";

  return (
    <li className={className}>
      <span className="w-16 shrink-0 text-muted">
        <Ltr>{time}</Ltr>
      </span>
      {color ? (
        <span className="flex flex-col">
          <span>{patient?.full_name}</span>
          {service && <span className="text-sm text-muted">{service.name}</span>}
        </span>
      ) : (
        <span className="text-muted">{dayScreenStrings.emptySlot}</span>
      )}
    </li>
  );
}
