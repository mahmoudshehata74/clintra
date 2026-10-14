import {
  CarePlanItemStatus,
  CarePlanStatus,
  InvoiceStatus,
  MessageChannel,
  PaymentMethod,
  type CarePlan,
  type CarePlanItem,
  type Invoice,
  type Message,
  type Patient,
  type Payment,
  type Practitioner,
  type Prescription,
  type PrescriptionItem,
  type Service,
  type Visit,
} from "../../db/types";
import type { VisitFormFieldValues } from "../../db/visitForm";
import { carePlanStalledDays, carePlanStalledLabel, deriveCarePlanSessions, isCarePlanCompleted } from "../../domain/carePlan";
import { MESSAGE_TEMPLATES } from "../../domain/messageTemplates";
import type { Piastres } from "../../domain/money";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import { todayInCairo, type ClinicDay, type Instant } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import { formatFullDate, formatShortClock } from "../carePlan/carePlanModel";
import { formatInvoiceNumber } from "../day/invoiceNumber";
import { dayScreenStrings } from "../day/strings";
import { computeAge, formatRelativeVisitTime } from "../doctor/doctorDay";
import { formatMoneyAmount } from "../money";
import { countPhrase, RX_COUNT_FORMS, sortRxItems } from "../visit/workspace";
import { messageSnippet } from "../messages/messagesModel";
import { patientProfileStrings as T } from "./strings";

// Pure derivations behind the patient profile (reference screen 18): the
// hero's numbers, the timeline's events and their text, the tab counts, the
// day groups and their headers, and paging. None reads the database or the
// clock on its own: the caller passes the rows and the time.

/** Everything the profile reads for one patient. */
export interface PatientProfileSource {
  patient: Patient;
  /** The patient's visits, every status. */
  visits: readonly Visit[];
  /** The general form's values, by visit. */
  formValuesByVisitId: ReadonlyMap<string, VisitFormFieldValues>;
  practitioners: readonly Pick<Practitioner, "id" | "full_name">[];
  services: readonly Pick<Service, "id" | "name">[];
  /** The patient's care plans, and every item of them. */
  plans: readonly CarePlan[];
  planItems: readonly CarePlanItem[];
  /** The patient's prescriptions, and every item of them. */
  prescriptions: readonly Prescription[];
  prescriptionItems: readonly PrescriptionItem[];
  /** The patient's messages. */
  messages: readonly Message[];
  /** The patient's invoices, and every payment on them. */
  invoices: readonly Invoice[];
  payments: readonly Payment[];
  /** A staff member's name, by membership id (payments.created_by). */
  staffNames: ReadonlyMap<string, string>;
}

// ── `.pt-hero` ───────────────────────────────────────────────────────────

export interface ProfilePlanStat {
  planId: string;
  /** "جارية" / "متوقفة" / "اكتملت". */
  label: string;
}

export interface ProfileHero {
  /** `.avatar`: the name's first letter. */
  initial: string;
  name: string;
  /** `.age`: "34 سنة · ذكر", each part omitted when unknown; null when both are. */
  ageLine: string | null;
  /** `.meta .mono`: local display ("0111 234 5678"); null without a phone. */
  phone: string | null;
  /** "d / m / yyyy" of the earliest completed visit; null without one. */
  firstVisit: string | null;
  /** "زيارات": completed visits. */
  visitCount: number;
  /** `.pt-stat.plan`: the most recent plan's state; null without a plan. */
  plan: ProfilePlanStat | null;
  /** `.pt-stat.balance`: what is still owed on the non-void invoices, as "1,250"; "0" when nothing is. */
  balance: string;
  /** "المريض متوقف من N يوم" when the most recent plan is under way and stalled; null otherwise. */
  stalledLine: string | null;
}

function ageLine(patient: Patient, now: Date): string | null {
  const age = computeAge(patient.birth_year, now);
  const gender = patient.gender === "male" ? T.genderMale : patient.gender === "female" ? T.genderFemale : null;
  const parts = [age === null ? null : `${age} ${T.ageUnit}`, gender].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** The sum, over the invoices not voided, of what is still owed on each (never below zero). */
export function patientBalance(invoices: readonly Pick<Invoice, "status" | "total" | "paid">[]): Piastres {
  return invoices
    .filter((invoice) => invoice.status !== InvoiceStatus.Void)
    .reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.paid), 0) as Piastres;
}

