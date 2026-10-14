import {
  CarePlanItemStatus,
  CarePlanStatus,
  type CarePlan,
  type CarePlanItem,
  type Invoice,
  type Payment,
  type Visit,
} from "../db/types";
import { arabicCount } from "./arabicText";
import type { Piastres } from "./money";
import { addDaysToClinicDay, cairoInstant, type ClinicDay, type Instant } from "./time";
import { occupiesSlot, VisitStatus } from "./visitStatus";

// Pure derivations for care plans (docs/schema.md's v20 additions; screen 17
// of the prototype). Only two statuses are stored — a plan is active or
// stopped, a session planned or skipped — and everything a plan or a
// session shows beyond that is derived here from the sessions and the
// visits they link to. None of these reads the database or the clock on
// its own.

/** What a session is, as the plan shows it. */
export const CarePlanSessionState = {
  /** Its linked visit is completed. */
  Done: "done",
  /** Its linked visit still holds a slot (booked, confirmed, arrived, in_room). */
  Booked: "booked",
  /** Planned, with no visit booking it — the "مقترحة" session. */
  Suggested: "suggested",
  /** Stored as skipped ("أجّل جلسة"); left out of every count, total and date. */
  Skipped: "skipped",
} as const;

export type CarePlanSessionState = (typeof CarePlanSessionState)[keyof typeof CarePlanSessionState];

/** How long a suggested session may be overdue, with nothing booked, before the plan reads as stalled. */
export const CARE_PLAN_STALL_DAYS = 7;

export type SessionVisit = Pick<Visit, "id" | "status" | "visit_date">;

export interface CarePlanSession {
  item: CarePlanItem;
  state: CarePlanSessionState;
  /**
   * The linked visit's day; otherwise the previous (not skipped) session's
   * date plus this session's min_gap_days; otherwise null — the session
   * then reads as its fallbackLabel. Always null for a skipped session.
   */
  date: ClinicDay | null;
  /** The session's service name. */
  label: string;
  /** "جلسة {n}" (n = its sequence): what the session reads as while it has no date. */
  fallbackLabel: string;
  /** The visit that books it, while that visit is completed or still holds its slot; null otherwise. */
  visit: SessionVisit | null;
}

/** The linked visit, when the link still means something: a visit cancelled, missed or moved away no longer books the session. */
function bookingVisit(item: CarePlanItem, visitsById: ReadonlyMap<string, SessionVisit>): SessionVisit | null {
  const visit = item.visit_id === null ? undefined : visitsById.get(item.visit_id);
  return visit && occupiesSlot(visit.status) ? visit : null;
}

/**
 * A plan's sessions in sequence order, each with its state, display date
 * and label. A link to a visit that is missing from `visitsById`, or that
 * no longer holds its slot, reads as no link: the session is suggested
 * again.
 */
export function deriveCarePlanSessions(
  items: readonly CarePlanItem[],
  visitsById: ReadonlyMap<string, SessionVisit>,
  serviceNames: ReadonlyMap<string, string>,
): CarePlanSession[] {
  let previousDate: ClinicDay | null = null;
  return [...items]
    .sort((a, b) => a.sequence - b.sequence)
    .map((item) => {
      const label = serviceNames.get(item.service_id) ?? "";
      const fallbackLabel = `جلسة ${item.sequence}`;
      if (item.status === CarePlanItemStatus.Skipped) {
        return { item, state: CarePlanSessionState.Skipped, date: null, label, fallbackLabel, visit: null };
      }
      const visit = bookingVisit(item, visitsById);
      const state =
        visit === null
          ? CarePlanSessionState.Suggested
          : visit.status === VisitStatus.Completed
            ? CarePlanSessionState.Done
            : CarePlanSessionState.Booked;
      const date = visit?.visit_date ?? (previousDate === null ? null : addDaysToClinicDay(previousDate, item.min_gap_days));
      previousDate = date;
      return { item, state, date, label, fallbackLabel, visit };
    });
}

/** The sessions that count: every one not skipped. */
export function countedSessions<S extends { item: Pick<CarePlanItem, "status"> }>(sessions: readonly S[]): S[] {
  return sessions.filter((session) => session.item.status !== CarePlanItemStatus.Skipped);
}

