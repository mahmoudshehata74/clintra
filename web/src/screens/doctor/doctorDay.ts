import type { Invoice, Patient, Service, Visit } from "../../db/types";
import type { VisitFormFieldValues } from "../../db/visitForm";
import { computeMedianConsultMinutes, computeRoundedMedian } from "../../domain/consultStats";
import { cairoYear, clockTimeInCairo, todayInCairo, type ClinicDay, type ClockTime } from "../../domain/time";
import { canTransitionVisitStatus } from "../../domain/transitions";
import { occupiesSlot, VisitStatus } from "../../domain/visitStatus";
import { selectDaySheetVisits } from "../day/daySheetVisits";
import { computeQueueExpectedFinishTime, computeQueueSummary } from "../day/queueSummary";
import { doctorDayStrings as T } from "./strings";

// Pure derivations behind the doctor's day (reference screen 9). Every
// function takes the practitioner's own visits for the day on screen (all
// statuses, already filtered to that one practitioner) plus whatever lookups
// it needs; none reads the database or the clock on its own.

/** A waiter above this many minutes gets `.wait-item.long` and counts as "فوق حد التنبيه". */
export const LONG_WAIT_MINUTES = 30;

/** At or below this many minutes behind the plan, the momentum bar reads "ماشي في الميعاد". */
export const ON_TIME_TOLERANCE_MINUTES = 5;

// Booked/confirmed/arrived: occupying the day but not yet seen.
const NOT_STARTED_STATUSES = new Set<VisitStatus>([VisitStatus.Booked, VisitStatus.Confirmed, VisitStatus.Arrived]);

function minutesBetween(fromIso: string, to: Date): number {
  return Math.round((to.getTime() - new Date(fromIso).getTime()) / 60_000);
}

/**
 * Time-relative figures (lateness, wait, expected finish) only mean
 * something while the day on screen is the real current day — the same
 * gate computeElapsedLabel applies to the day grid's own elapsed labels
 * (a ?seedDay=1 pin shows a past day against the real clock).
 */
function isLiveDay(today: ClinicDay, now: Date): boolean {
  return today === todayInCairo(now);
}

// ── Momentum bar (`.momentum`) ───────────────────────────────────────────

export interface MomentumSummary {
  /** Median length of today's recorded consultations, in minutes. */
  medianMinutes: number;
  /** Slots mode: median duration_minutes of the services booked today. Null in queue mode or when no visit has a service. */
  plannedMinutes: number | null;
  /** Slots mode, live day only: minutes behind the plan (0 when nothing is overdue). Null in queue mode or off the live day. */
  lateMinutes: number | null;
  /** True when lateMinutes is above ON_TIME_TOLERANCE_MINUTES — `.momentum` (warning) rather than `.momentum.ok`. */
  isLate: boolean;
  /** Slots mode: the median runs longer than the plan. */
  runsLongerThanPlan: boolean;
  /** now + one median per remaining turn (computeQueueExpectedFinishTime's rule). Null off the live day or with nobody left. */
  expectedFinish: ClockTime | null;
}

/**
 * The momentum bar's figures, or null while no consultation today has a
 * recorded length (the bar is hidden until then). Lateness is slots-only:
 * now minus the scheduled time of the earliest not-yet-started visit whose
 * time has already passed. Queue mode has no plan, so it carries only the
 * median and the expected finish.
 */
export function computeMomentum(
  visits: readonly Visit[],
  servicesById: ReadonlyMap<string, Service>,
  isQueueMode: boolean,
  today: ClinicDay,
  now: Date,
): MomentumSummary | null {
  const medianMinutes = computeMedianConsultMinutes(visits);
  if (medianMinutes === null) {
    return null;
  }
  const live = isLiveDay(today, now);

  let plannedMinutes: number | null = null;
  let lateMinutes: number | null = null;
  if (!isQueueMode) {
    const durations = visits
      .filter((visit) => visit.service_id !== null && occupiesSlot(visit.status))
      .map((visit) => servicesById.get(visit.service_id!)?.duration_minutes)
      .filter((minutes): minutes is number => minutes !== undefined);
    plannedMinutes = computeRoundedMedian(durations);

    if (live) {
      const overdue = visits
        .filter(
          (visit) =>
            NOT_STARTED_STATUSES.has(visit.status) &&
            visit.scheduled_at !== null &&
            new Date(visit.scheduled_at).getTime() <= now.getTime(),
        )
        .map((visit) => visit.scheduled_at!)
        .sort();
      lateMinutes = overdue.length > 0 ? Math.max(0, minutesBetween(overdue[0], now)) : 0;
    }
  }

  const waitingCount = visits.filter((visit) => NOT_STARTED_STATUSES.has(visit.status)).length;
  const inRoomCount = visits.filter((visit) => visit.status === VisitStatus.InRoom).length;

  return {
    medianMinutes,
    plannedMinutes,
    lateMinutes,
    isLate: lateMinutes !== null && lateMinutes > ON_TIME_TOLERANCE_MINUTES,
    runsLongerThanPlan: plannedMinutes !== null && medianMinutes > plannedMinutes,
    expectedFinish: live
      ? computeQueueExpectedFinishTime(waitingCount, inRoomCount, medianMinutes, now.toISOString())
      : null,
  };
}

