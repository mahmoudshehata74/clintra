import { csvFlag, csvMoney, csvNumber, csvText, writeCsv, type CsvCell } from "../../domain/csv";
import type { Piastres } from "../../domain/money";
import { Role } from "../../domain/role";
import { staffName } from "../../domain/staffName";
import { addDaysToClinicDay, todayInCairo, type ClinicDay } from "../../domain/time";
import { CancelReason, VisitStatus } from "../../domain/visitStatus";
import {
  InvoiceStatus,
  PaymentMethod,
  type CashClose,
  type Invoice,
  type InvoiceItem,
  type Membership,
  type Patient,
  type Payment,
  type Practitioner,
  type Service,
  type User,
  type Visit,
} from "../../db/types";
import { formatInvoiceNumber, formatReceiptNumber } from "../day/invoiceNumber";
import { dayScreenStrings as S } from "../day/strings";
import { reportsStrings as T } from "./strings";

/**
 * The reports page's ten reports (docs/backend-harvest.md section 3),
 * computed on the device from what it holds: each a few summary figures and
 * a table, for an inclusive range of clinic days (Cairo) and, optionally,
 * one doctor. A timestamp counts on the Cairo day it falls on.
 */

export const REPORT_KEYS = [
  "visits",
  "booking_activity",
  "cancellations_no_shows",
  "patient_activity",
  "service_usage",
  "invoicing",
  "collections",
  "unpaid_invoices",
  "cash_close",
  "staff_collections",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

/** How a column's values read: text, a clinic day, an instant (ISO), piastres, a count or a yes/no. */
export type ColumnKind = "text" | "day" | "instant" | "money" | "count" | "flag";

export interface ReportColumn {
  label: string;
  kind: ColumnKind;
}

export type ReportValue = string | number | boolean | null;

export interface ReportFigure {
  label: string;
  value: number;
  kind: "count" | "money";
}

export interface Report {
  key: ReportKey;
  title: string;
  figures: ReportFigure[];
  columns: ReportColumn[];
  rows: ReportValue[][];
  /** A line shown above the table when the report has a limit worth saying. */
  note?: string;
}

/** Everything the reports read, as the device holds it. */
export interface ReportData {
  visits: readonly Visit[];
  patients: readonly Patient[];
  invoices: readonly Invoice[];
  invoiceItems: readonly InvoiceItem[];
  payments: readonly Payment[];
  cashCloses: readonly CashClose[];
  services: readonly Service[];
  practitioners: readonly Practitioner[];
  memberships: readonly Membership[];
  users: readonly User[];
}

export interface ReportRange {
  from: ClinicDay;
  to: ClinicDay;
  /** One doctor's rows only; null for every doctor (the owner's "الكل"). */
  practitionerId: string | null;
}

/** The longest range a report takes, in days, both ends included. */
export const MAX_RANGE_DAYS = 366;

export type RangeProblem = "invalid" | "reversed" | "too_long";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isClinicDay(value: string): value is ClinicDay {
  if (!DAY_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Why a typed range cannot be reported on, or null when it can. */
export function rangeProblem(from: string, to: string): RangeProblem | null {
  if (!isClinicDay(from) || !isClinicDay(to)) {
    return "invalid";
  }
  if (from > to) {
    return "reversed";
  }
  return addDaysToClinicDay(from, MAX_RANGE_DAYS - 1) < to ? "too_long" : null;
}

/** This month so far's range: its first day to `today`. */
export function defaultRange(today: ClinicDay): { from: ClinicDay; to: ClinicDay } {
  return { from: `${today.slice(0, 8)}01` as ClinicDay, to: today };
}

/**
 * Who may open the reports page: the owner, and a doctor's own membership —
 * one tied to a practitioner, whatever its role (domain/clinicalAccess.ts:
 * the staff form makes a doctor's login as an assistant or manager tied to
 * that doctor). A front-desk assistant or manager tied to no doctor gets no
 * page.
 */
export function canSeeReports(membership: Pick<Membership, "role" | "practitioner_id">): boolean {
  return membership.role === Role.Owner || membership.practitioner_id !== null;
}

/** The doctor a membership's reports are held to: none for the owner (it picks), its own for a doctor. */
export function fixedPractitionerId(membership: Pick<Membership, "role" | "practitioner_id">): string | null {
  return membership.role === Role.Owner ? null : membership.practitioner_id;
}

const VISIT_STATUS_LABELS: Record<string, string> = {
  [VisitStatus.Booked]: S.statusBooked,
  [VisitStatus.Confirmed]: S.statusConfirmed,
  [VisitStatus.Arrived]: S.statusArrived,
  [VisitStatus.InRoom]: S.statusInRoom,
  [VisitStatus.Completed]: S.statusCompleted,
  [VisitStatus.Cancelled]: S.statusCancelled,
  [VisitStatus.NoShow]: S.statusNoShow,
  [VisitStatus.Rescheduled]: T.statusRescheduled,
};

const CANCEL_REASON_LABELS: Record<string, string> = {
  [CancelReason.Patient]: S.cancelReasonPatient,
  [CancelReason.Clinic]: S.cancelReasonClinic,
  [CancelReason.NoShow]: S.statusNoShow,
  [CancelReason.Postpone]: T.cancelReasonPostpone,
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  [InvoiceStatus.Unpaid]: S.invoiceStatusUnpaid,
  [InvoiceStatus.Partial]: S.invoiceStatusPartial,
  [InvoiceStatus.Paid]: S.invoiceStatusPaid,
  [InvoiceStatus.Void]: S.invoiceStatusVoid,
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  [PaymentMethod.Cash]: S.paymentMethodCash,
  [PaymentMethod.Card]: S.paymentMethodCard,
  [PaymentMethod.Wallet]: S.paymentMethodWallet,
  [PaymentMethod.Transfer]: S.paymentMethodTransfer,
};

const BOOKED = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed]);
const RESERVED = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed, VisitStatus.Arrived, VisitStatus.InRoom]);
const ATTENDED = new Set<string>([VisitStatus.Arrived, VisitStatus.InRoom, VisitStatus.Completed]);

