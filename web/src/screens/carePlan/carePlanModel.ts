import { CarePlanError, type CarePlanSessionGroup } from "../../db/carePlans";
import type { CarePlan, CarePlanItem, Invoice, Payment, Service, Visit } from "../../db/types";
import { type ArabicCountForms } from "../../domain/arabicText";
import {
  carePlanEndDate,
  carePlanPaid,
  carePlanStalledDays,
  carePlanStalledLabel,
  CarePlanSessionState,
  countedSessions,
  deriveCarePlanSessions,
  isCarePlanCompleted,
  isCarePlanOngoing,
  type CarePlanSession,
} from "../../domain/carePlan";
import type { Piastres } from "../../domain/money";
import { addDaysToClinicDay, clockTimeInCairo, todayInCairo, type ClinicDay, type Instant } from "../../domain/time";
import { CarePlanStatus } from "../../db/types";
import { VisitStatus } from "../../domain/visitStatus";
import { formatMoneyAmount } from "../money";
import { countPhrase } from "../visit/workspace";
import { carePlanStrings as T } from "./strings";

// Pure derivations behind the care plan sheet (reference screen 17), its
// create and edit forms, and screen 10's `.plan-badge`. None reads the
// database or the clock on its own: the caller passes the rows and today.

export const SESSION_COUNT_FORMS: ArabicCountForms = {
  one: T.sessionsOne,
  two: T.sessionsTwo,
  few: T.sessionsFew,
  many: T.sessionsMany,
};

// ── Formatting ───────────────────────────────────────────────────────────

