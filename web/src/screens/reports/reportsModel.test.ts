import { describe, expect, it } from "vitest";
import type { Piastres } from "../../domain/money";
import { LocationScope, PractitionerScope } from "../../domain/scope";
import { Role } from "../../domain/role";
import type { ClinicDay } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
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
import {
  buildReport,
  canSeeReports,
  defaultRange,
  fixedPractitionerId,
  rangeProblem,
  reportCsv,
  reportFileName,
  type Report,
  type ReportData,
  type ReportKey,
} from "./reportsModel";
import { reportsStrings as T } from "./strings";

// Two doctors' November (2026-11-01..30), with a few rows either side of it.
// Times are UTC; Cairo is UTC+2 in November, and no row sits near midnight.

const p = (value: number) => value as Piastres;
const NOVEMBER = { from: "2026-11-01" as ClinicDay, to: "2026-11-30" as ClinicDay };

function patient(id: string, name: string, createdAt: string, archivedAt: string | null = null): Patient {
  return { id, org_id: "org", full_name: name, phone: null, gender: null, birth_year: null, note: null, created_at: createdAt, archived_at: archivedAt, rev: 1 } as Patient;
}

function visit(id: string, doctor: string, patientId: string, date: string, status: VisitStatus, createdAt: string, extra: Partial<Visit> = {}): Visit {
  return {
    id,
    org_id: "org",
    location_id: "loc",
    practitioner_id: doctor,
    patient_id: patientId,
    service_id: "svc-exam",
    care_plan_item_id: null,
    visit_date: date,
    position: 1,
    scheduled_at: `${date}T07:00:00.000Z`,
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "m-assistant",
    created_at: createdAt,
    note: null,
    rev: 1,
    ...extra,
  } as Visit;
}

function invoice(id: string, number: number, doctor: string, patientId: string, visitId: string | null, total: number, paid: number, status: InvoiceStatus, issuedAt: string): Invoice {
  return {
    id,
    org_id: "org",
    location_id: "loc",
    number,
    issued_year: 2026,
    series: 1,
    patient_id: patientId,
    practitioner_id: doctor,
    visit_id: visitId,
    total: p(total),
    paid: p(paid),
    status,
    issued_at: issuedAt,
    rev: 1,
  } as Invoice;
}

function item(id: string, invoiceId: string, serviceId: string, description: string, qty: number, unit: number): InvoiceItem {
  return { id, invoice_id: invoiceId, service_id: serviceId, description, qty, unit_price: p(unit), total: p(qty * unit), rev: 1 } as InvoiceItem;
}

function payment(id: string, invoiceId: string, amount: number, method: PaymentMethod, by: string, at: string, receipt: number): Payment {
  return {
    id,
    invoice_id: invoiceId,
    location_id: "loc",
    amount: p(amount),
    method,
    receipt_number: receipt,
    series: 1,
    note: null,
    after_close: false,
    created_by: by,
    created_at: at,
    rev: 1,
  } as unknown as Payment;
}

function membership(id: string, role: Role, userId: string, displayName: string, practitionerId: string | null = null): Membership {
  return {
    id,
    user_id: userId,
    org_id: "org",
    role,
    location_scope: LocationScope.All,
    practitioner_scope: practitionerId ? PractitionerScope.Self : PractitionerScope.All,
    practitioner_id: practitionerId,
    pin_hash: "h",
    pin_salt: "s",
    is_active: true,
    display_name: displayName,
    rev: 1,
  } as Membership;
}