// ── Current and next patient (`.doc-hero`, `.brief`) ─────────────────────

/** The visit in the room now — the earliest started if more than one somehow is. */
export function findCurrentVisit(visits: readonly Visit[]): Visit | null {
  const inRoom = visits
    .filter((visit) => visit.status === VisitStatus.InRoom)
    .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
  return inRoom[0] ?? null;
}

export interface NextPatient {
  visit: Visit;
  /** Physically here: "مستني في الاستقبال" rather than "لسه ما وصلش". */
  hasArrived: boolean;
}

/**
 * Who goes in next. Queue mode: the waiting visit with the lowest position
 * (computeQueueSummary's own "التالي"). Slots mode: the earliest-scheduled
 * visit among those already arrived, else among those still booked or
 * confirmed — someone in the waiting room is ahead of someone not yet here,
 * whatever their times.
 */
export function findNextPatient(visits: readonly Visit[], isQueueMode: boolean): NextPatient | null {
  let next: Visit | null;
  if (isQueueMode) {
    const nextVisitId = computeQueueSummary(visits).nextVisitId;
    next = visits.find((visit) => visit.id === nextVisitId) ?? null;
  } else {
    const byTime = (a: Visit, b: Visit) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "");
    const arrived = visits.filter((visit) => visit.status === VisitStatus.Arrived).sort(byTime);
    const notYetHere = visits
      .filter((visit) => visit.status === VisitStatus.Booked || visit.status === VisitStatus.Confirmed)
      .sort(byTime);
    next = arrived[0] ?? notYetHere[0] ?? null;
  }
  return next ? { visit: next, hasArrived: next.status === VisitStatus.Arrived } : null;
}

/** True when the visit's status allows the move to in_room (transitions.ts) — the only statuses that get a call button. */
export function canCallIn(visit: Visit): boolean {
  return canTransitionVisitStatus(visit.status, VisitStatus.InRoom);
}

// ── Patient history (`.last-visit`, `.brief-hist`) ───────────────────────

// A completed visit counts as "before" the current one when it is not the
// current one and falls on or before its day: the current visit is never
// itself completed while it is the subject of these lines (it is waiting
// or in the room), so a completed visit on the same day already ended.
function priorCompletedVisits(patientVisits: readonly Visit[], current: Visit): Visit[] {
  return patientVisits.filter(
    (visit) =>
      visit.id !== current.id &&
      visit.patient_id === current.patient_id &&
      visit.status === VisitStatus.Completed &&
      visit.visit_date <= current.visit_date,
  );
}

/** How many completed visits this patient had before the current one — optionally only with one practitioner. */
export function countPriorCompletedVisits(
  patientVisits: readonly Visit[],
  current: Visit,
  practitionerId?: string,
): number {
  return priorCompletedVisits(patientVisits, current).filter(
    (visit) => practitionerId === undefined || visit.practitioner_id === practitionerId,
  ).length;
}

/** The patient's most recent completed visit before the current one, with any practitioner; null when there is none. */
export function findLastCompletedVisit(patientVisits: readonly Visit[], current: Visit): Visit | null {
  const prior = priorCompletedVisits(patientVisits, current).sort(
    (a, b) => a.visit_date.localeCompare(b.visit_date) || (a.ended_at ?? "").localeCompare(b.ended_at ?? ""),
  );
  return prior[prior.length - 1] ?? null;
}

export interface LastVisitSummary {
  visit: Visit;
  /** "قبل 3 أسابيع", "من شهرين"… — see formatRelativeVisitTime. */
  relativeTime: string;
  /** Null when empty, so the part is omitted rather than rendered blank. */
  complaint: string | null;
  diagnosis: string | null;
}