/** The lookups and range tests every report shares. */
class Context {
  readonly patientName: (id: string) => string;
  readonly doctorName: (id: string) => string;
  readonly staff: (membershipId: string) => string;
  readonly visitsById: Map<string, Visit>;
  readonly invoicesById: Map<string, Invoice>;

  readonly data: ReportData;
  readonly range: ReportRange;

  constructor(data: ReportData, range: ReportRange) {
    this.data = data;
    this.range = range;
    const patients = new Map(data.patients.map((patient) => [patient.id, patient.full_name]));
    const doctors = new Map(data.practitioners.map((practitioner) => [practitioner.id, practitioner.full_name]));
    const memberships = new Map(data.memberships.map((membership) => [membership.id, membership]));
    const users = new Map(data.users.map((user) => [user.id, user]));
    this.patientName = (id) => patients.get(id) ?? T.unknownName;
    this.doctorName = (id) => doctors.get(id) ?? T.unknownName;
    this.staff = (membershipId) => {
      const membership = memberships.get(membershipId);
      return (membership ? staffName(membership, users.get(membership.user_id)) : null) ?? T.unknownName;
    };
    this.visitsById = new Map(data.visits.map((visit) => [visit.id, visit]));
    this.invoicesById = new Map(data.invoices.map((invoice) => [invoice.id, invoice]));
  }

  inRange(day: ClinicDay): boolean {
    return day >= this.range.from && day <= this.range.to;
  }

  instantInRange(instant: string): boolean {
    return this.inRange(todayInCairo(new Date(instant)));
  }

  ofDoctor(practitionerId: string): boolean {
    return this.range.practitionerId === null || practitionerId === this.range.practitionerId;
  }

  visits(): Visit[] {
    return this.data.visits.filter((visit) => this.ofDoctor(visit.practitioner_id));
  }

  invoices(): Invoice[] {
    return this.data.invoices.filter((invoice) => this.ofDoctor(invoice.practitioner_id));
  }

  /** Payments on this doctor's invoices (every payment for "الكل"). */
  payments(): Payment[] {
    return this.data.payments.filter((payment) => {
      const invoice = this.invoicesById.get(payment.invoice_id);
      return invoice ? this.ofDoctor(invoice.practitioner_id) : this.range.practitionerId === null;
    });
  }
}