function sessionsOf(plan: CarePlan, source: PatientProfileSource) {
  return deriveCarePlanSessions(
    source.planItems.filter((item) => item.care_plan_id === plan.id),
    new Map(source.visits.map((visit) => [visit.id, visit])),
    new Map(source.services.map((service) => [service.id, service.name])),
  );
}

/** The patient's most recent plan, by when it started; null without one. */
function mostRecentPlan(plans: readonly CarePlan[]): CarePlan | null {
  return [...plans].sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id.localeCompare(a.id))[0] ?? null;
}

export function buildProfileHero(source: PatientProfileSource, now: Date): ProfileHero {
  const { patient } = source;
  const completed = source.visits.filter((visit) => visit.status === VisitStatus.Completed);
  const firstDay = completed.map((visit) => visit.visit_date).sort()[0];
  const plan = mostRecentPlan(source.plans);
  let planStat: ProfilePlanStat | null = null;
  let stalledLine: string | null = null;
  if (plan) {
    const sessions = sessionsOf(plan, source);
    const label = isCarePlanCompleted(sessions)
      ? T.planCompleted
      : plan.status === CarePlanStatus.Stopped
        ? T.planStopped
        : T.planOngoing;
    planStat = { planId: plan.id, label };
    const stalledDays = carePlanStalledDays(plan, sessions, todayInCairo(now));
    stalledLine = stalledDays === null ? null : carePlanStalledLabel(stalledDays);
  }
  return {
    initial: patient.full_name.charAt(0),
    name: patient.full_name,
    ageLine: ageLine(patient, now),
    phone: patient.phone ? formatEgyptianPhoneForDisplay(patient.phone) : null,
    firstVisit: firstDay === undefined ? null : formatFullDate(firstDay),
    visitCount: completed.length,
    plan: planStat,
    balance: formatMoneyAmount(patientBalance(source.invoices)),
    stalledLine,
  };
}

// ── `.pt-timeline` events ────────────────────────────────────────────────

export type ProfileEventKind = "visit" | "rx" | "msg" | "pay" | "note";

/** One piece of an event's `.d` line: plain, bold (`b`), or the diagnosis (`.dx`). */
export interface DetailPart {
  text: string;
  tone: "plain" | "strong" | "dx";
  /** Drug names and other Latin runs read left to right. */
  ltr?: boolean;
}

/** What tapping an event opens. */
export type ProfileEventTarget =
  | { kind: "visit"; visitId: string }
  | { kind: "rx"; prescriptionId: string }
  | { kind: "invoice"; invoiceId: string };

export interface ProfileEvent {
  /** Unique across kinds: "{kind}:{row id}". */
  key: string;
  kind: ProfileEventKind;
  /** The Cairo day it groups under. */
  day: ClinicDay;
  /** Orders events within a day; null sorts last. */
  at: Instant | null;
  /** `.time`: "H:mm"; null when the event has no time. */
  time: string | null;
  /** `.t` */
  title: string;
  /** `.d`: groups joined by " · ", each group's parts side by side (the drug names carry their own "، "). */
  details: DetailPart[][];
  /** A cancelled visit or a no-show: the row reads muted. */
  muted: boolean;
  target: ProfileEventTarget | null;
}

/** The visits the timeline shows: history only, never what is still to come. */
const SHOWN_VISIT_STATUSES = new Set<string>([VisitStatus.Completed, VisitStatus.Cancelled, VisitStatus.NoShow]);

/** A visit's time: when it started, else when it was booked for. */
function visitInstant(visit: Visit): Instant | null {
  return visit.started_at ?? visit.scheduled_at;
}

function clock(instant: Instant | null): string | null {
  return instant === null ? null : formatShortClock(instant);
}

const METHOD_LABEL: Record<string, string> = {
  [PaymentMethod.Cash]: dayScreenStrings.paymentMethodCash,
  [PaymentMethod.Card]: dayScreenStrings.paymentMethodCard,
  [PaymentMethod.Wallet]: dayScreenStrings.paymentMethodWallet,
  [PaymentMethod.Transfer]: dayScreenStrings.paymentMethodTransfer,
};

