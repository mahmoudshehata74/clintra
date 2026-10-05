import { useEffect, useState } from "react";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Ltr from "../../components/Ltr";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import { clockTimeInCairo, type ClinicDay } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Service, Visit } from "../../db/types";
import { computeActorRecency } from "./actorRecency";
import { dayScreenStrings } from "./strings";
import { STATUS_LABEL, statusVisual } from "./statusStyle";
import VisitMenu, { type VisitMenuActions } from "./VisitMenu";

interface SlotRowProps {
  time: string;
  showTime?: boolean;
  visit?: Visit;
  patient?: Patient;
  service?: Service;
  /** True for every visit after the first sharing this clock time (only reachable through the overbook flow). */
  isExtraAtTime?: boolean;
  /** Present only when a single tap on this row does something (see visitActions.ts). */
  onPrimaryAction?: () => void;
  /** True while this row's visit is in its post-tap cooldown — see advanceCooldown.ts. Never affects the empty-slot action, which never advances a visit. */
  disablePrimaryAction?: boolean;
  /** Present only when this row's visit is eligible for the overflow menu. */
  menu?: VisitMenuActions;
  /** Present only for a genuinely (or visually) empty slot when booking is currently possible. */
  onTapEmptySlot?: () => void;
  /** Resolved "recorded by" label for the visit's created_by membership — see actorLabel.ts. */
  actorLabel?: string;
  /** Today, for the actor byline's "· أمس" / short-date suffix — see actorRecency.ts. */
  today: ClinicDay;
  /** Present only when this row's visit is in_room or completed — opens the visit form sheet (see VisitFormSheet.tsx). */
  onOpenVisitForm?: () => void;
  /** True for a completed visit with no visit_form_data row at all — a passive note, never a warning. */
  showEmptyFormHint?: boolean;
}

const REOPENED_STATUSES = new Set<string>([VisitStatus.Cancelled, VisitStatus.NoShow]);

/** The `.until` sub-line's own text per status — arrived/in_room/completed/no_show only. */
function untilText(visit: Visit): string | null {
  if (visit.status === VisitStatus.Arrived && visit.arrived_at) {
    return `${dayScreenStrings.untilArrivedPrefix} ${clockTimeInCairo(visit.arrived_at)}`;
  }
  if (visit.status === VisitStatus.InRoom && visit.started_at) {
    return `${dayScreenStrings.untilSincePrefix} ${minutesSince(visit.started_at)}${dayScreenStrings.minutesShortUnit}`;
  }
  if (visit.status === VisitStatus.Completed && visit.started_at && visit.ended_at) {
    const minutes = Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60_000);
    return `${minutes}${dayScreenStrings.minutesShortUnit}`;
  }
  if (visit.status === VisitStatus.NoShow && visit.scheduled_at) {
    return `${dayScreenStrings.untilSincePrefix} ${minutesSince(visit.scheduled_at)}${dayScreenStrings.minutesShortUnit}`;
  }
  return null;
}

function minutesSince(instant: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(instant).getTime()) / 60_000));
}

// in_room and no_show are the two statuses whose `.until` text is a live
// "minutes since" count, so only they need the minute tick below.
const LIVE_UNTIL_STATUSES = new Set<string>([VisitStatus.InRoom, VisitStatus.NoShow]);

/**
 * One row of the day grid (prototype `.slot`, #s2): time | patient | status
 * pill, with a 3px left accent stripe carrying the status colour
 * (statusStyle.ts). The row's primary button still covers the time+patient
 * area and keeps its exact advance/open-form/cooldown behaviour from before
 * this task; the overflow menu and visit-form pill sit in their own trailing
 * column, under the status pill.
 */
