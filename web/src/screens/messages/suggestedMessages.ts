import type { CarePlanItem, Invoice, Message, Patient, Visit } from "../../db/types";
import { InvoiceStatus } from "../../db/types";
import type { Piastres } from "../../domain/money";
import { normalizeEgyptianPhone } from "../../domain/phone";
import { addDaysToClinicDay, clockTimeInCairo, todayInCairo, type ClinicDay } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import { formatMoneyAmount } from "../money";
import { isMessageVisible, type MessageAccess } from "./messagesModel";
import { messagesStrings as T } from "./strings";

// "مقترح النهارده": the patients who should get a message today, one row
// each, with the template the send sheet opens on. Pure — the caller reads
// the rows and the clock.

export const SuggestedTemplateKey = {
  AppointmentReminder: "appointment_reminder",
  CarePlanSessionReminder: "care_plan_session_reminder",
  PostVisitFollowup: "post_visit_followup",
  BalanceReminder: "balance_reminder",
} as const;

export type SuggestedTemplateKey = (typeof SuggestedTemplateKey)[keyof typeof SuggestedTemplateKey];

export interface SuggestedMessage {
  /** Stable React key: the template and the visit it opens on. */
  key: string;
  templateKey: SuggestedTemplateKey;
  patientId: string;
  patientName: string;
  /** The visit the send sheet opens on, with this template preselected. */
  visitId: string;
  /** "موعد بكرة 10:30", "زيارة من يومين", "عليه 150 ج.م من أسبوع", "جلسة خطة بكرة 9:30". */
  reason: string;
  /** False when the patient has no usable mobile number: the row reads "مفيش رقم" and offers no button. */
  hasPhone: boolean;
}

export interface SuggestionSources {
  visits: readonly Visit[];
  patients: readonly Patient[];
  invoices: readonly Invoice[];
  carePlanItems: readonly Pick<CarePlanItem, "visit_id">[];
  messages: readonly Pick<Message, "patient_id" | "visit_id" | "template_key" | "attempted_at">[];
  access: MessageAccess;
  now: Date;
}

/** A balance reminder is due once its invoice is this many days old, and again this many days after the last one. */
export const BALANCE_REMINDER_DAYS = 7;

/** A follow-up is due this many days after a completed visit. */
export const FOLLOWUP_AFTER_DAYS = 2;

/** "h:mm", the app's 24-hour clock without a leading zero: "9:30", "16:30". */
function shortClock(instant: string): string {
  return clockTimeInCairo(instant).replace(/^0(\d)/, "$1");
}

/** "من أسبوع", "من أسبوعين", "من 3 أسابيع", "من 11 أسبوع" — whole weeks, never under one. */
export function weeksAgoPhrase(days: number): string {
  const weeks = Math.max(1, Math.floor(days / 7));
  if (weeks === 1) {
    return T.suggestedWeekOne;
  }
  if (weeks === 2) {
    return T.suggestedWeekTwo;
  }
  return `${T.suggestedSince} ${weeks} ${weeks <= 10 ? T.suggestedWeeksFew : T.suggestedWeeksMany}`;
}

