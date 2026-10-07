import type { ReactNode } from "react";
import Ltr from "../../components/Ltr";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Card, { CardFooter, CardHead } from "../../components/ui/Card";
import { countCompletedConsultations } from "../../domain/consultStats";
import { ScheduleMode } from "../../domain/scheduleMode";
import { clockTimeInCairo, type ClinicDay, type ClockTime } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Schedule, Service, Visit } from "../../db/types";
import { computeGridRows } from "./dayGrid";
import { computeElapsedLabel } from "./elapsedLabel";
import { computeEmptySlots } from "./emptySlots";
import { computeExpectedWaitMinutes, computeQueueSummary } from "./queueSummary";
import QueueRow, { type QueueRowKind } from "./QueueRow";
import { resolveDayScheduleState } from "./scheduleState";
import SlotRow from "./SlotRow";
import { STATUS_LABEL, statusVisual } from "./statusStyle";
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
  /** Resolved "recorded by" label per visit id — slots mode only for now (queue mode is a separate task). */
  actorLabelByVisitId: ReadonlyMap<string, string>;
  /** Which visits already have a visit_form_data row — see db/visitForm.ts. Drives the completed-row empty-form hint. */
  formDataVisitIds: ReadonlySet<string>;
  /** Visit ids whose primary row button is in its post-tap cooldown — see advanceCooldown.ts. */
  advancingVisitIds: ReadonlySet<string>;
  today: ClinicDay;
  /** Present only when booking is currently possible — slots mode only. Tapping an empty slot opens the booking sheet pre-filled with that time. */
  onTapEmptySlot?: (time: ClockTime) => void;
  /** The card footer's primary action — opens the booking sheet with no preset time/queue position. Present only when booking is currently possible. */
  onOpenBooking?: () => void;
  /** The card footer's secondary "مريض جه دلوقتي" action. Present only when booking is currently possible. */
  onWalkIn?: () => void;
  onAdvance: (visit: Visit, toStatus: VisitStatus) => void;
  openMenuVisitId: string | null;
  onOpenMenu: (visitId: string) => void;
  onCloseMenu: () => void;
  onRequestMove: (visit: Visit) => void;
  onRequestCancel: (visit: Visit) => void;
  onMarkNoShow: (visit: Visit) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onSendToEnd: (visit: Visit) => void;
  onOpenVisitForm: (visit: Visit) => void;
  /** The slots card's trailing actions ("ورقة الغد"/"السجل") — slots mode only. */
  onOpenDaySheet?: () => void;
  onOpenAudit?: () => void;
  /** The queue card's "استدعاء التالي" trailing action — advances the next waiting visit. */
  onCallNextInQueue?: () => void;
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
  actorLabelByVisitId,
  formDataVisitIds,
  advancingVisitIds,
  today,
  onTapEmptySlot,
  onOpenBooking,
  onWalkIn,
  onAdvance,
  openMenuVisitId,
  onOpenMenu,
  onCloseMenu,
  onRequestMove,
  onRequestCancel,
  onMarkNoShow,
  onOpenInvoice,
  onSendToEnd,
  onOpenVisitForm,
  onOpenDaySheet,
  onOpenAudit,
  onCallNextInQueue,
}: PractitionerColumnProps) {
  const scheduleState = resolveDayScheduleState(todaysSchedule, hasAnySchedule);

  if (scheduleState.kind !== "scheduled") {
    const message =
      scheduleState.kind === "day_off"
        ? dayScreenStrings.noScheduleToday
        : dayScreenStrings.scheduleNotConfigured;

    return (
      <div className="rounded-panel border border-rule p-6 text-center">
        {showLabel && <h3 className="text-lg font-medium">{practitionerName}</h3>}
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
        actorLabelByVisitId={actorLabelByVisitId}
        formDataVisitIds={formDataVisitIds}
        advancingVisitIds={advancingVisitIds}
        onAdvance={onAdvance}
        openMenuVisitId={openMenuVisitId}
        onOpenMenu={onOpenMenu}
        onCloseMenu={onCloseMenu}
        onRequestCancel={onRequestCancel}
        onMarkNoShow={onMarkNoShow}
        onOpenInvoice={onOpenInvoice}
        onSendToEnd={onSendToEnd}
        onOpenVisitForm={onOpenVisitForm}
        onCallNext={onCallNextInQueue}
        onOpenBooking={onOpenBooking}
        onWalkIn={onWalkIn}
        today={today}
      />
    );
  }

  const schedule = scheduleState.schedule;
  const rows = computeGridRows(schedule, visits);
  // Only computed when booking is actually possible, since it's the one
  // extra piece of work this component would otherwise do on every render
  // for no reason — see emptySlots.ts, the exact same source of truth
  // BookingSheet's own slot list reads from.
  const emptySlotTimes = onTapEmptySlot
    ? new Set(computeEmptySlots(schedule, visits).map((slot) => slot.time))
    : null;

  const bookedCount = rows.filter((row) => row.visit).length;
  const freeCount = rows.length - bookedCount;

  return (
    <Card>
      <CardHead
        badge={dayScreenStrings.slotsCardBadge}
        title={showLabel ? practitionerName : dayScreenStrings.slotsCardTitle}
        subtitle={
          <>
            <Ltr>{bookedCount}</Ltr> {dayScreenStrings.slotsCardSubtitleBookedSuffix}
            {" · "}
            <Ltr>{freeCount}</Ltr> {dayScreenStrings.slotsCardSubtitleFreeSuffix}
            {schedule.slot_minutes != null && (
              <>
                {" · "}
                <Ltr>{schedule.slot_minutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
              </>
            )}
          </>
        }
        action={
          (onOpenDaySheet || onOpenAudit) && (
            <div className="flex items-center gap-1.5">
              {onOpenDaySheet && (
                <Button variant="onDark" size="sm" onClick={onOpenDaySheet}>
                  {dayScreenStrings.daySheetButtonLabel}
                </Button>
              )}
              {onOpenAudit && (
                <Button variant="onDark" size="sm" onClick={onOpenAudit}>
                  {dayScreenStrings.auditButtonLabel}
                </Button>
              )}
            </div>
          )
        }
      />
      <ul>
        {rows.map((row) => {
          const { time, visit, isExtraAtTime } = row;
          const patient = visit ? patientsById.get(visit.patient_id) : undefined;
          const service = visit?.service_id ? servicesById.get(visit.service_id) : undefined;
          const advanceTarget = visit ? primaryAdvanceTarget(visit.status) : null;
          const invoiceId = visit ? invoiceIdByVisitId.get(visit.id) : undefined;
          const administrable = Boolean(visit && isMenuEligible(visit.status));
          const menuEligible = Boolean(visit && (administrable || invoiceId));
          const showVisitFormPill =
            visit != null && (visit.status === VisitStatus.InRoom || visit.status === VisitStatus.Completed);
          const openVisitForm = visit ? () => onOpenVisitForm(visit) : undefined;
          const isCompleted = visit != null && visit.status === VisitStatus.Completed;
          const isVisuallyEmpty = !visit || statusIsVisuallyEmpty(visit.status);

          return (
            <SlotRow
              key={visit ? visit.id : `${time}-empty`}
              time={time}
              visit={visit ?? undefined}
              patient={patient}
              service={service}
              isExtraAtTime={isExtraAtTime}
              actorLabel={visit ? actorLabelByVisitId.get(visit.id) : undefined}
              today={today}
              onPrimaryAction={
                advanceTarget && visit ? () => onAdvance(visit, advanceTarget) : isCompleted ? openVisitForm : undefined
              }
              disablePrimaryAction={visit ? advancingVisitIds.has(visit.id) : false}
              onOpenVisitForm={showVisitFormPill ? openVisitForm : undefined}
              showEmptyFormHint={isCompleted && visit ? !formDataVisitIds.has(visit.id) : false}
              onTapEmptySlot={
                onTapEmptySlot && isVisuallyEmpty && emptySlotTimes?.has(time)
                  ? () => onTapEmptySlot(time)
                  : undefined
              }
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
      <CardFooter
        count={
          <>
            <Ltr>{rows.length}</Ltr> {dayScreenStrings.slotsFooterCountTotalSuffix}
            {" · "}
            <Ltr>{bookedCount}</Ltr> {dayScreenStrings.slotsFooterCountBookedSuffix}
            {" · "}
            <Ltr>{freeCount}</Ltr> {dayScreenStrings.slotsFooterCountFreeSuffix}
          </>
        }
      >
        {onOpenBooking && (
          <Button variant="primary" size="sm" onClick={onOpenBooking}>
            {dayScreenStrings.bookingButtonLabel}
          </Button>
        )}
        {onWalkIn && (
          <Button variant="secondary" size="sm" onClick={onWalkIn}>
            {dayScreenStrings.walkInButtonLabel}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// Mirrors SlotRow.tsx's own "visually empty" rule (statusVisual returns null
// only for rescheduled) without importing its full StatusVisual shape here —
// this component only needs the yes/no answer, not the styling it implies.
function statusIsVisuallyEmpty(status: Visit["status"]): boolean {
  return status === VisitStatus.Rescheduled;
}

interface QueueColumnProps {
  practitionerName: string;
  showLabel: boolean;
  visits: readonly Visit[];
  patientsById: ReadonlyMap<string, Patient>;
  servicesById: ReadonlyMap<string, Service>;
  invoiceIdByVisitId: ReadonlyMap<string, string>;
  avgConsultMinutes: number | null;
  actorLabelByVisitId: ReadonlyMap<string, string>;
  formDataVisitIds: ReadonlySet<string>;
  /** Visit ids whose primary row button is in its post-tap cooldown — see advanceCooldown.ts. */
  advancingVisitIds: ReadonlySet<string>;
  onAdvance: (visit: Visit, toStatus: VisitStatus) => void;
  openMenuVisitId: string | null;
  onOpenMenu: (visitId: string) => void;
  onCloseMenu: () => void;
  onRequestCancel: (visit: Visit) => void;
  onMarkNoShow: (visit: Visit) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onSendToEnd: (visit: Visit) => void;
  onOpenVisitForm: (visit: Visit) => void;
  onCallNext?: () => void;
  onOpenBooking?: () => void;
  onWalkIn?: () => void;
  /** Today, for the elapsed in_room meta phrase's real-day gating — see elapsedLabel.ts. */
  today: ClinicDay;
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
  actorLabelByVisitId,
  formDataVisitIds,
  advancingVisitIds,
  onAdvance,
  openMenuVisitId,
  onOpenMenu,
  onCloseMenu,
  onRequestCancel,
  onMarkNoShow,
  onOpenInvoice,
  onSendToEnd,
  onOpenVisitForm,
  onCallNext,
  onOpenBooking,
  onWalkIn,
  today,
}: QueueColumnProps) {
  const now = new Date();
  const sortedVisits = [...visits].sort((a, b) => a.position - b.position);
  const summary = computeQueueSummary(sortedVisits);
  const hasEnoughDataForEstimate = countCompletedConsultations(sortedVisits) >= MINIMUM_COMPLETED_FOR_ESTIMATE;
  const completedCount = sortedVisits.filter((visit) => visit.status === VisitStatus.Completed).length;
  const someoneInRoom = sortedVisits.some((visit) => visit.status === VisitStatus.InRoom);
  const canCallNext = Boolean(onCallNext && !someoneInRoom && summary.nextVisitId);

  return (
    <Card>
      <CardHead
        badge={dayScreenStrings.queueCardBadge}
        title={showLabel ? practitionerName : dayScreenStrings.queueCardTitle}
        subtitle={dayScreenStrings.queueCardSubtitle}
        action={
          canCallNext && (
            <Button variant="onDark" size="sm" onClick={onCallNext}>
              {dayScreenStrings.queueCallNextActionLabel}
            </Button>
          )
        }
      />
      <ul>
        {sortedVisits.map((visit) => {
          const patient = patientsById.get(visit.patient_id);
          const service = visit.service_id ? servicesById.get(visit.service_id) : undefined;
          const advanceTarget = primaryAdvanceTarget(visit.status);
          const invoiceId = invoiceIdByVisitId.get(visit.id);
          const isWaiting = isQueueWaiting(visit.status);
          const isNext = visit.id === summary.nextVisitId;
          const menuEligible = Boolean(isMenuEligible(visit.status) || invoiceId || isWaiting);
          const showVisitFormPill = visit.status === VisitStatus.InRoom || visit.status === VisitStatus.Completed;
          const openVisitForm = () => onOpenVisitForm(visit);
          const isCompleted = visit.status === VisitStatus.Completed;

          // Cancelled/no_show never reach the queue's own current/next/done
          // rule (visitActions.ts's isQueueWaiting excludes them), but a row
          // still exists for them — "done" (settled, nothing left to do) is
          // the closest of the four kinds, same reasoning as SlotRow.tsx's
          // own completed treatment.
          const isSettledButNotCompleted =
            visit.status === VisitStatus.Cancelled || visit.status === VisitStatus.NoShow;
          const kind: QueueRowKind =
            visit.status === VisitStatus.InRoom
              ? "current"
              : isCompleted || isSettledButNotCompleted
                ? "done"
                : isNext
                  ? "next"
                  : "waiting";

          // `.qwho .meta`'s state phrase, gender-neutral per the task's own
          // wording — "{service} · {phrase}" is QueueRow.tsx's own concern,
          // this only ever builds the phrase half.
          let metaPhrase: ReactNode = null;
          if (visit.status === VisitStatus.Completed && visit.ended_at) {
            metaPhrase = `${dayScreenStrings.statusCompleted} ${clockTimeInCairo(visit.ended_at)}`;
          } else if (visit.status === VisitStatus.InRoom && visit.started_at) {
            const elapsed = computeElapsedLabel(visit.started_at, now.toISOString(), today, now);
            metaPhrase = elapsed ? `${dayScreenStrings.queueInRoomMetaPrefix} ${elapsed}` : dayScreenStrings.statusInRoom;
          } else if (visit.status === VisitStatus.Arrived && visit.arrived_at) {
            metaPhrase = `${dayScreenStrings.statusArrived} ${clockTimeInCairo(visit.arrived_at)}`;
          } else if (visit.status === VisitStatus.Booked || visit.status === VisitStatus.Confirmed) {
            metaPhrase = STATUS_LABEL[visit.status];
          }

          let waitNode: ReactNode = null;
          if (isSettledButNotCompleted) {
            // The slots list's own Badge pill, in place of a bare bold word
            // — same statusVisual.ts tones/appearances SlotRow.tsx uses.
            const visual = statusVisual(visit.status);
            waitNode = visual ? (
              <Badge {...visual.badge} shape="pill">
                {STATUS_LABEL[visit.status]}
              </Badge>
            ) : (
              <b>{STATUS_LABEL[visit.status]}</b>
            );
          } else if (isCompleted && visit.started_at && visit.ended_at) {
            const minutes = Math.round(
              (new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60_000,
            );
            waitNode = (
              <>
                {dayScreenStrings.queueWaitCompletedPrefix}
                <b>
                  <Ltr>{minutes}</Ltr>
                  {dayScreenStrings.minutesShortUnit}
                </b>
              </>
            );
          } else if (visit.status === VisitStatus.InRoom) {
            waitNode = (
              <>
                {dayScreenStrings.queueInRoomCellLabel}
                <b>{dayScreenStrings.queueWaitInRoomDash}</b>
              </>
            );
          } else if (isWaiting) {
            if (!hasEnoughDataForEstimate || avgConsultMinutes === null || summary.currentTurnPosition === null) {
              waitNode = dayScreenStrings.queueExpectedWaitUnknown;
            } else {
              const minutes = computeExpectedWaitMinutes(visit.position, summary.currentTurnPosition, avgConsultMinutes);
              waitNode = (
                <>
                  {dayScreenStrings.queueExpectedWaitPrefix}
                  <b>
                    <Ltr>{minutes}</Ltr> {dayScreenStrings.delayMinutesSuffix}
                  </b>
                </>
              );
            }
          }

          return (
            <QueueRow
              key={visit.id}
              visit={visit}
              patient={patient}
              service={service}
              kind={kind}
              metaPhrase={metaPhrase}
              waitNode={waitNode}
              actorLabel={actorLabelByVisitId.get(visit.id)}
              onPrimaryAction={advanceTarget ? () => onAdvance(visit, advanceTarget) : isCompleted ? openVisitForm : undefined}
              disablePrimaryAction={advancingVisitIds.has(visit.id)}
              onOpenVisitForm={showVisitFormPill ? openVisitForm : undefined}
              showEmptyFormHint={isCompleted && !formDataVisitIds.has(visit.id)}
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
      <CardFooter
        count={
          <>
            <Ltr>{sortedVisits.length}</Ltr> {dayScreenStrings.queueFooterCountInQueueSuffix}
            {" · "}
            <Ltr>{completedCount}</Ltr> {dayScreenStrings.queueFooterCountCompletedSuffix}
          </>
        }
      >
        {onOpenBooking && (
          <Button variant="primary" size="sm" onClick={onOpenBooking}>
            {dayScreenStrings.addToQueueButtonLabel}
          </Button>
        )}
        {onWalkIn && (
          <Button variant="secondary" size="sm" onClick={onWalkIn}>
            {dayScreenStrings.walkInButtonLabel}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