/** The last-visit block's content, or null (block omitted) when the patient has no prior completed visit. */
export function summarizeLastVisit(
  patientVisits: readonly Visit[],
  current: Visit,
  formValuesByVisitId: ReadonlyMap<string, VisitFormFieldValues>,
  today: ClinicDay,
): LastVisitSummary | null {
  const last = findLastCompletedVisit(patientVisits, current);
  if (!last) {
    return null;
  }
  const values = formValuesByVisitId.get(last.id);
  return {
    visit: last,
    relativeTime: formatRelativeVisitTime(last.visit_date, today),
    complaint: nonEmpty(values?.complaint),
    diagnosis: nonEmpty(values?.diagnosis),
  };
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export type LastInvoiceState = "paid" | "partial" | "unpaid";

/** The patient's most recent non-void invoice, as a state — null when there is none. */
export function findLastInvoiceState(patientInvoices: readonly Invoice[]): LastInvoiceState | null {
  const latest = patientInvoices
    .filter((invoice) => invoice.status !== "void")
    .sort((a, b) => a.issued_at.localeCompare(b.issued_at))
    .at(-1);
  return latest ? (latest.status as LastInvoiceState) : null;
}

export function lastInvoiceStateLabel(state: LastInvoiceState): string {
  return state === "paid" ? T.invoicePaid : state === "partial" ? T.invoicePartial : T.invoiceUnpaid;
}

// ── Waiting room (`.wait-item`) ──────────────────────────────────────────

export interface WaitingRow {
  visit: Visit;
  /** Minutes since arrival (arrived_at, else created_at). Null off the live day. */
  waitedMinutes: number | null;
  /** waitedMinutes above LONG_WAIT_MINUTES. */
  isLong: boolean;
}

export interface WaitingRoom {
  rows: WaitingRow[];
  /** The longest wait, or null with nobody waiting (or off the live day). */
  longestMinutes: number | null;
  /** How many rows are above LONG_WAIT_MINUTES. */
  longCount: number;
}

/**
 * Patients physically present and not yet called in — status arrived — in
 * the day screen's own order. The wait runs from arrived_at; a row without
 * one (none is written that way today: every write path that sets arrived,
 * a queue walk-in's addToQueue included, stamps arrived_at in the same
 * write) falls back to created_at.
 */
export function computeWaitingRoom(
  visits: readonly Visit[],
  isQueueMode: boolean,
  today: ClinicDay,
  now: Date,
): WaitingRoom {
  const live = isLiveDay(today, now);
  const rows = orderLikeDayScreen(visits.filter((visit) => visit.status === VisitStatus.Arrived), isQueueMode).map(
    (visit): WaitingRow => {
      const waitedMinutes = live ? Math.max(0, minutesBetween(visit.arrived_at ?? visit.created_at, now)) : null;
      return { visit, waitedMinutes, isLong: waitedMinutes !== null && waitedMinutes > LONG_WAIT_MINUTES };
    },
  );
  const waits = rows.map((row) => row.waitedMinutes).filter((minutes): minutes is number => minutes !== null);
  return {
    rows,
    longestMinutes: waits.length > 0 ? Math.max(...waits) : null,
    longCount: rows.filter((row) => row.isLong).length,
  };
}

/** "مستنية" for a patient recorded as female, "مستني" otherwise (male or unknown). */
export function waitingWord(patient: Pick<Patient, "gender"> | undefined): string {
  return patient?.gender === "female" ? T.waitingWordFemale : T.waitingWordNeutral;
}

// ── Attention card (`.attn`) ─────────────────────────────────────────────

export type AttentionItem =
  | { kind: "missing_diagnosis"; visit: Visit }
  | { kind: "unpaid_invoice"; visit: Visit; invoiceStatus: "unpaid" | "partial" };

/**
 * Two kinds only: today's completed visits with an empty diagnosis, then
 * today's completed visits whose invoice is unpaid or partially paid (a void
 * invoice is not owed). Each kind in the order the visits ended.
 */
export function computeAttentionItems(
  visits: readonly Visit[],
  formValuesByVisitId: ReadonlyMap<string, VisitFormFieldValues>,
  invoicesByVisitId: ReadonlyMap<string, Invoice>,
): AttentionItem[] {
  const completed = visits
    .filter((visit) => visit.status === VisitStatus.Completed)
    .sort((a, b) => (a.ended_at ?? "").localeCompare(b.ended_at ?? ""));

  const missingDiagnosis: AttentionItem[] = completed
    .filter((visit) => nonEmpty(formValuesByVisitId.get(visit.id)?.diagnosis) === null)
    .map((visit) => ({ kind: "missing_diagnosis", visit }));

  const unpaid: AttentionItem[] = [];
  for (const visit of completed) {
    const status = invoicesByVisitId.get(visit.id)?.status;
    if (status === "unpaid" || status === "partial") {
      unpaid.push({ kind: "unpaid_invoice", visit, invoiceStatus: status });
    }
  }
  return [...missingDiagnosis, ...unpaid];
}

/** True when this completed visit has no diagnosis recorded — the day list's own warning phrase. */
export function hasMissingDiagnosis(
  visit: Visit,
  formValuesByVisitId: ReadonlyMap<string, VisitFormFieldValues>,
): boolean {
  return visit.status === VisitStatus.Completed && nonEmpty(formValuesByVisitId.get(visit.id)?.diagnosis) === null;
}

// ── Full day list (`.doc-list`) ──────────────────────────────────────────

// selectDaySheetVisits keeps occupying statuses only and orders by
// scheduled_at (slots) or position (queue); sorting by position first makes
// its stable sort break slot-time ties (overbooked extras) by position, the
// way the day grid (dayGrid.ts) does.
function orderLikeDayScreen(visits: readonly Visit[], isQueueMode: boolean): Visit[] {
  return selectDaySheetVisits(
    [...visits].sort((a, b) => a.position - b.position),
    isQueueMode,
  );
}

/**
 * "كل اليوم": every visit still occupying the day (booked through
 * completed), ordered as the day screen orders them. Cancelled, no-show and
 * rescheduled are left out: they are no longer part of the doctor's day,
 * have no action here, and the day sheet drops them for the same reason.
 */
export function computeDayList(visits: readonly Visit[], isQueueMode: boolean): Visit[] {
  return orderLikeDayScreen(visits, isQueueMode);
}

/** The day list's per-row action: review a finished visit, open the one in the room, or call a waiting one in. */
export type DayListAction = "review" | "open" | "call" | null;

export function dayListAction(visit: Visit): DayListAction {
  if (visit.status === VisitStatus.Completed) {
    return "review";
  }
  if (visit.status === VisitStatus.InRoom) {
    return "open";
  }
  return canCallIn(visit) ? "call" : null;
}

// ── Small formatting helpers ─────────────────────────────────────────────

/** Age in whole years as of the current Cairo year; null when birth_year is unknown. */
export function computeAge(birthYear: number | null, now: Date): number | null {
  return birthYear === null ? null : cairoYear(now.toISOString()) - birthYear;
}

export interface CountForms {
  one: string;
  two: string;
  few: string;
  many: string;
}

/**
 * A counted Arabic noun: singular for 1, dual for 2, plural for 3–10 and
 * the singular again from 11 up ("11 زيارة"). The numeral is the caller's
 * to render (it is usually bold), so this returns the noun only.
 */
export function countNoun(count: number, forms: CountForms): string {
  if (count === 1) {
    return forms.one;
  }
  if (count === 2) {
    return forms.two;
  }
  return count >= 3 && count <= 10 ? forms.few : forms.many;
}

export const PRIOR_VISIT_FORMS: CountForms = {
  one: T.priorVisitOne,
  two: T.priorVisitTwo,
  few: T.priorVisitFew,
  many: T.priorVisitMany,
};
export const VISIT_FORMS: CountForms = { one: T.visitOne, two: T.visitTwo, few: T.visitFew, many: T.visitMany };
export const PATIENT_FORMS: CountForms = {
  one: T.patientOne,
  two: T.patientTwo,
  few: T.patientFew,
  many: T.patientMany,
};

function daysBetween(from: ClinicDay, to: ClinicDay): number {
  const toUtc = (day: ClinicDay) => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/**
 * How long ago a past visit day was: days under two weeks ("قبل يوم",
 * "قبل يومين", "قبل 5 أيام", "قبل 12 يوم"), weeks under 60 days ("قبل
 * أسبوعين", "قبل 6 أسابيع"), months after that ("من شهرين", "من 5 شهور",
 * "من 14 شهر"). The singular and dual carry no numeral, as spoken. Same day
 * reads "النهارده".
 */
export function formatRelativeVisitTime(day: ClinicDay, today: ClinicDay): string {
  const days = Math.max(0, daysBetween(day, today));
  if (days === 0) {
    return T.relativeToday;
  }
  if (days < 14) {
    if (days === 1) {
      return `${T.relativeAgo} ${T.dayOne}`;
    }
    if (days === 2) {
      return `${T.relativeAgo} ${T.dayTwo}`;
    }
    return `${T.relativeAgo} ${days} ${days <= 10 ? T.dayFew : T.dayMany}`;
  }
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return weeks === 2 ? `${T.relativeAgo} ${T.weekTwo}` : `${T.relativeAgo} ${weeks} ${T.weekFew}`;
  }
  const months = Math.floor(days / 30);
  if (months === 2) {
    return `${T.relativeSince} ${T.monthTwo}`;
  }
  return `${T.relativeSince} ${months} ${months <= 10 ? T.monthFew : T.monthMany}`;
}

/** A visit's finishing clock time, for "خلصت 09:28" / "اتقفلت الساعة 09:28". */
export function endedAtClock(visit: Visit): ClockTime | null {
  return visit.ended_at ? clockTimeInCairo(visit.ended_at) : null;
}