const data: ReportData = {
  practitioners: [
    { id: "d1", org_id: "org", full_name: "منى سالم", rev: 1 } as Practitioner,
    { id: "d2", org_id: "org", full_name: "كريم فؤاد", rev: 1 } as Practitioner,
  ],
  patients: [
    patient("p1", "أحمد علي", "2026-10-01T08:00:00.000Z"),
    patient("p2", "سارة حسن", "2026-11-04T08:00:00.000Z"),
    patient("p3", "=HYPERLINK(1)", "2026-11-09T08:00:00.000Z", "2026-11-25T08:00:00.000Z"),
  ],
  visits: [
    visit("v1", "d1", "p1", "2026-10-20", VisitStatus.Completed, "2026-10-19T08:00:00.000Z"),
    visit("v2", "d1", "p1", "2026-11-03", VisitStatus.Completed, "2026-10-25T08:00:00.000Z", {
      arrived_at: "2026-11-03T07:00:00.000Z",
      started_at: "2026-11-03T07:10:00.000Z",
      ended_at: "2026-11-03T07:30:00.000Z",
    }),
    visit("v3", "d1", "p2", "2026-11-05", VisitStatus.Cancelled, "2026-11-04T08:00:00.000Z", { cancel_reason: CancelReason.Patient }),
    visit("v4", "d2", "p3", "2026-11-10", VisitStatus.NoShow, "2026-11-09T08:00:00.000Z"),
    visit("v5", "d2", "p2", "2026-12-02", VisitStatus.Booked, "2026-11-20T08:00:00.000Z"),
    visit("v6", "d1", "p2", "2026-11-28", VisitStatus.Arrived, "2026-11-27T08:00:00.000Z"),
    visit("v7", "d2", "p3", "2026-11-12", VisitStatus.Completed, "2026-11-11T08:00:00.000Z", { service_id: "svc-follow" }),
  ],
  invoices: [
    invoice("i0", 1, "d1", "p1", "v1", 10000, 10000, InvoiceStatus.Paid, "2026-10-20T08:00:00.000Z"),
    invoice("i1", 2, "d1", "p1", "v2", 30000, 30000, InvoiceStatus.Paid, "2026-11-03T08:00:00.000Z"),
    invoice("i2", 3, "d2", "p3", "v7", 50000, 20000, InvoiceStatus.Partial, "2026-11-12T09:00:00.000Z"),
    invoice("i3", 4, "d1", "p2", null, 10000, 0, InvoiceStatus.Void, "2026-11-15T09:00:00.000Z"),
  ],
  invoiceItems: [
    item("it0", "i0", "svc-exam", "كشف", 1, 10000),
    item("it1", "i1", "svc-exam", "كشف", 1, 30000),
    item("it2", "i2", "svc-follow", "متابعة", 2, 25000),
  ],
  payments: [
    payment("pay0", "i0", 10000, PaymentMethod.Cash, "m-assistant", "2026-10-20T08:05:00.000Z", 1),
    payment("pay1", "i1", 30000, PaymentMethod.Cash, "m-assistant", "2026-11-03T08:05:00.000Z", 2),
    payment("pay2", "i2", 20000, PaymentMethod.Card, "m-owner", "2026-11-12T09:10:00.000Z", 3),
  ],
  cashCloses: [
    {
      id: "cc0",
      location_id: "loc",
      date: "2026-10-20",
      opening_amount: p(0),
      total_expected: p(10000),
      total_collected: p(10000),
      difference: p(0),
      difference_note: null,
      closed_by: "m-owner",
      closed_at: "2026-10-20T16:00:00.000Z",
      rev: 1,
    } as CashClose,
    {
      id: "cc1",
      location_id: "loc",
      date: "2026-11-03",
      opening_amount: p(5000),
      total_expected: p(35000),
      total_collected: p(34000),
      difference: p(-1000),
      difference_note: "نقص",
      closed_by: "m-owner",
      closed_at: "2026-11-03T16:00:00.000Z",
      rev: 1,
    } as CashClose,
  ],
  services: [
    { id: "svc-exam", org_id: "org", name: "كشف", duration_minutes: 30, default_price: p(30000), is_active: true, rev: 1 } as Service,
    { id: "svc-follow", org_id: "org", name: "متابعة", duration_minutes: 15, default_price: p(25000), is_active: true, rev: 1 } as Service,
  ],
  memberships: [membership("m-owner", Role.Owner, "u-owner", "د. منى"), membership("m-assistant", Role.Assistant, "u-assistant", "هبة")],
  users: [
    { id: "u-owner", full_name: "Mona Salem", phone: "0100", email: null, is_active: true } as User,
    { id: "u-assistant", full_name: "Heba", phone: "0101", email: null, is_active: true } as User,
  ],
};

