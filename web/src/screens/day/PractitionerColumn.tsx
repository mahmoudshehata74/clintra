import type { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Schedule, Service, Visit } from "../../db/types";
import { computeGridRows } from "./dayGrid";
import { resolveDayScheduleState } from "./scheduleState";
import SlotRow from "./SlotRow";
import { dayScreenStrings } from "./strings";
import { isMenuEligible, primaryAdvanceTarget } from "./visitActions";

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
  /** Which of these visits have an invoice, and which — see db/visitCompletion.ts. */
  invoiceIdByVisitId: ReadonlyMap<string, string>;
  onAdvance: (visit: Visit, toStatus: VisitStatus) => void;
  openMenuVisitId: string | null;
  onOpenMenu: (visitId: string) => void;
  onCloseMenu: () => void;
  onRequestMove: (visit: Visit) => void;
  onRequestCancel: (visit: Visit) => void;
  onMarkNoShow: (visit: Visit) => void;
  onOpenInvoice: (invoiceId: string) => void;
}

export default function PractitionerColumn({
  practitionerName,
  showLabel,
  todaysSchedule,
  hasAnySchedule,
  visits,
  patientsById,
  servicesById,
  invoiceIdByVisitId,
  onAdvance,
  openMenuVisitId,
  onOpenMenu,
  onCloseMenu,
  onRequestMove,
  onRequestCancel,
  onMarkNoShow,
  onOpenInvoice,
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

  const rows = computeGridRows(scheduleState.schedule, visits);

  return (
    <div>
      {showLabel && <h3 className="font-display mb-3 text-lg font-medium">{practitionerName}</h3>}
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const { time, visit, isExtraAtTime } = row;
          const showTime = index === 0 || rows[index - 1].time !== time;
          const patient = visit ? patientsById.get(visit.patient_id) : undefined;
          const service = visit?.service_id ? servicesById.get(visit.service_id) : undefined;
          const advanceTarget = visit ? primaryAdvanceTarget(visit.status) : null;
          const invoiceId = visit ? invoiceIdByVisitId.get(visit.id) : undefined;
          const administrable = Boolean(visit && isMenuEligible(visit.status));
          const menuEligible = Boolean(visit && (administrable || invoiceId));

          return (
            <SlotRow
              key={visit ? visit.id : `${time}-empty`}
              time={time}
              showTime={showTime}
              visit={visit ?? undefined}
              patient={patient}
              service={service}
              isExtraAtTime={isExtraAtTime}
              onPrimaryAction={advanceTarget && visit ? () => onAdvance(visit, advanceTarget) : undefined}
              menu={
                menuEligible && visit
                  ? {
                      isOpen: openMenuVisitId === visit.id,
                      onOpen: () => onOpenMenu(visit.id),
                      onClose: onCloseMenu,
                      onMove: administrable ? () => onRequestMove(visit) : undefined,
                      onCancel: administrable ? () => onRequestCancel(visit) : undefined,
                      onNoShow: administrable ? () => onMarkNoShow(visit) : undefined,
                      onInvoice: invoiceId ? () => onOpenInvoice(invoiceId) : undefined,
                    }
                  : undefined
              }
            />
          );
        })}
      </ul>
    </div>
  );
}
