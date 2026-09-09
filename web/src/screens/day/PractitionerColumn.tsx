import { toArabicIndicDigits } from "../../domain/arabicNumerals";
import { countCompletedConsultations } from "../../domain/consultStats";
import { ScheduleMode } from "../../domain/scheduleMode";
import type { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Schedule, Service, Visit } from "../../db/types";
import { computeGridRows } from "./dayGrid";
import { computeExpectedWaitMinutes, computeQueueSummary } from "./queueSummary";
import QueueRow from "./QueueRow";
import { resolveDayScheduleState } from "./scheduleState";
import SlotRow from "./SlotRow";
import { dayScreenStrings } from "./strings";
import { isMenuEligible, isQueueWaiting, primaryAdvanceTarget } from "./visitActions";

interface PractitionerColumnProps {
  practitionerName: string;
  showLabel: boolean;
  /** Today's schedule for this practitioner at the selected location, if any — either mode. */
  todaysSchedule: Schedule | undefined;
  /** Whether this practitioner has any schedule row at all, for any weekday. */
  hasAnySchedule: boolean;
  visits: readonly Visit[];
  patientsById: ReadonlyMap<string, Patient>;
  servicesById: ReadonlyMap<string, Service>;
  /** Which of these visits have an invoice, and which — see db/visitCompletion.ts. */
  invoiceIdByVisitId: ReadonlyMap<string, string>;
  /** day_state.avg_consult_minutes for this practitioner+location+date — queue mode only. */
  avgConsultMinutes: number | null;
  onAdvance: (visit: Visit, toStatus: VisitStatus) => void;
  openMenuVisitId: string | null;
  onOpenMenu: (visitId: string) => void;
  onCloseMenu: () => void;
  onRequestMove: (visit: Visit) => void;
  onRequestCancel: (visit: Visit) => void;
  onMarkNoShow: (visit: Visit) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onSendToEnd: (visit: Visit) => void;
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
  avgConsultMinutes,
  onAdvance,
  openMenuVisitId,
  onOpenMenu,
  onCloseMenu,
  onRequestMove,
  onRequestCancel,
  onMarkNoShow,
  onOpenInvoice,
  onSendToEnd,
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

  if (scheduleState.schedule.mode === ScheduleMode.Queue) {
    return (
      <QueueColumn
        practitionerName={practitionerName}
        showLabel={showLabel}
        visits={visits}
        patientsById={patientsById}
        servicesById={servicesById}
        invoiceIdByVisitId={invoiceIdByVisitId}
        avgConsultMinutes={avgConsultMinutes}
        onAdvance={onAdvance}
        openMenuVisitId={openMenuVisitId}
        onOpenMenu={onOpenMenu}
        onCloseMenu={onCloseMenu}
        onRequestCancel={onRequestCancel}
        onMarkNoShow={onMarkNoShow}
        onOpenInvoice={onOpenInvoice}
        onSendToEnd={onSendToEnd}
      />
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

interface QueueColumnProps {
  practitionerName: string;
  showLabel: boolean;
  visits: readonly Visit[];
  patientsById: ReadonlyMap<string, Patient>;
  servicesById: ReadonlyMap<string, Service>;
  invoiceIdByVisitId: ReadonlyMap<string, string>;
  avgConsultMinutes: number | null;
  onAdvance: (visit: Visit, toStatus: VisitStatus) => void;
  openMenuVisitId: string | null;
  onOpenMenu: (visitId: string) => void;
  onCloseMenu: () => void;
  onRequestCancel: (visit: Visit) => void;
  onMarkNoShow: (visit: Visit) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onSendToEnd: (visit: Visit) => void;
}

/** Never extrapolated from a single data point — see queueSummary.ts and docs/schema.md. */
const MINIMUM_COMPLETED_FOR_ESTIMATE = 2;

function QueueColumn({
  practitionerName,
  showLabel,
  visits,
  patientsById,
  servicesById,
  invoiceIdByVisitId,
  avgConsultMinutes,
  onAdvance,
  openMenuVisitId,
  onOpenMenu,
  onCloseMenu,
  onRequestCancel,
  onMarkNoShow,
  onOpenInvoice,
  onSendToEnd,
}: QueueColumnProps) {
  const sortedVisits = [...visits].sort((a, b) => a.position - b.position);
  const summary = computeQueueSummary(sortedVisits);
  const hasEnoughDataForEstimate = countCompletedConsultations(sortedVisits) >= MINIMUM_COMPLETED_FOR_ESTIMATE;

  return (
    <div>
      {showLabel && <h3 className="font-display mb-3 text-lg font-medium">{practitionerName}</h3>}

      <p className="mb-3 text-sm text-muted">
        {dayScreenStrings.queueSummaryCurrentTurnLabel}:{" "}
        {summary.currentTurnPosition !== null ? toArabicIndicDigits(summary.currentTurnPosition) : "—"}
        {" · "}
        {dayScreenStrings.queueSummaryWaitingLabel}: {toArabicIndicDigits(summary.waitingCount)}
        {" · "}
        {dayScreenStrings.queueSummaryAverageLabel}:{" "}
        {avgConsultMinutes !== null
          ? `${toArabicIndicDigits(avgConsultMinutes)} ${dayScreenStrings.delayMinutesSuffix}`
          : "—"}
      </p>

      <ul className="flex flex-col gap-2">
        {sortedVisits.map((visit) => {
          const patient = patientsById.get(visit.patient_id);
          const service = visit.service_id ? servicesById.get(visit.service_id) : undefined;
          const advanceTarget = primaryAdvanceTarget(visit.status);
          const invoiceId = invoiceIdByVisitId.get(visit.id);
          const isWaiting = isQueueWaiting(visit.status);
          const isNext = visit.id === summary.nextVisitId;
          const menuEligible = Boolean(isMenuEligible(visit.status) || invoiceId || isWaiting);

          let expectedWaitLabel: string | null = null;
          if (isWaiting) {
            if (!hasEnoughDataForEstimate || avgConsultMinutes === null || summary.currentTurnPosition === null) {
              expectedWaitLabel = dayScreenStrings.queueExpectedWaitUnknown;
            } else {
              const minutes = computeExpectedWaitMinutes(visit.position, summary.currentTurnPosition, avgConsultMinutes);
              expectedWaitLabel = `${dayScreenStrings.queueExpectedWaitPrefix}${toArabicIndicDigits(minutes)} ${dayScreenStrings.delayMinutesSuffix}`;
            }
          }

          return (
            <QueueRow
              key={visit.id}
              visit={visit}
              patient={patient}
              service={service}
              isNext={isNext}
              expectedWaitLabel={expectedWaitLabel}
              onPrimaryAction={advanceTarget ? () => onAdvance(visit, advanceTarget) : undefined}
              menu={
                menuEligible
                  ? {
                      isOpen: openMenuVisitId === visit.id,
                      onOpen: () => onOpenMenu(visit.id),
                      onClose: onCloseMenu,
                      onSendToEnd: isWaiting ? () => onSendToEnd(visit) : undefined,
                      onCancel: isMenuEligible(visit.status) ? () => onRequestCancel(visit) : undefined,
                      onNoShow: isMenuEligible(visit.status) ? () => onMarkNoShow(visit) : undefined,
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