const all = (key: ReportKey) => buildReport(key, data, { ...NOVEMBER, practitionerId: null });
const ofD1 = (key: ReportKey) => buildReport(key, data, { ...NOVEMBER, practitionerId: "d1" });

const figures = (report: Report) => Object.fromEntries(report.figures.map((figure) => [figure.label, figure.value]));
const column = (report: Report, label: string) => {
  const index = report.columns.findIndex((candidate) => candidate.label === label);
  expect(index, `column ${label}`).toBeGreaterThanOrEqual(0);
  return report.rows.map((row) => row[index]);
};

describe("visits", () => {
  it("counts the visits dated in the range by status", () => {
    const report = all("visits");
    expect(figures(report)).toEqual({
      [T.figVisits]: 5,
      [T.figBooked]: 0,
      [T.figArrived]: 1,
      [T.figInRoom]: 0,
      [T.figCompleted]: 2,
      [T.figCancelled]: 1,
      [T.figNoShow]: 1,
    });
    expect(column(report, T.colPatient)).toEqual(["أحمد علي", "سارة حسن", "=HYPERLINK(1)", "=HYPERLINK(1)", "سارة حسن"]);
    expect(column(report, T.colDoctor)).toEqual(["منى سالم", "منى سالم", "كريم فؤاد", "كريم فؤاد", "منى سالم"]);
  });

  it("holds to one doctor", () => {
    expect(figures(ofD1("visits"))[T.figVisits]).toBe(3);
  });
});

describe("booking activity", () => {
  it("counts the visits booked in the range, whatever day they are for", () => {
    const report = all("booking_activity");
    expect(figures(report)[T.figVisits]).toBe(5);
    expect(column(report, T.colVisitDay)).toEqual(["2026-11-05", "2026-11-10", "2026-11-12", "2026-12-02", "2026-11-28"]);
  });
});

describe("cancellations and no-shows", () => {
  it("lists the cancelled and no-show visits dated in the range, with the reason", () => {
    const report = all("cancellations_no_shows");
    expect(figures(report)).toMatchObject({ [T.figVisits]: 2, [T.figCancelled]: 1, [T.figNoShow]: 1, [T.figCancelledByPatient]: 1 });
    expect(column(report, T.colCancelReason)).toEqual(["المريض", null]);
  });
});

describe("patient activity", () => {
  it("counts new profiles, patients who came and those who had come before", () => {
    const report = all("patient_activity");
    expect(figures(report)).toEqual({
      [T.figProfiles]: 3,
      [T.figNewProfiles]: 2,
      [T.figActivePatients]: 3,
      [T.figReturningPatients]: 1,
    });
    expect(column(report, T.colHadPriorVisit)).toEqual([true, false, false]);
    expect(column(report, T.colArchivedAt)).toEqual([null, null, "2026-11-25T08:00:00.000Z"]);
  });

  it("holds to the patients one doctor saw", () => {
    const report = ofD1("patient_activity");
    expect(column(report, T.colPatient)).toEqual(["أحمد علي", "سارة حسن"]);
    expect(figures(report)[T.figNewProfiles]).toBe(1);
  });
});

describe("service usage", () => {
  it("counts the reserved visits by service and the completed visits' invoice lines", () => {
    const report = all("service_usage");
    expect(report.rows).toEqual([
      ["كشف", 1, 1],
      ["متابعة", 0, 2],
    ]);
    expect(figures(report)).toEqual({ [T.figServices]: 2, [T.figReserved]: 1, [T.figDone]: 3 });
  });
});

describe("invoicing", () => {
  it("counts the invoices issued in the range by status, with the balance, the paid and the voided", () => {
    const report = all("invoicing");
    expect(figures(report)).toMatchObject({
      [T.figInvoices]: 3,
      [T.figBalance]: 30000,
      [T.figPaid]: 50000,
      [T.figVoided]: 10000,
    });
    expect(column(report, T.colPaidAt)).toEqual(["2026-11-03T08:05:00.000Z", null, null]);
    expect(column(report, T.colBalance)).toEqual([0, 30000, 0]);
  });
});