const count = (label: string, value: number): ReportFigure => ({ label, value, kind: "count" });
const money = (label: string, value: number): ReportFigure => ({ label, value, kind: "money" });
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const VISIT_COLUMNS: ReportColumn[] = [
  { label: T.colPatient, kind: "text" },
  { label: T.colDoctor, kind: "text" },
  { label: T.colVisitDay, kind: "day" },
  { label: T.colStatus, kind: "text" },
  { label: T.colCancelReason, kind: "text" },
  { label: T.colBookedAt, kind: "instant" },
  { label: T.colArrivedAt, kind: "instant" },
  { label: T.colStartedAt, kind: "instant" },
  { label: T.colEndedAt, kind: "instant" },
];

function visitRow(context: Context, visit: Visit): ReportValue[] {
  return [
    context.patientName(visit.patient_id),
    context.doctorName(visit.practitioner_id),
    visit.visit_date,
    VISIT_STATUS_LABELS[visit.status] ?? visit.status,
    visit.cancel_reason ? (CANCEL_REASON_LABELS[visit.cancel_reason] ?? visit.cancel_reason) : null,
    visit.created_at,
    visit.arrived_at,
    visit.started_at,
    visit.ended_at,
  ];
}

function visitFigures(visits: readonly Visit[]): ReportFigure[] {
  const withStatus = (statuses: readonly string[]) => visits.filter((visit) => statuses.includes(visit.status)).length;
  return [
    count(T.figVisits, visits.length),
    count(T.figBooked, visits.filter((visit) => BOOKED.has(visit.status)).length),
    count(T.figArrived, withStatus([VisitStatus.Arrived])),
    count(T.figInRoom, withStatus([VisitStatus.InRoom])),
    count(T.figCompleted, withStatus([VisitStatus.Completed])),
    count(T.figCancelled, withStatus([VisitStatus.Cancelled])),
    count(T.figNoShow, withStatus([VisitStatus.NoShow])),
  ];
}

const byVisitTime = (a: Visit, b: Visit) =>
  a.visit_date.localeCompare(b.visit_date) || (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "") || a.position - b.position;

function visitsReport(context: Context): Report {
  const visits = context.visits().filter((visit) => context.inRange(visit.visit_date)).sort(byVisitTime);
  return { key: "visits", title: T.titleVisits, figures: visitFigures(visits), columns: VISIT_COLUMNS, rows: visits.map((visit) => visitRow(context, visit)) };
}

function bookingActivityReport(context: Context): Report {
  const visits = context
    .visits()
    .filter((visit) => context.instantInRange(visit.created_at))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    key: "booking_activity",
    title: T.titleBookingActivity,
    figures: visitFigures(visits),
    columns: VISIT_COLUMNS,
    rows: visits.map((visit) => visitRow(context, visit)),
  };
}

function cancellationsReport(context: Context): Report {
  const visits = context
    .visits()
    .filter((visit) => context.inRange(visit.visit_date) && (visit.status === VisitStatus.Cancelled || visit.status === VisitStatus.NoShow))
    .sort(byVisitTime);
  const cancelledFor = (reason: string) =>
    visits.filter((visit) => visit.status === VisitStatus.Cancelled && visit.cancel_reason === reason).length;
  return {
    key: "cancellations_no_shows",
    title: T.titleCancellations,
    figures: [
      count(T.figVisits, visits.length),
      count(T.figCancelled, visits.filter((visit) => visit.status === VisitStatus.Cancelled).length),
      count(T.figNoShow, visits.filter((visit) => visit.status === VisitStatus.NoShow).length),
      count(T.figCancelledByPatient, cancelledFor(CancelReason.Patient)),
      count(T.figCancelledByClinic, cancelledFor(CancelReason.Clinic)),
      count(T.figPostponed, cancelledFor(CancelReason.Postpone)),
    ],
    columns: VISIT_COLUMNS,
    rows: visits.map((visit) => visitRow(context, visit)),
  };
}

