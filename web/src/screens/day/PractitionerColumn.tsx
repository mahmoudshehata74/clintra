import { generateSlotTimes } from "../../domain/schedule";
import { clockTimeInCairo } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Schedule, Service, Visit } from "../../db/types";
import { resolveDayScheduleState } from "./scheduleState";
import SlotRow from "./SlotRow";
import { dayScreenStrings } from "./strings";

const TAPPABLE_FOR_ARRIVAL = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed]);

interface PractitionerColumnProps {
  practitionerName: string;
  showLabel: boolean;
  /** Today's slots-mode schedule for this practitioner at the selected location, if any. */
  todaysSchedule: Schedule | undefined;
  /** Whether this practitioner has any schedule row at all, for any weekday. */
  hasAnySchedule: boolean;
  visits: readonly Visit[];
  patientsById: ReadonlyMap<string, Patient>;
  servicesById: ReadonlyMap<string, Service>;
  onMarkArrived: (visit: Visit) => void;
}

export default function PractitionerColumn({
  practitionerName,
  showLabel,
  todaysSchedule,
  hasAnySchedule,
  visits,
  patientsById,
  servicesById,
  onMarkArrived,
}: PractitionerColumnProps) {
  const scheduleState = resolveDayScheduleState(todaysSchedule, hasAnySchedule);

  if (scheduleState.kind !== "scheduled") {
    const message =
      scheduleState.kind === "day_off"
        ? dayScreenStrings.noScheduleToday
        : dayScreenStrings.scheduleNotConfigured;

    return (
      <div className="rounded-[--radius-frame] border border-line p-6 text-center">
        {showLabel && <h3 className="font-display text-lg font-medium">{practitionerName}</h3>}
        <p className="mt-2 text-muted">{message}</p>
        {scheduleState.kind === "not_configured" && (
          <p className="mt-1 text-sm text-muted">{dayScreenStrings.scheduleNotConfiguredHint}</p>
        )}
      </div>
    );
  }

  const slotTimes = generateSlotTimes(scheduleState.schedule);

  const visitsByTime = new Map<string, Visit>();
  for (const visit of visits) {
    if (visit.scheduled_at) {
      visitsByTime.set(clockTimeInCairo(visit.scheduled_at), visit);
    }
  }

  return (
    <div>
      {showLabel && <h3 className="font-display mb-3 text-lg font-medium">{practitionerName}</h3>}
      <ul className="flex flex-col gap-2">
        {slotTimes.map((time) => {
          const visit = visitsByTime.get(time);
          const patient = visit ? patientsById.get(visit.patient_id) : undefined;
          const service = visit?.service_id ? servicesById.get(visit.service_id) : undefined;
          const canMarkArrived = Boolean(visit && TAPPABLE_FOR_ARRIVAL.has(visit.status));
          return (
            <SlotRow
              key={time}
              time={time}
              visit={visit}
              patient={patient}
              service={service}
              onMarkArrived={canMarkArrived && visit ? () => onMarkArrived(visit) : undefined}
            />
          );
        })}
      </ul>
    </div>
  );
}
