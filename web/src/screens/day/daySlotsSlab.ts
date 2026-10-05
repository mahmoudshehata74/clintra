import { InvoiceStatus, type Invoice, type Visit } from "../../db/types";
import type { Piastres } from "../../domain/money";
import { VisitStatus } from "../../domain/visitStatus";

// Terminal: nothing further happens to the visit today — the complement of
// "still in progress" (booked, confirmed, arrived, in_room). Shared meaning
// for the summary slab's split bar, in both slots and queue mode (see
// queueSummary.ts's own computeQueueCellCounts).
const TERMINAL_STATUSES = new Set<string>([VisitStatus.Completed, VisitStatus.Cancelled, VisitStatus.NoShow]);

export interface DaySlotsSlab {
  /** How many of today's visits reached a final state (completed, cancelled or no-show). */
  finalStateCount: number;
  /** finalStateCount / total, as a whole percentage (0 on an empty day). */
  splitSharePercent: number;
  noShowCount: number;
  /** The earliest arrived visit still waiting for a room, else the earliest booked/confirmed one — null if neither exists. */
  nextVisit: Visit | null;
  /** How many non-void invoices were issued today at this location. */
  invoiceCount: number;
  /** Sum of each non-void invoice's unpaid remainder (total - paid, floored at 0). */
  duePiastres: Piastres;
  /** True once at least one of today's invoices is partially paid. */
  hasPartialInvoice: boolean;
  /** The longest completed consult today, in whole minutes — null if none has both started_at and ended_at. */
  longestCompletedConsultMinutes: number | null;
}

function isEarlier(a: Visit, b: Visit): boolean {
  return (a.scheduled_at ?? "") < (b.scheduled_at ?? "");
}

/**
 * The slots-mode summary slab's numbers beyond what dayCounters.ts already
 * gives (remaining/total/arrived/completed): the no-show cell, the split
 * bar's final-state share, the "next up" visit the copper action jumps to,
 * and the due/invoice-count/partial-flag tiles. `invoicesToday` is today's
 * invoices at this location (the same scope cash-close's own
 * computeExpectedCashTotal uses) — the caller resolves that scope; this
 * function only ever excludes void ones from its own sums. The "محصّل
 * اليوم" tile's own number is computeExpectedCashTotal's figure directly
 * (db/cashClose.ts), reused rather than re-derived here.
 */
export function computeDaySlotsSlab(visits: readonly Visit[], invoicesToday: readonly Invoice[]): DaySlotsSlab {
  let noShowCount = 0;
  let finalStateCount = 0;
  let nextWaitingVisit: Visit | null = null;
  let nextBookedVisit: Visit | null = null;
  let longestCompletedConsultMinutes: number | null = null;

  for (const visit of visits) {
    if (visit.status === VisitStatus.NoShow) {
      noShowCount += 1;
    }
    if (TERMINAL_STATUSES.has(visit.status)) {
      finalStateCount += 1;
    }
    if (visit.status === VisitStatus.Completed && visit.started_at && visit.ended_at) {
      const minutes = Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60_000);
      if (longestCompletedConsultMinutes === null || minutes > longestCompletedConsultMinutes) {
        longestCompletedConsultMinutes = minutes;
      }
    }
    if (visit.status === VisitStatus.Arrived && (!nextWaitingVisit || isEarlier(visit, nextWaitingVisit))) {
      nextWaitingVisit = visit;
    }
    if (
      (visit.status === VisitStatus.Booked || visit.status === VisitStatus.Confirmed) &&
      (!nextBookedVisit || isEarlier(visit, nextBookedVisit))
    ) {
      nextBookedVisit = visit;
    }
  }

  const total = visits.length;
  const splitSharePercent = total > 0 ? Math.round((finalStateCount / total) * 100) : 0;

  let duePiastres = 0 as Piastres;
  let invoiceCount = 0;
  let hasPartialInvoice = false;
  for (const invoice of invoicesToday) {
    if (invoice.status === InvoiceStatus.Void) {
      continue;
    }
    invoiceCount += 1;
    const remainder = invoice.total - invoice.paid;
    if (remainder > 0) {
      duePiastres = (duePiastres + remainder) as Piastres;
    }
    if (invoice.status === InvoiceStatus.Partial) {
      hasPartialInvoice = true;
    }
  }

  return {
    finalStateCount,
    splitSharePercent,
    noShowCount,
    nextVisit: nextWaitingVisit ?? nextBookedVisit,
    invoiceCount,
    duePiastres,
    hasPartialInvoice,
    longestCompletedConsultMinutes,
  };
}