function daysBetween(from: ClinicDay, to: ClinicDay): number {
  const toUtc = (day: ClinicDay) => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

const KIND_ORDER: Record<SuggestedTemplateKey, number> = {
  [SuggestedTemplateKey.AppointmentReminder]: 0,
  [SuggestedTemplateKey.CarePlanSessionReminder]: 0,
  [SuggestedTemplateKey.PostVisitFollowup]: 1,
  [SuggestedTemplateKey.BalanceReminder]: 2,
};

/**
 * Today's suggested messages, in Cairo days:
 * - appointment_reminder: tomorrow's visits still booked or confirmed;
 * - care_plan_session_reminder: those of tomorrow's visits that book a care
 *   plan session — instead of their appointment reminder, not as well;
 * - post_visit_followup: visits completed exactly two days ago;
 * - balance_reminder: per patient, at most one row — their oldest non-void
 *   invoice with something still owed, issued seven or more days ago, on
 *   that invoice's visit, reading what it still owes.
 * A visit's row goes once a message with its template was opened for that
 * visit; a balance row once a balance reminder was opened for the patient in
 * the last seven days (today and the six before). Only visits, invoices and
 * messages the membership may see count (messages' own scope: the
 * organization, and its locations unless it covers all). Tomorrow's rows
 * come first by time, then follow-ups, then balances, each by name.
 */
export function suggestedMessages(sources: SuggestionSources): SuggestedMessage[] {
  const today = todayInCairo(sources.now);
  const tomorrow = addDaysToClinicDay(today, 1);
  const followupDay = addDaysToClinicDay(today, -FOLLOWUP_AFTER_DAYS);
  const balanceSince = addDaysToClinicDay(today, -(BALANCE_REMINDER_DAYS - 1));
  const patientsById = new Map(sources.patients.map((patient) => [patient.id, patient]));
  const visible = <R extends { org_id: string; location_id: string }>(row: R) => isMessageVisible(row, sources.access);
  const sessionVisitIds = new Set(
    sources.carePlanItems.map((item) => item.visit_id).filter((visitId): visitId is string => visitId !== null),
  );
  const sentForVisit = new Set(
    sources.messages
      .filter((message) => message.visit_id !== null)
      .map((message) => `${message.template_key}|${message.visit_id}`),
  );
  const balanceSentRecently = new Set(
    sources.messages
      .filter(
        (message) =>
          message.template_key === SuggestedTemplateKey.BalanceReminder &&
          todayInCairo(new Date(message.attempted_at)) >= balanceSince,
      )
      .map((message) => message.patient_id),
  );

  const rows: { row: SuggestedMessage; sortTime: string }[] = [];
  const pushRow = (templateKey: SuggestedTemplateKey, patientId: string, visitId: string, reason: string, sortTime = "") => {
    const patient = patientsById.get(patientId);
    if (!patient) {
      return;
    }
    const phone = patient.phone === null ? null : normalizeEgyptianPhone(patient.phone);
    rows.push({
      row: {
        key: `${templateKey}|${visitId}`,
        templateKey,
        patientId,
        patientName: patient.full_name,
        visitId,
        reason,
        hasPhone: phone !== null && phone.ok,
      },
      sortTime,
    });
  };

  for (const visit of sources.visits) {
    if (!visible(visit)) {
      continue;
    }
    if (
      visit.visit_date === tomorrow &&
      (visit.status === VisitStatus.Booked || visit.status === VisitStatus.Confirmed)
    ) {
      const isSession = sessionVisitIds.has(visit.id);
      const templateKey = isSession ? SuggestedTemplateKey.CarePlanSessionReminder : SuggestedTemplateKey.AppointmentReminder;
      if (sentForVisit.has(`${templateKey}|${visit.id}`)) {
        continue;
      }
      const prefix = isSession ? T.suggestedSessionTomorrow : T.suggestedAppointmentTomorrow;
      const reason = visit.scheduled_at ? `${prefix} ${shortClock(visit.scheduled_at)}` : prefix;
      pushRow(templateKey, visit.patient_id, visit.id, reason, visit.scheduled_at ?? "");
    } else if (visit.visit_date === followupDay && visit.status === VisitStatus.Completed) {
      if (!sentForVisit.has(`${SuggestedTemplateKey.PostVisitFollowup}|${visit.id}`)) {
        pushRow(SuggestedTemplateKey.PostVisitFollowup, visit.patient_id, visit.id, T.suggestedFollowup);
      }
    }
  }

  const oldestOwedByPatient = new Map<string, Invoice>();
  for (const invoice of sources.invoices) {
    if (
      !visible(invoice) ||
      invoice.status === InvoiceStatus.Void ||
      invoice.visit_id === null ||
      invoice.total - invoice.paid <= 0 ||
      daysBetween(todayInCairo(new Date(invoice.issued_at)), today) < BALANCE_REMINDER_DAYS ||
      balanceSentRecently.has(invoice.patient_id)
    ) {
      continue;
    }
    const current = oldestOwedByPatient.get(invoice.patient_id);
    if (!current || invoice.issued_at < current.issued_at) {
      oldestOwedByPatient.set(invoice.patient_id, invoice);
    }
  }
  for (const invoice of oldestOwedByPatient.values()) {
    const owed = formatMoneyAmount((invoice.total - invoice.paid) as Piastres);
    const age = weeksAgoPhrase(daysBetween(todayInCairo(new Date(invoice.issued_at)), today));
    pushRow(
      SuggestedTemplateKey.BalanceReminder,
      invoice.patient_id,
      invoice.visit_id!,
      `${T.suggestedOwes} ${owed} ${T.suggestedCurrency} ${age}`,
    );
  }

  return rows
    .sort(
      (a, b) =>
        KIND_ORDER[a.row.templateKey] - KIND_ORDER[b.row.templateKey] ||
        a.sortTime.localeCompare(b.sortTime) ||
        a.row.patientName.localeCompare(b.row.patientName, "ar") ||
        a.row.key.localeCompare(b.row.key),
    )
    .map(({ row }) => row);
}