function patientActivityReport(context: Context): Report {
  const visits = context.visits();
  const doctorsPatients = new Set(visits.map((visit) => visit.patient_id));
  const attended = visits.filter((visit) => ATTENDED.has(visit.status));
  const inRangeCount = new Map<string, number>();
  const before = new Set<string>();
  for (const visit of attended) {
    if (context.inRange(visit.visit_date)) {
      inRangeCount.set(visit.patient_id, (inRangeCount.get(visit.patient_id) ?? 0) + 1);
    } else if (visit.visit_date < context.range.from) {
      before.add(visit.patient_id);
    }
  }
  const isNew = (patient: Patient) =>
    context.instantInRange(patient.created_at) && (context.range.practitionerId === null || doctorsPatients.has(patient.id));
  const patients = context.data.patients
    .filter((patient) => isNew(patient) || inRangeCount.has(patient.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const active = patients.filter((patient) => inRangeCount.has(patient.id));
  return {
    key: "patient_activity",
    title: T.titlePatientActivity,
    figures: [
      count(T.figProfiles, patients.length),
      count(T.figNewProfiles, patients.filter(isNew).length),
      count(T.figActivePatients, active.length),
      count(T.figReturningPatients, active.filter((patient) => before.has(patient.id)).length),
    ],
    columns: [
      { label: T.colPatient, kind: "text" },
      { label: T.colProfileCreatedAt, kind: "instant" },
      { label: T.colArchivedAt, kind: "instant" },
      { label: T.colAttendedVisits, kind: "count" },
      { label: T.colHadPriorVisit, kind: "flag" },
    ],
    rows: patients.map((patient) => [
      patient.full_name,
      patient.created_at,
      patient.archived_at ?? null,
      inRangeCount.get(patient.id) ?? 0,
      before.has(patient.id),
    ]),
  };
}

function serviceUsageReport(context: Context): Report {
  const services = new Map(context.data.services.map((service) => [service.id, service.name]));
  const rows = new Map<string, { label: string; reserved: number; completed: number }>();
  const row = (serviceId: string, label: string) => {
    const key = `${serviceId}\u0000${label}`;
    const existing = rows.get(key);
    if (existing) {
      return existing;
    }
    const created = { label, reserved: 0, completed: 0 };
    rows.set(key, created);
    return created;
  };
  const visits = context.visits().filter((visit) => context.inRange(visit.visit_date));
  for (const visit of visits) {
    if (RESERVED.has(visit.status) && visit.service_id) {
      row(visit.service_id, services.get(visit.service_id) ?? T.unknownName).reserved += 1;
    }
  }
  const completedVisitIds = new Set(visits.filter((visit) => visit.status === VisitStatus.Completed).map((visit) => visit.id));
  const completedInvoiceIds = new Set(
    context.data.invoices
      .filter((invoice) => invoice.visit_id !== null && completedVisitIds.has(invoice.visit_id) && invoice.status !== InvoiceStatus.Void)
      .map((invoice) => invoice.id),
  );
  for (const item of context.data.invoiceItems) {
    if (completedInvoiceIds.has(item.invoice_id)) {
      row(item.service_id, item.description).completed += item.qty;
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.completed + b.reserved - (a.completed + a.reserved) || a.label.localeCompare(b.label));
  return {
    key: "service_usage",
    title: T.titleServiceUsage,
    figures: [
      count(T.figServices, sorted.length),
      count(T.figReserved, sum(sorted.map((entry) => entry.reserved))),
      count(T.figDone, sum(sorted.map((entry) => entry.completed))),
    ],
    columns: [
      { label: T.colService, kind: "text" },
      { label: T.colReserved, kind: "count" },
      { label: T.colDone, kind: "count" },
    ],
    rows: sorted.map((entry) => [entry.label, entry.reserved, entry.completed]),
  };
}

const INVOICE_COLUMNS: ReportColumn[] = [
  { label: T.colInvoiceNumber, kind: "text" },
  { label: T.colPatient, kind: "text" },
  { label: T.colDoctor, kind: "text" },
  { label: T.colStatus, kind: "text" },
  { label: T.colTotal, kind: "money" },
  { label: T.colPaid, kind: "money" },
  { label: T.colBalance, kind: "money" },
  { label: T.colIssuedAt, kind: "instant" },
];

function invoiceRow(context: Context, invoice: Invoice): ReportValue[] {
  return [
    formatInvoiceNumber(invoice),
    context.patientName(invoice.patient_id),
    context.doctorName(invoice.practitioner_id),
    INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status,
    invoice.total,
    invoice.paid,
    invoice.status === InvoiceStatus.Void ? 0 : invoice.total - invoice.paid,
    invoice.issued_at,
  ];
}

function issuedInRange(context: Context): Invoice[] {
  return context
    .invoices()
    .filter((invoice) => context.instantInRange(invoice.issued_at))
    .sort((a, b) => a.issued_at.localeCompare(b.issued_at));
}

function invoicingReport(context: Context): Report {
  const invoices = issuedInRange(context);
  const lastPaymentAt = new Map<string, string>();
  for (const payment of context.data.payments) {
    const at = lastPaymentAt.get(payment.invoice_id);
    if (at === undefined || payment.created_at > at) {
      lastPaymentAt.set(payment.invoice_id, payment.created_at);
    }
  }
  const live = invoices.filter((invoice) => invoice.status !== InvoiceStatus.Void);
  const withStatus = (status: string) => invoices.filter((invoice) => invoice.status === status);
  return {
    key: "invoicing",
    title: T.titleInvoicing,
    figures: [
      count(T.figInvoices, invoices.length),
      count(S.invoiceStatusUnpaid, withStatus(InvoiceStatus.Unpaid).length),
      count(S.invoiceStatusPartial, withStatus(InvoiceStatus.Partial).length),
      count(S.invoiceStatusPaid, withStatus(InvoiceStatus.Paid).length),
      count(S.invoiceStatusVoid, withStatus(InvoiceStatus.Void).length),
      money(T.figBalance, sum(live.map((invoice) => invoice.total - invoice.paid))),
      money(T.figPaid, sum(live.map((invoice) => invoice.paid))),
      money(T.figVoided, sum(withStatus(InvoiceStatus.Void).map((invoice) => invoice.total))),
    ],
    columns: [...INVOICE_COLUMNS, { label: T.colPaidAt, kind: "instant" }],
    rows: invoices.map((invoice) => [
      ...invoiceRow(context, invoice),
      invoice.status === InvoiceStatus.Paid ? (lastPaymentAt.get(invoice.id) ?? null) : null,
    ]),
  };
}

function unpaidInvoicesReport(context: Context): Report {
  const invoices = issuedInRange(context).filter(
    (invoice) => invoice.status === InvoiceStatus.Unpaid || invoice.status === InvoiceStatus.Partial,
  );
  return {
    key: "unpaid_invoices",
    title: T.titleUnpaidInvoices,
    figures: [
      count(T.figInvoices, invoices.length),
      count(S.invoiceStatusPartial, invoices.filter((invoice) => invoice.status === InvoiceStatus.Partial).length),
      money(T.figBalance, sum(invoices.map((invoice) => invoice.total - invoice.paid))),
    ],
    columns: INVOICE_COLUMNS,
    rows: invoices.map((invoice) => invoiceRow(context, invoice)),
  };
}

function paymentsInRange(context: Context): Payment[] {
  return context
    .payments()
    .filter((payment) => context.instantInRange(payment.created_at))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function collectionsReport(context: Context): Report {
  const payments = paymentsInRange(context);
  return {
    key: "collections",
    title: T.titleCollections,
    figures: [
      count(T.figPayments, payments.length),
      money(T.figCollected, sum(payments.map((payment) => payment.amount))),
      money(S.paymentMethodCash, sum(payments.filter((payment) => payment.method === PaymentMethod.Cash).map((payment) => payment.amount))),
    ],
    columns: [
      { label: T.colReceiptNumber, kind: "text" },
      { label: T.colInvoiceNumber, kind: "text" },
      { label: T.colPatient, kind: "text" },
      { label: T.colReceivedBy, kind: "text" },
      { label: T.colMethod, kind: "text" },
      { label: T.colAmount, kind: "money" },
      { label: T.colPaidAt, kind: "instant" },
      { label: T.colAfterClose, kind: "flag" },
    ],
    rows: payments.map((payment) => {
      const invoice = context.invoicesById.get(payment.invoice_id);
      return [
        formatReceiptNumber(payment),
        invoice ? formatInvoiceNumber(invoice) : null,
        invoice ? context.patientName(invoice.patient_id) : null,
        context.staff(payment.created_by),
        PAYMENT_METHOD_LABELS[payment.method] ?? payment.method,
        payment.amount,
        payment.created_at,
        payment.after_close,
      ];
    }),
  };
}

function cashCloseReport(context: Context): Report {
  // A day's close counts the whole clinic's drawer: it is no one doctor's.
  const closes =
    context.range.practitionerId === null
      ? context.data.cashCloses.filter((close) => context.inRange(close.date)).sort((a, b) => a.date.localeCompare(b.date))
      : [];
  return {
    key: "cash_close",
    title: T.titleCashClose,
    note: context.range.practitionerId === null ? undefined : T.cashCloseWholeClinicNote,
    figures: [
      count(T.figCloses, closes.length),
      money(T.figOpening, sum(closes.map((close) => close.opening_amount))),
      money(T.figExpected, sum(closes.map((close) => close.total_expected))),
      money(T.figCounted, sum(closes.map((close) => close.total_collected))),
      money(T.figDifference, sum(closes.map((close) => close.difference))),
    ],
    columns: [
      { label: T.colDay, kind: "day" },
      { label: T.colOpening, kind: "money" },
      { label: T.colCashCollected, kind: "money" },
      { label: T.colExpected, kind: "money" },
      { label: T.colCounted, kind: "money" },
      { label: T.colDifference, kind: "money" },
      { label: T.colClosedAt, kind: "instant" },
      { label: T.colClosedBy, kind: "text" },
      { label: T.colDifferenceNote, kind: "text" },
    ],
    rows: closes.map((close) => [
      close.date,
      close.opening_amount,
      close.total_expected - close.opening_amount,
      close.total_expected,
      close.total_collected,
      close.difference,
      close.closed_at,
      context.staff(close.closed_by),
      close.difference_note,
    ]),
  };
}

function staffCollectionsReport(context: Context): Report {
  const payments = paymentsInRange(context);
  const byCollector = new Map<string, { name: string; count: number; amount: number }>();
  for (const payment of payments) {
    const entry = byCollector.get(payment.created_by) ?? { name: context.staff(payment.created_by), count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += payment.amount;
    byCollector.set(payment.created_by, entry);
  }
  const rows = [...byCollector.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return {
    key: "staff_collections",
    title: T.titleStaffCollections,
    figures: [
      count(T.figCollectors, rows.length),
      count(T.figPayments, payments.length),
      money(T.figCollected, sum(payments.map((payment) => payment.amount))),
    ],
    columns: [
      { label: T.colStaff, kind: "text" },
      { label: T.colPaymentsCount, kind: "count" },
      { label: T.colCollected, kind: "money" },
    ],
    rows: rows.map((entry) => [entry.name, entry.count, entry.amount]),
  };
}

const BUILDERS: Record<ReportKey, (context: Context) => Report> = {
  visits: visitsReport,
  booking_activity: bookingActivityReport,
  cancellations_no_shows: cancellationsReport,
  patient_activity: patientActivityReport,
  service_usage: serviceUsageReport,
  invoicing: invoicingReport,
  collections: collectionsReport,
  unpaid_invoices: unpaidInvoicesReport,
  cash_close: cashCloseReport,
  staff_collections: staffCollectionsReport,
};

/** One report over `range`, from `data`. */
export function buildReport(key: ReportKey, data: ReportData, range: ReportRange): Report {
  return BUILDERS[key](new Context(data, range));
}

/** A report's title as the picker shows it, without computing it. */
export const REPORT_TITLES: Record<ReportKey, string> = {
  visits: T.titleVisits,
  booking_activity: T.titleBookingActivity,
  cancellations_no_shows: T.titleCancellations,
  patient_activity: T.titlePatientActivity,
  service_usage: T.titleServiceUsage,
  invoicing: T.titleInvoicing,
  collections: T.titleCollections,
  unpaid_invoices: T.titleUnpaidInvoices,
  cash_close: T.titleCashClose,
  staff_collections: T.titleStaffCollections,
};

function csvCell(kind: ColumnKind, value: ReportValue): CsvCell {
  if (value === null) {
    return null;
  }
  switch (kind) {
    case "money":
      return csvMoney(value as Piastres);
    case "count":
      return csvNumber(value as number);
    case "flag":
      return csvFlag(value as boolean);
    default:
      return csvText(String(value));
  }
}

/** A money column's CSV label says its unit. */
function csvLabel(column: ReportColumn): string {
  return column.kind === "money" ? `${column.label} (${T.currencyUnit})` : column.label;
}

/** The report as a CSV document (domain/csv.ts's rules); instants stay ISO UTC, days YYYY-MM-DD. */
export function reportCsv(report: Report): string {
  return writeCsv(
    report.columns.map(csvLabel),
    report.rows.map((row) => row.map((value, index) => csvCell(report.columns[index].kind, value))),
  );
}

/** The downloaded file's name: the report and its range. */
export function reportFileName(key: ReportKey, range: Pick<ReportRange, "from" | "to">): string {
  return `clintra-${key.replaceAll("_", "-")}-${range.from}-${range.to}.csv`;
}
