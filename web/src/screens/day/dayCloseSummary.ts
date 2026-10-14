import { InvoiceStatus, PaymentMethod, type CashClose, type Invoice, type Payment, type Visit } from "../../db/types";
import { formatDayMonthName, formatWeekdayFullDate } from "../../domain/displayDate";
import type { Piastres } from "../../domain/money";
import { clockTimeInCairo, todayInCairo, type ClinicDay, type Instant } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import { dayScreenStrings } from "./strings";

// The printed summary of a closed day (screen 7's "اقفل اليوم واطبع
// الملخص"): what the day saw and what the drawer held, on one page.

export interface DayCloseSummarySource {
  date: ClinicDay;
  /** Every visit at the location on that day, any status. */
  visits: readonly Visit[];
  /** Every invoice at the location (filtered to the day here, like the expected total). */
  invoices: readonly Invoice[];
  /** The payments of those invoices. */
  payments: readonly Payment[];
  cashClose: CashClose;
  closedByName: string | null;
}

export interface DayCloseMethodLine {
  method: PaymentMethod;
  label: string;
  amount: Piastres;
}

export interface DayCloseSummary {
  /** "إقفال يوم الاثنين 7 سبتمبر 2026" */
  title: string;
  /** Completed visits. */
  seenCount: number;
  noShowCount: number;
  cancelledCount: number;
  /** Always the four methods, in the payment sheet's order, zero when unused. */
  byMethod: DayCloseMethodLine[];
  /** The four methods' sum. */
  totalCollected: Piastres;
  /** The close's own figures: expected (cashClose.total_expected), counted (total_collected), difference and note. */
  expected: Piastres;
  counted: Piastres;
  difference: Piastres;
  differenceNote: string | null;
  closedByName: string | null;
  /** "طُبعت 7 سبتمبر 18:15" */
  printedAt: string;
}

const METHODS: readonly { method: PaymentMethod; label: string }[] = [
  { method: PaymentMethod.Cash, label: dayScreenStrings.paymentMethodCash },
  { method: PaymentMethod.Card, label: dayScreenStrings.paymentMethodCard },
  { method: PaymentMethod.Wallet, label: dayScreenStrings.paymentMethodWallet },
  { method: PaymentMethod.Transfer, label: dayScreenStrings.paymentMethodTransfer },
];

/** The printed footer's "طُبعت d month HH:MM" for an instant. */
export function formatPrintedAt(instant: Instant): string {
  return `${dayScreenStrings.printedAtPrefix} ${formatDayMonthName(todayInCairo(new Date(instant)))} ${clockTimeInCairo(instant)}`;
}

/**
 * The summary as printed. Collected-by-method counts the payments of the
 * invoices issued that day at the location — the same invoices the close's
 * expected total is the paid sum of (db/cashClose.ts), so the two agree.
 */
export function buildDayCloseSummary(source: DayCloseSummarySource, printedAt: Instant): DayCloseSummary {
  const dayInvoiceIds = new Set(
    source.invoices
      .filter(
        (invoice) =>
          invoice.location_id === source.cashClose.location_id &&
          invoice.status !== InvoiceStatus.Void &&
          todayInCairo(new Date(invoice.issued_at)) === source.date,
      )
      .map((invoice) => invoice.id),
  );
  const dayPayments = source.payments.filter((payment) => dayInvoiceIds.has(payment.invoice_id));
  const byMethod = METHODS.map(({ method, label }) => ({
    method,
    label,
    amount: dayPayments
      .filter((payment) => payment.method === method)
      .reduce((sum, payment) => (sum + payment.amount) as Piastres, 0 as Piastres),
  }));
  const countOf = (status: VisitStatus) => source.visits.filter((visit) => visit.status === status).length;

  return {
    title: `${dayScreenStrings.cashCloseHeadTitlePrefix} ${formatWeekdayFullDate(source.date)}`,
    seenCount: countOf(VisitStatus.Completed),
    noShowCount: countOf(VisitStatus.NoShow),
    cancelledCount: countOf(VisitStatus.Cancelled),
    byMethod,
    totalCollected: byMethod.reduce((sum, line) => (sum + line.amount) as Piastres, 0 as Piastres),
    expected: source.cashClose.total_expected,
    counted: source.cashClose.total_collected,
    difference: source.cashClose.difference,
    differenceNote: source.cashClose.difference_note,
    closedByName: source.closedByName,
    printedAt: formatPrintedAt(printedAt),
  };
}