/**
 * "جلسة {service} · {n} من {count}" for a visit a care plan session links
 * to — n its place among the plan's sessions not skipped, count their
 * number; null for a visit no session links to.
 */
function sessionTitle(visit: Visit, source: PatientProfileSource): string | null {
  const item = source.planItems.find((candidate) => candidate.visit_id === visit.id);
  if (!item) {
    return null;
  }
  const counted = source.planItems
    .filter((candidate) => candidate.care_plan_id === item.care_plan_id && candidate.status !== CarePlanItemStatus.Skipped)
    .sort((a, b) => a.sequence - b.sequence);
  const index = counted.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) {
    return null;
  }
  const service = source.services.find((candidate) => candidate.id === item.service_id)?.name;
  const head = service ? `${T.sessionPrefix} ${service}` : T.sessionPrefix;
  return `${head} · ${index + 1} ${T.sessionOf} ${counted.length}`;
}

function visitEvents(source: PatientProfileSource, itemsByPrescriptionId: ReadonlyMap<string, PrescriptionItem[]>): ProfileEvent[] {
  const doctorNames = new Map(source.practitioners.map((practitioner) => [practitioner.id, practitioner.full_name]));
  const events: ProfileEvent[] = [];
  for (const visit of source.visits) {
    if (!SHOWN_VISIT_STATUSES.has(visit.status)) {
      continue;
    }
    const values = source.formValuesByVisitId.get(visit.id);
    const diagnosis = values?.diagnosis.trim() ?? "";
    const complaint = values?.complaint.trim() ?? "";
    const prescription = source.prescriptions.find((rx) => rx.visit_id === visit.id);
    const drugCount = prescription ? (itemsByPrescriptionId.get(prescription.id)?.length ?? 0) : 0;
    const doctor = doctorNames.get(visit.practitioner_id);

    const details: DetailPart[][] = [];
    if (doctor) {
      details.push([{ text: `${T.doctorPrefix} ${doctor}`, tone: "strong" }]);
    }
    if (diagnosis) {
      details.push([{ text: diagnosis, tone: "dx" }]);
    }
    if (complaint) {
      details.push([{ text: `${T.complaintPrefix} ${complaint}`, tone: "plain" }]);
    }
    if (drugCount > 0) {
      details.push([{ text: `${T.prescribedPrefix} ${countPhrase(drugCount, RX_COUNT_FORMS)}`, tone: "plain" }]);
    }

    const at = visitInstant(visit);
    const title =
      visit.status === VisitStatus.Cancelled
        ? T.visitCancelled
        : visit.status === VisitStatus.NoShow
          ? T.visitNoShow
          : (sessionTitle(visit, source) ?? (diagnosis ? `${T.visitTitle} — ${diagnosis}` : T.visitTitle));
    events.push({
      key: `visit:${visit.id}`,
      kind: "visit",
      day: visit.visit_date,
      at,
      time: clock(at),
      title,
      details,
      muted: visit.status !== VisitStatus.Completed,
      target: { kind: "visit", visitId: visit.id },
    });

    if (visit.note) {
      events.push({
        key: `note:${visit.id}`,
        kind: "note",
        day: visit.visit_date,
        at,
        time: clock(at),
        title: T.noteTitle,
        details: [[{ text: visit.note, tone: "plain" }]],
        muted: false,
        target: null,
      });
    }
  }
  return events;
}

function prescriptionEvents(
  source: PatientProfileSource,
  itemsByPrescriptionId: ReadonlyMap<string, PrescriptionItem[]>,
): ProfileEvent[] {
  return source.prescriptions.flatMap((prescription): ProfileEvent[] => {
    const items = sortRxItems(itemsByPrescriptionId.get(prescription.id) ?? []);
    // A prescription whose every drug was removed prescribes nothing.
    if (items.length === 0) {
      return [];
    }
    const names = items.flatMap((item, index): DetailPart[] => [
      ...(index === 0 ? [] : [{ text: "، ", tone: "plain" as const }]),
      { text: item.name, tone: "strong", ltr: true },
    ]);
    return [
      {
        key: `rx:${prescription.id}`,
        kind: "rx",
        day: todayInCairo(new Date(prescription.created_at)),
        at: prescription.created_at,
        time: clock(prescription.created_at),
        title: `${T.rxTitle} · ${countPhrase(items.length, RX_COUNT_FORMS)}`,
        details: [names, [{ text: prescription.printed_at ? T.rxPrinted : T.rxNotPrinted, tone: "plain" }]],
        muted: false,
        target: { kind: "rx", prescriptionId: prescription.id },
      },
    ];
  });
}