describe("unpaid invoices", () => {
  it("lists the unpaid and part-paid invoices issued in the range, with what is left", () => {
    const report = all("unpaid_invoices");
    expect(report.rows).toHaveLength(1);
    expect(figures(report)[T.figBalance]).toBe(30000);
  });
});

describe("collections", () => {
  it("lists the payments taken in the range, naming who took each", () => {
    const report = all("collections");
    expect(figures(report)).toMatchObject({ [T.figPayments]: 2, [T.figCollected]: 50000 });
    expect(column(report, T.colReceivedBy)).toEqual(["هبة", "د. منى"]);
  });

  it("holds to one doctor's invoices", () => {
    expect(figures(ofD1("collections"))[T.figCollected]).toBe(30000);
  });
});

describe("cash close", () => {
  it("lists the days closed in the range with the opening amount", () => {
    const report = all("cash_close");
    expect(report.rows).toEqual([["2026-11-03", 5000, 30000, 35000, 34000, -1000, "2026-11-03T16:00:00.000Z", "د. منى", "نقص"]]);
    expect(figures(report)).toEqual({
      [T.figCloses]: 1,
      [T.figOpening]: 5000,
      [T.figExpected]: 35000,
      [T.figCounted]: 34000,
      [T.figDifference]: -1000,
    });
  });

  it("is the whole clinic's: one doctor's view lists none and says why", () => {
    const report = ofD1("cash_close");
    expect(report.rows).toEqual([]);
    expect(report.note).toBe(T.cashCloseWholeClinicNote);
  });
});

describe("staff collections", () => {
  it("adds up each collector's payments under their name", () => {
    const report = all("staff_collections");
    expect(report.rows).toEqual([
      ["هبة", 1, 30000],
      ["د. منى", 1, 20000],
    ]);
  });
});

describe("a report's CSV", () => {
  it("labels money columns with the currency, writes pounds, ISO times and neutralised names", () => {
    const lines = reportCsv(all("invoicing")).slice(1).split("\r\n");
    expect(lines[0]).toContain(`${T.colTotal} (ج.م)`);
    expect(lines[1]).toContain(",300.00,300.00,0.00,2026-11-03T08:00:00.000Z,2026-11-03T08:05:00.000Z");
    expect(lines[2]).toContain("'=HYPERLINK(1)");
    expect(reportFileName("cash_close", NOVEMBER)).toBe("clintra-cash-close-2026-11-01-2026-11-30.csv");
  });
});

describe("the range", () => {
  it.each([
    ["2026-11-01", "2026-11-30", null],
    ["2026-11-01", "2027-11-01", null],
    ["2026-11-01", "2027-11-02", "too_long"],
    ["2026-11-30", "2026-11-01", "reversed"],
    ["2026-02-30", "2026-03-01", "invalid"],
    ["2026-1-01", "2026-03-01", "invalid"],
  ])("%s to %s: %s", (from, to, problem) => {
    expect(rangeProblem(from, to)).toBe(problem);
  });

  it("defaults to this month so far", () => {
    expect(defaultRange("2026-11-19" as ClinicDay)).toEqual({ from: "2026-11-01", to: "2026-11-19" });
  });
});

describe("who reads reports", () => {
  it("the owner, every doctor; a membership tied to a doctor, that doctor's; the front desk, none", () => {
    const owner = { role: Role.Owner, practitioner_id: "d1" };
    const doctor = { role: Role.Practitioner, practitioner_id: "d2" };
    const doctorsLogin = { role: Role.Assistant, practitioner_id: "d2" };
    expect([canSeeReports(owner), fixedPractitionerId(owner)]).toEqual([true, null]);
    expect([canSeeReports(doctor), fixedPractitionerId(doctor)]).toEqual([true, "d2"]);
    expect([canSeeReports(doctorsLogin), fixedPractitionerId(doctorsLogin)]).toEqual([true, "d2"]);
    expect(canSeeReports({ role: Role.Assistant, practitioner_id: null })).toBe(false);
    expect(canSeeReports({ role: Role.Manager, practitioner_id: null })).toBe(false);
  });
});