/** planned_count and total_price as the writers store them: the number and the summed price of the sessions not skipped. */
export function carePlanTotals(items: readonly Pick<CarePlanItem, "status" | "price">[]): Pick<CarePlan, "planned_count" | "total_price"> {
  const counted = items.filter((item) => item.status !== CarePlanItemStatus.Skipped);
  return {
    planned_count: counted.length,
    total_price: counted.reduce((sum, item) => sum + item.price, 0) as Piastres,
  };
}

/** The last session's display date — the last session not skipped — or null while it has none. */
export function carePlanEndDate(sessions: readonly CarePlanSession[]): ClinicDay | null {
  const counted = countedSessions(sessions);
  return counted.length === 0 ? null : counted[counted.length - 1].date;
}

/**
 * expected_end as the writers store it: the end date at Cairo midnight, or
 * started_at while no session has a date yet (the column is NOT NULL; a
 * screen reads carePlanEndDate, never this, for what to show).
 */
export function carePlanExpectedEnd(startedAt: Instant, sessions: readonly CarePlanSession[]): Instant {
  const end = carePlanEndDate(sessions);
  return end === null ? startedAt : cairoInstant(end, "00:00");
}

/** Whether every session not skipped is done. */
export function isCarePlanCompleted(sessions: readonly CarePlanSession[]): boolean {
  return countedSessions(sessions).every((session) => session.state === CarePlanSessionState.Done);
}

/** The first suggested session in sequence order — "the next session" to book — or null. */
export function nextSuggestedSession(sessions: readonly CarePlanSession[]): CarePlanSession | null {
  return sessions.find((session) => session.state === CarePlanSessionState.Suggested) ?? null;
}

function daysFrom(from: ClinicDay, to: ClinicDay): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000);
}

/**
 * How many days an active plan has been stalled, or null when it is not:
 * nothing is booked, and the next suggested session's date is more than
 * CARE_PLAN_STALL_DAYS days before `today`. A stopped or completed plan
 * never stalls, and neither does one whose next session has no date.
 */
export function carePlanStalledDays(
  plan: Pick<CarePlan, "status">,
  sessions: readonly CarePlanSession[],
  today: ClinicDay,
): number | null {
  if (plan.status !== CarePlanStatus.Active || isCarePlanCompleted(sessions)) {
    return null;
  }
  if (sessions.some((session) => session.state === CarePlanSessionState.Booked)) {
    return null;
  }
  const next = nextSuggestedSession(sessions);
  if (next === null || next.date === null) {
    return null;
  }
  const days = daysFrom(next.date, today);
  return days > CARE_PLAN_STALL_DAYS ? days : null;
}

/** "المريض متوقف من 9 أيام" — the stalled plan's line, counted in Arabic (Latin digits). */
export function carePlanStalledLabel(days: number): string {
  const { numeral, words } = arabicCount(days, { one: "يوم", two: "يومين", few: "أيام", many: "يوم" });
  return `المريض متوقف من ${numeral === null ? words : `${numeral} ${words}`}`;
}

/**
 * What a plan has been paid: every payment on the invoices of the visits
 * its sessions link to. Derived, never stored — care_plans.paid stays 0.
 */
export function carePlanPaid(
  items: readonly Pick<CarePlanItem, "visit_id">[],
  invoices: readonly Pick<Invoice, "id" | "visit_id">[],
  payments: readonly Pick<Payment, "invoice_id" | "amount">[],
): Piastres {
  const linkedVisitIds = new Set(items.map((item) => item.visit_id).filter((visitId): visitId is string => visitId !== null));
  const invoiceIds = new Set(
    invoices.filter((invoice) => invoice.visit_id !== null && linkedVisitIds.has(invoice.visit_id)).map((invoice) => invoice.id),
  );
  return payments
    .filter((payment) => invoiceIds.has(payment.invoice_id))
    .reduce((sum, payment) => sum + payment.amount, 0) as Piastres;
}

/**
 * The {{session_label}} a message about a session's visit is filled with:
 * "جلسة {n} من {count} · {service}", n being the session's place among the
 * sessions not skipped and count their number. Null for a session that is
 * skipped or not among `sessions`.
 */
export function carePlanSessionMessageLabel(sessions: readonly CarePlanSession[], itemId: string): string | null {
  const counted = countedSessions(sessions);
  const index = counted.findIndex((session) => session.item.id === itemId);
  if (index < 0) {
    return null;
  }
  const { label } = counted[index];
  const head = `جلسة ${index + 1} من ${counted.length}`;
  return label === "" ? head : `${head} · ${label}`;
}