function messageEvents(source: PatientProfileSource): ProfileEvent[] {
  return source.messages.map((message) => {
    const name = MESSAGE_TEMPLATES.find((template) => template.key === message.template_key)?.name ?? message.template_key;
    const channel = message.channel === MessageChannel.Sms ? T.channelSms : T.channelWhatsApp;
    const details: DetailPart[][] = [];
    const firstLine = messageSnippet(message.body);
    if (firstLine) {
      details.push([{ text: firstLine, tone: "plain" }]);
    }
    details.push([{ text: message.marked_sent_at ? T.msgSent : T.msgOpened, tone: "plain" }]);
    return {
      key: `msg:${message.id}`,
      kind: "msg",
      day: todayInCairo(new Date(message.attempted_at)),
      at: message.attempted_at,
      time: clock(message.attempted_at),
      title: `${name} · ${channel}`,
      details,
      muted: false,
      target: null,
    };
  });
}

function paymentEvents(source: PatientProfileSource): ProfileEvent[] {
  const invoicesById = new Map(source.invoices.map((invoice) => [invoice.id, invoice]));
  return source.payments.flatMap((payment): ProfileEvent[] => {
    const invoice = invoicesById.get(payment.invoice_id);
    if (!invoice) {
      return [];
    }
    const method = METHOD_LABEL[payment.method] ?? payment.method;
    const details: DetailPart[][] = [
      [
        { text: `${T.invoicePrefix} `, tone: "plain" },
        { text: formatInvoiceNumber(invoice), tone: "plain", ltr: true },
      ],
    ];
    const staff = source.staffNames.get(payment.created_by);
    if (staff) {
      details.push([{ text: staff, tone: "strong" }]);
    }
    return [
      {
        key: `pay:${payment.id}`,
        kind: "pay",
        day: todayInCairo(new Date(payment.created_at)),
        at: payment.created_at,
        time: clock(payment.created_at),
        title: `${T.payTitle} · ${formatMoneyAmount(payment.amount)} ${T.currencyUnit} ${method}`,
        details,
        muted: false,
        target: { kind: "invoice", invoiceId: invoice.id },
      },
    ];
  });
}

// Within one time, the visit leads, its note follows it, then the rest.
const KIND_ORDER: Record<ProfileEventKind, number> = { visit: 0, note: 1, rx: 2, msg: 3, pay: 4 };

/** Every event of the patient's history, newest first: by day, then by time (untimed last), then by kind. */
export function buildProfileEvents(source: PatientProfileSource): ProfileEvent[] {
  const itemsByPrescriptionId = new Map<string, PrescriptionItem[]>();
  for (const item of source.prescriptionItems) {
    itemsByPrescriptionId.set(item.prescription_id, [...(itemsByPrescriptionId.get(item.prescription_id) ?? []), item]);
  }
  return [
    ...visitEvents(source, itemsByPrescriptionId),
    ...prescriptionEvents(source, itemsByPrescriptionId),
    ...messageEvents(source),
    ...paymentEvents(source),
  ].sort(
    (a, b) =>
      b.day.localeCompare(a.day) ||
      (b.at ?? "").localeCompare(a.at ?? "") ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.key.localeCompare(b.key),
  );
}

// ── `.pt-tabs` ───────────────────────────────────────────────────────────

export type ProfileTab = "all" | "visits" | "rx" | "messages" | "payments" | "notes";

export const PROFILE_TABS: readonly { tab: ProfileTab; label: string; empty: string }[] = [
  { tab: "all", label: T.tabAll, empty: T.emptyAll },
  { tab: "visits", label: T.tabVisits, empty: T.emptyVisits },
  { tab: "rx", label: T.tabRx, empty: T.emptyRx },
  { tab: "messages", label: T.tabMessages, empty: T.emptyMessages },
  { tab: "payments", label: T.tabPayments, empty: T.emptyPayments },
  { tab: "notes", label: T.tabNotes, empty: T.emptyNotes },
];