/** "27 / 10" */
export function formatDayMonth(day: ClinicDay): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} / ${month}`;
}

/** "27 / 10 / 2026" */
export function formatFullDate(day: ClinicDay): string {
  const [year] = day.split("-");
  return `${formatDayMonth(day)} / ${year}`;
}

/** A visit's booked time as "h:mm" (the app's 24-hour clock, no leading zero): "9:30", "16:30". */
export function formatShortClock(instant: Instant): string {
  return clockTimeInCairo(instant).replace(/^0(\d)/, "$1");
}

/** An amount of money as the screen shows it: "2,500 ج.م". */
export function formatPlanMoney(piastres: Piastres): string {
  return `${formatMoneyAmount(piastres)} ${T.currencyUnit}`;
}

/** "10 جلسات", "جلسة واحدة", "جلستين" (arabicCount, Latin digits). */
export function sessionCountPhrase(count: number): string {
  return countPhrase(count, SESSION_COUNT_FORMS);
}

// ── The sheet ────────────────────────────────────────────────────────────

/** Everything the sheet reads for one plan. */
export interface CarePlanSheetSource {
  plan: CarePlan;
  items: readonly CarePlanItem[];
  /** The visits the plan's sessions link to (others are ignored). */
  visits: readonly Visit[];
  services: readonly Service[];
  patientName: string;
  practitionerName: string;
  invoices: readonly Pick<Invoice, "id" | "visit_id">[];
  payments: readonly Pick<Payment, "invoice_id" | "amount">[];
}

/** A `.meta` part: `<b>` when strong. */
export interface MetaPart {
  text: string;
  strong: boolean;
}

/** `.plan-session` (done), `.plan-session.next`, plain (booked, suggested), and the muted skipped row. */
export type SessionTone = "done" | "next" | "booked" | "suggested" | "skipped";

export interface SessionRow {
  itemId: string;
  /** `.n` — the session's sequence. */
  n: number;
  /** `.name` — the service's name, or "جلسة {n}" without one. */
  name: string;
  /** `.meta`, its parts joined by " · "; empty for an undated or skipped session. */
  meta: MetaPart[];
  tone: SessionTone;
  /** `.st` */
  statusLabel: string;
  /** "أجّل" / "رجّع" — the plan's practitioner only, on a suggested or skipped session. */
  action: { kind: "skip" | "unskip"; label: string } | null;
}

export type CarePlanStatusLine = { kind: "stalled" | "stopped" | "completed"; text: string } | null;

/** "احجز الجلسة التالية": the session it books and the day it suggests, or why it is disabled. */
export interface BookNextState {
  itemId: string;
  serviceId: string;
  /** The session's display date, or today when it has none or it has passed. */
  date: ClinicDay;
  /** "الجلسة التالية محجوزة 27 / 10 · 9:30" while the next session is already booked; null when it can be booked. */
  disabledReason: string | null;
}

export interface ReminderState {
  /** The first booked session's visit — what the reminder is about. */
  visitId: string | null;
  disabledReason: string | null;
}

export interface CarePlanSheetModel {
  /** `.avatar` */
  initial: string;
  patientName: string;
  goal: string;
  diagnosis: string;
  /** `.kbd`: "10 جلسات" */
  countLabel: string;
  done: number;
  count: number;
  /** `.plan-prog-h b`: "5 / 10 جلسة" */
  progressLabel: string;
  /** `.plan-bar span`'s width, 0–100. */
  progressPercent: number;
  startedOn: string;
  expectedEnd: string;
  total: string;
  paid: string;
  statusLine: CarePlanStatusLine;
  /** The sessions card's `.c-head .sub`: "5 جلسات تمّت · 5 متبقية" */
  sessionsSubtitle: string;
  rows: SessionRow[];
  /** "عدّل الخطة" and the rows' skip actions: the plan's own practitioner only. */
  canEdit: boolean;
  /** Null when the button is absent: the plan is stopped or completed, or every session left is skipped. */
  book: BookNextState | null;
  reminder: ReminderState;
}

function cairoDay(instant: Instant): ClinicDay {
  return todayInCairo(new Date(instant));
}

function servicesById(services: readonly Service[]): Map<string, Service> {
  return new Map(services.map((service) => [service.id, service]));
}

/** The plan's sessions, derived (domain/carePlan.ts) from the rows the sheet reads. */
export function derivePlanSessions(
  items: readonly CarePlanItem[],
  visits: readonly Visit[],
  services: readonly Service[],
): CarePlanSession[] {
  return deriveCarePlanSessions(
    items,
    new Map(visits.map((visit) => [visit.id, visit])),
    new Map(services.map((service) => [service.id, service.name])),
  );
}

/** The first session not skipped and not done: the one "احجز الجلسة التالية" is about. */
function nextOpenSession(sessions: readonly CarePlanSession[]): CarePlanSession | null {
  return countedSessions(sessions).find((session) => session.state !== CarePlanSessionState.Done) ?? null;
}

/** "27 / 10 · 9:30" — the day, and the time when the visit has one. */
function bookedWhen(session: CarePlanSession, visit: Visit | null): string {
  const day = session.date === null ? "" : formatDayMonth(session.date);
  return visit?.scheduled_at ? `${day} · ${formatShortClock(visit.scheduled_at)}` : day;
}

function sessionMeta(
  session: CarePlanSession,
  visit: Visit | null,
  service: Service | undefined,
  practitionerName: string,
): MetaPart[] {
  if (session.date === null) {
    return [];
  }
  const date = { text: formatDayMonth(session.date), strong: false };
  if (session.state === CarePlanSessionState.Suggested) {
    return [date, { text: T.suggestedMeta, strong: true }];
  }
  const parts: MetaPart[] = [date];
  if (session.state === CarePlanSessionState.Booked && visit?.scheduled_at) {
    parts.push({ text: formatShortClock(visit.scheduled_at), strong: false });
  }
  parts.push({ text: `${T.doctorPrefix} ${practitionerName}`, strong: true });
  if (service) {
    parts.push({ text: `${service.duration_minutes} ${T.minutesUnit}`, strong: false });
  }
  return parts;
}

/**
 * Screen 17 for one plan, as the acting membership sees it: the hero, the
 * progress and legs, the status line, one row per session, and the state of
 * the three `.split` actions.
 */
export function buildCarePlanSheet(
  source: CarePlanSheetSource,
  today: ClinicDay,
  actingPractitionerId: string | null,
): CarePlanSheetModel {
  const { plan } = source;
  const services = servicesById(source.services);
  const sessions = derivePlanSessions(source.items, source.visits, source.services);
  const visitsById = new Map(source.visits.map((visit) => [visit.id, visit]));
  // The full row of the visit a session's derivation kept (it keeps only a booking or done visit).
  const visitOf = (session: CarePlanSession): Visit | null => (session.visit ? (visitsById.get(session.visit.id) ?? null) : null);
  const counted = countedSessions(sessions);
  const done = counted.filter((session) => session.state === CarePlanSessionState.Done).length;
  const count = counted.length;
  const completed = isCarePlanCompleted(sessions);
  const canEdit = actingPractitionerId !== null && actingPractitionerId === plan.practitioner_id;
  const firstBooked = sessions.find((session) => session.state === CarePlanSessionState.Booked) ?? null;

  const rows = sessions.map((session): SessionRow => {
    const service = services.get(session.item.service_id);
    const isFirstBooked = firstBooked !== null && session.item.id === firstBooked.item.id;
    const tone: SessionTone =
      session.state === CarePlanSessionState.Done
        ? "done"
        : session.state === CarePlanSessionState.Booked
          ? isFirstBooked
            ? "next"
            : "booked"
          : session.state === CarePlanSessionState.Suggested
            ? "suggested"
            : "skipped";
    const statusLabel = {
      done: T.stateDone,
      next: T.stateNext,
      booked: T.stateBooked,
      suggested: T.stateSuggested,
      skipped: T.stateSkipped,
    }[tone];
    const action =
      !canEdit
        ? null
        : tone === "suggested"
          ? { kind: "skip" as const, label: T.skipAction }
          : tone === "skipped"
            ? { kind: "unskip" as const, label: T.unskipAction }
            : null;
    return {
      itemId: session.item.id,
      n: session.item.sequence,
      name: session.label === "" ? session.fallbackLabel : session.label,
      meta: sessionMeta(session, visitOf(session), service, source.practitionerName),
      tone,
      statusLabel,
      action,
    };
  });

  const stalledDays = carePlanStalledDays(plan, sessions, today);
  const statusLine: CarePlanStatusLine = completed
    ? { kind: "completed", text: T.completedLine }
    : plan.status === CarePlanStatus.Stopped
      ? { kind: "stopped", text: T.stoppedLine }
      : stalledDays !== null
        ? { kind: "stalled", text: carePlanStalledLabel(stalledDays) }
        : null;

  const next = nextOpenSession(sessions);
  let book: BookNextState | null = null;
  if (plan.status === CarePlanStatus.Active && !completed && next !== null) {
    const suggested = next.date === null || next.date < today ? today : next.date;
    book = {
      itemId: next.item.id,
      serviceId: next.item.service_id,
      date: suggested,
      disabledReason: next.state === CarePlanSessionState.Booked ? `${T.nextBookedPrefix} ${bookedWhen(next, visitOf(next))}` : null,
    };
  }

  const endDate = carePlanEndDate(sessions);
  return {
    initial: source.patientName.trim().charAt(0),
    patientName: source.patientName,
    goal: plan.goal,
    diagnosis: plan.diagnosis,
    countLabel: sessionCountPhrase(count),
    done,
    count,
    progressLabel: `${done} / ${count} ${T.progressUnit}`,
    progressPercent: count === 0 ? 0 : Math.round((done / count) * 100),
    startedOn: formatFullDate(cairoDay(plan.started_at)),
    expectedEnd: endDate === null ? T.noDate : formatFullDate(endDate),
    total: formatPlanMoney(plan.total_price),
    paid: formatPlanMoney(carePlanPaid(source.items, source.invoices, source.payments)),
    statusLine,
    sessionsSubtitle: `${sessionCountPhrase(done)} ${T.doneSuffix} · ${count - done} ${T.remainingSuffix}`,
    rows,
    canEdit,
    book,
    reminder: firstBooked?.visit
      ? { visitId: firstBooked.visit.id, disabledReason: null }
      : { visitId: null, disabledReason: T.bookFirst },
  };
}

// ── Screen 10's entry points ─────────────────────────────────────────────

export interface PlanWithSessions {
  plan: CarePlan;
  sessions: CarePlanSession[];
}

/** The patient's plan under way with this practitioner (active, not completed), or null. */
export function ongoingPlanFor(
  plans: readonly PlanWithSessions[],
  patientId: string,
  practitionerId: string,
): PlanWithSessions | null {
  return (
    plans
      .filter(
        ({ plan, sessions }) =>
          plan.patient_id === patientId && plan.practitioner_id === practitionerId && isCarePlanOngoing(plan, sessions),
      )
      .sort((a, b) => b.plan.started_at.localeCompare(a.plan.started_at))[0] ?? null
  );
}

/**
 * `.plan-badge .p`: "جلسة {n} من {count}" — n the place, among the sessions
 * not skipped, of the session this visit books, else the number of done
 * sessions plus one (at most count).
 */
export function carePlanBadgeProgress(sessions: readonly CarePlanSession[], visitId: string): string {
  const counted = countedSessions(sessions);
  const linked = counted.findIndex((session) => session.item.visit_id === visitId);
  const done = counted.filter((session) => session.state === CarePlanSessionState.Done).length;
  const n = linked >= 0 ? linked + 1 : Math.min(done + 1, counted.length);
  return `جلسة ${n} من ${counted.length}`;
}

/** "ابدأ خطة رعاية": the visit's own practitioner, on a visit in the room or completed, with no plan under way. */
export function canStartCarePlan(
  actingPractitionerId: string | null,
  visit: Pick<Visit, "practitioner_id" | "status">,
  hasOngoingPlan: boolean,
): boolean {
  return (
    actingPractitionerId !== null &&
    actingPractitionerId === visit.practitioner_id &&
    (visit.status === VisitStatus.InRoom || visit.status === VisitStatus.Completed) &&
    !hasOngoingPlan
  );
}

// ── The create and edit forms ────────────────────────────────────────────

/** One group of sessions as typed: the numbers stay text until validated. */
export interface DraftGroup {
  /** A stable key for the list while groups are added and removed. */
  key: string;
  serviceId: string;
  count: string;
  gap: string;
}

export interface GroupErrors {
  serviceId?: string;
  count?: string;
  gap?: string;
}

export interface DraftErrors {
  goal?: string;
  diagnosis?: string;
  groups: GroupErrors[];
}

export type DraftValidation =
  | { ok: true; groups: CarePlanSessionGroup[]; errors: DraftErrors }
  | { ok: false; errors: DraftErrors };

const ARABIC_INDIC_ZERO = 0x0660;

/** A whole number of at least `min` as typed (Arabic-Indic digits accepted), or null. */
export function parseWholeNumber(text: string, min: number): number | null {
  const latin = text.trim().replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO));
  if (!/^\d+$/.test(latin)) {
    return null;
  }
  const value = Number(latin);
  return value >= min ? value : null;
}

function validateGroup(group: DraftGroup, activeServiceIds: ReadonlySet<string>): { errors: GroupErrors; parsed: CarePlanSessionGroup | null } {
  const count = parseWholeNumber(group.count, 1);
  const gapDays = parseWholeNumber(group.gap, 0);
  const errors: GroupErrors = {};
  if (!activeServiceIds.has(group.serviceId)) {
    errors.serviceId = T.errorServiceRequired;
  }
  if (count === null) {
    errors.count = T.errorCountInvalid;
  }
  if (gapDays === null) {
    errors.gap = T.errorGapInvalid;
  }
  const parsed = count !== null && gapDays !== null && !errors.serviceId ? { serviceId: group.serviceId, count, gapDays } : null;
  return { errors, parsed };
}

/**
 * The create form's checks, as the writer makes them (db/carePlans.ts):
 * goal and diagnosis required, each group a service on offer, a count of
 * at least 1 and a gap of at least 0 days. `requireDetails` is false for
 * the edit form's added sessions alone.
 */
export function validateCarePlanDraft(
  draft: { goal: string; diagnosis: string; groups: readonly DraftGroup[] },
  activeServiceIds: ReadonlySet<string>,
  requireDetails = true,
): DraftValidation {
  const errors: DraftErrors = { groups: [] };
  if (requireDetails && draft.goal.trim() === "") {
    errors.goal = T.errorGoalRequired;
  }
  if (requireDetails && draft.diagnosis.trim() === "") {
    errors.diagnosis = T.errorDiagnosisRequired;
  }
  const groups: CarePlanSessionGroup[] = [];
  for (const group of draft.groups) {
    const result = validateGroup(group, activeServiceIds);
    errors.groups.push(result.errors);
    if (result.parsed) {
      groups.push(result.parsed);
    }
  }
  const ok = !errors.goal && !errors.diagnosis && groups.length === draft.groups.length && groups.length > 0;
  return ok ? { ok, groups, errors } : { ok: false, errors };
}

export interface PreviewRow {
  n: number;
  serviceName: string;
  /** "d / m" */
  date: string;
}

export interface CarePlanPreview {
  rows: PreviewRow[];
  total: Piastres;
}

/**
 * The live list under the create form: the sessions the valid groups would
 * create, in order, each with its suggested day — the first on `start`,
 * every later one its own group's gap after the one before it, as the
 * writer spaces them — and their total at each service's effective price.
 * A group that is not valid yet adds nothing.
 */
export function previewCarePlanSessions(
  groups: readonly DraftGroup[],
  services: readonly Service[],
  priceOf: (service: Service) => Piastres,
  start: ClinicDay,
): CarePlanPreview {
  const byId = servicesById(services);
  const rows: PreviewRow[] = [];
  let total = 0;
  let previous: ClinicDay | null = null;
  for (const group of groups) {
    const service = byId.get(group.serviceId);
    const count = parseWholeNumber(group.count, 1);
    const gapDays = parseWholeNumber(group.gap, 0);
    if (!service || count === null || gapDays === null) {
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      const date: ClinicDay = previous === null ? start : addDaysToClinicDay(previous, gapDays);
      rows.push({ n: rows.length + 1, serviceName: service.name, date: formatDayMonth(date) });
      total += priceOf(service);
      previous = date;
    }
  }
  return { rows, total: total as Piastres };
}

/** db/carePlans.ts's refusals, as the form shows them. */
export function carePlanErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case CarePlanError.GoalRequired:
      return T.errorGoalRequired;
    case CarePlanError.DiagnosisRequired:
      return T.errorDiagnosisRequired;
    case CarePlanError.CountInvalid:
      return T.errorCountInvalid;
    case CarePlanError.GapInvalid:
      return T.errorGapInvalid;
    case CarePlanError.PlanAlreadyActive:
      return T.errorPlanAlreadyActive;
    case CarePlanError.NotPlanPractitioner:
      return T.errorNotPlanPractitioner;
    case CarePlanError.SessionNotBookable:
      return T.errorSessionNotBookable;
    case CarePlanError.PlanStopped:
      return T.errorPlanStopped;
    default:
      return T.errorFailed;
  }
}