export default function SlotRow({
  time,
  showTime = true,
  visit,
  patient,
  service,
  isExtraAtTime = false,
  onPrimaryAction,
  disablePrimaryAction = false,
  menu,
  onTapEmptySlot,
  actorLabel,
  today,
  onOpenVisitForm,
  showEmptyFormHint = false,
}: SlotRowProps) {
  const visual = visit ? statusVisual(visit.status) : null;
  const handleClick = onPrimaryAction ?? onTapEmptySlot;
  const isTappable = Boolean(handleClick);

  // `.until`'s "minutes since" text (in_room/no_show) is wall-clock-derived,
  // so nothing re-renders it on its own — this tick forces one every minute.
  const [, forceMinuteTick] = useState(0);
  useEffect(() => {
    if (!visit || !LIVE_UNTIL_STATUSES.has(visit.status)) {
      return;
    }
    const interval = setInterval(() => forceMinuteTick((tick) => tick + 1), 60_000);
    return () => clearInterval(interval);
  }, [visit?.status]);

  if (!visual || !visit) {
    return (
      <li className="relative grid grid-cols-[60px_1fr_auto] items-center gap-3.5 border-b border-hair px-[18px] py-2.5 last:border-b-0 before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-transparent before:content-[''] hover:bg-field">
        <span className="text-sm font-medium leading-none tracking-[-0.02em] text-faint tabular-nums">
          {showTime && <Ltr>{time}</Ltr>}
        </span>
        <span className="text-xs text-faint">{dayScreenStrings.emptySlotFreeLabel}</span>
        {isTappable ? (
          <Button
            variant="dashed"
            onClick={handleClick}
            aria-label={dayScreenStrings.emptySlot}
            data-slot-time={time}
          >
            {dayScreenStrings.emptySlotQuickActionLabel}
          </Button>
        ) : (
          <span className="text-[11.5px] font-semibold text-faint" aria-hidden="true">
            {dayScreenStrings.emptySlotQuickActionLabel}
          </span>
        )}
      </li>
    );
  }

  const phoneDisplay = patient?.phone ? formatEgyptianPhoneForDisplay(patient.phone) : null;
  const recency = computeActorRecency(visit.created_at, today);
  const until = untilText(visit);

  const timeBlock = (
    <span className={`text-sm font-bold leading-none tracking-[-0.02em] tabular-nums ${visual.timeClassName}`}>
      {showTime && <Ltr>{time}</Ltr>}
      {until && <span className={`mt-[3px] block text-[10px] font-medium ${visual.untilClassName}`}>{until}</span>}
    </span>
  );

  const whoBlock = (
    <span className="flex min-w-0 flex-col gap-px">
      <span className={`truncate text-sm font-semibold leading-[1.3] tracking-[-0.005em] ${visual.nameClassName}`}>
        {patient?.full_name}
      </span>
      <span className={`flex flex-wrap items-center gap-1.5 text-[11px] ${visual.metaClassName}`}>
        {isExtraAtTime && (
          <Badge appearance="soft" tone="neutral">
            {dayScreenStrings.overbookedRowBadge}
          </Badge>
        )}
        {service && <span>{service.name}</span>}
        {phoneDisplay && (
          <>
            <span aria-hidden="true" className="h-[3px] w-[3px] flex-none rounded-full bg-faint" />
            <Ltr className="font-mono text-[10.5px] tracking-[0.02em]">{phoneDisplay}</Ltr>
          </>
        )}
        {REOPENED_STATUSES.has(visit.status) && <span>{dayScreenStrings.slotAvailableAgain}</span>}
      </span>
      {actorLabel && (
        <span className="mt-0.5 text-[10px] text-faint">
          {dayScreenStrings.recordedByPrefix} {actorLabel}
          {recency?.kind === "yesterday" && ` · ${dayScreenStrings.actorYesterdaySuffix}`}
          {recency?.kind === "earlier" && (
            <>
              {" · "}
              <Ltr>{`${recency.day}/${recency.month}`}</Ltr>
            </>
          )}
        </span>
      )}
      {showEmptyFormHint && <span className="text-[10px] text-muted">{dayScreenStrings.visitFormEmptyHint}</span>}
    </span>
  );

  return (
    <li
      data-visit-row-id={visit.id}
      className={`relative flex items-center gap-3.5 border-b border-hair px-[18px] py-3 transition-colors duration-150 last:border-b-0 before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:content-[''] hover:bg-field ${visual.stripeClassName} ${visual.rowBgClassName}`}
    >
      {isTappable ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={onPrimaryAction ? disablePrimaryAction : undefined}
          className="grid flex-1 grid-cols-[60px_1fr] items-center gap-3.5 text-start"
        >
          {timeBlock}
          {whoBlock}
        </button>
      ) : (
        <div className="grid flex-1 grid-cols-[60px_1fr] items-center gap-3.5 text-start">
          {timeBlock}
          {whoBlock}
        </div>
      )}
      <div className="flex flex-none flex-col items-end gap-1">
        <Badge {...visual.badge} shape="pill">
          {STATUS_LABEL[visit.status]}
        </Badge>
        {(onOpenVisitForm || menu) && (
          <div className="flex items-center gap-1">
            {onOpenVisitForm && (
              <button
                type="button"
                onClick={onOpenVisitForm}
                className="shrink-0 rounded-chip bg-field px-2 py-0.5 text-xs text-muted hover:bg-green-wash hover:text-green"
              >
                {dayScreenStrings.visitFormPillLabel}
              </button>
            )}
            {menu && <VisitMenu actions={menu} />}
          </div>
        )}
      </div>
    </li>
  );
}