const TAB_KIND: Record<Exclude<ProfileTab, "all">, ProfileEventKind> = {
  visits: "visit",
  rx: "rx",
  messages: "msg",
  payments: "pay",
  notes: "note",
};

/** The events a tab shows: every one for "الكل", one kind for the rest. */
export function filterProfileEvents(events: readonly ProfileEvent[], tab: ProfileTab): ProfileEvent[] {
  return tab === "all" ? [...events] : events.filter((event) => event.kind === TAB_KIND[tab]);
}

/** `.pt-tab .b`: how many events each tab shows. */
export function profileTabCounts(events: readonly ProfileEvent[]): Record<ProfileTab, number> {
  return {
    all: events.length,
    visits: filterProfileEvents(events, "visits").length,
    rx: filterProfileEvents(events, "rx").length,
    messages: filterProfileEvents(events, "messages").length,
    payments: filterProfileEvents(events, "payments").length,
    notes: filterProfileEvents(events, "notes").length,
  };
}

// ── Paging ───────────────────────────────────────────────────────────────

/** How many events show at first, and how many more each "اعرض أقدم" adds. */
export const PROFILE_PAGE_SIZE = 100;

export interface ProfilePage {
  events: ProfileEvent[];
  /** Whether "اعرض أقدم" has anything left to show. */
  hasOlder: boolean;
}

/** The newest `pages` × PROFILE_PAGE_SIZE events. */
export function pageProfileEvents(events: readonly ProfileEvent[], pages: number): ProfilePage {
  const shown = events.slice(0, pages * PROFILE_PAGE_SIZE);
  return { events: shown, hasOlder: events.length > shown.length };
}

// ── `.pt-day` ────────────────────────────────────────────────────────────

export interface ProfileDay {
  day: ClinicDay;
  /** `.pt-day-h` */
  heading: string;
  events: ProfileEvent[];
}

function dayMonthName(day: ClinicDay): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} ${T.months[month - 1]}`;
}

/**
 * `.pt-day-h`: "النهارده · 14 أكتوبر 2026" for today, otherwise "15 سبتمبر ·
 * قبل أسبوعين" (the doctor's day's relative helper), each followed by " ·
 * بداية خطة الرعاية" when one of the patient's plans started that day.
 */
export function profileDayHeading(day: ClinicDay, today: ClinicDay, planStartDays: ReadonlySet<ClinicDay>): string {
  const head =
    day === today
      ? `${T.dayToday} · ${dayMonthName(day)} ${day.slice(0, 4)}`
      : `${dayMonthName(day)} · ${formatRelativeVisitTime(day, today)}`;
  return planStartDays.has(day) ? `${head} · ${T.planStartSuffix}` : head;
}

/** The Cairo days the patient's plans started on. */
export function planStartDays(plans: readonly Pick<CarePlan, "started_at">[]): Set<ClinicDay> {
  return new Set(plans.map((plan) => todayInCairo(new Date(plan.started_at))));
}

/** Events (already newest first) grouped by day, in the same order, each day with its heading. */
export function groupProfileEvents(
  events: readonly ProfileEvent[],
  today: ClinicDay,
  startDays: ReadonlySet<ClinicDay>,
): ProfileDay[] {
  const days: ProfileDay[] = [];
  for (const event of events) {
    const last = days[days.length - 1];
    if (last && last.day === event.day) {
      last.events.push(event);
    } else {
      days.push({ day: event.day, heading: profileDayHeading(event.day, today, startDays), events: [event] });
    }
  }
  return days;
}

// ── The patients page ────────────────────────────────────────────────────

/** A search result's last-visit line: "آخر زيارة 9 / 9 / 2026", or "مفيش زيارات". */
export function lastVisitLine(lastVisitDate: ClinicDay | null): string {
  return lastVisitDate === null ? T.noVisits : `${T.lastVisitPrefix} ${formatFullDate(lastVisitDate)}`;
}

