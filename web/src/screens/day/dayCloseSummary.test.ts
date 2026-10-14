import { describe, expect, it } from "vitest";
import { InvoiceStatus, PaymentMethod, type CashClose, type Invoice, type Payment, type Visit } from "../../db/types";
import type { Piastres } from "../../domain/money";
import { cairoInstant } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import { buildDayCloseSummary } from "./dayCloseSummary";
import { formatPrintedAt } from "./printedAt";

const DAY = "2026-09-07";
const LOCATION = "location-1";

function visit(id: string, status: VisitStatus): Visit {
  return {
    id,
    org_id: "org-1",
    location_id: LOCATION,
    practitioner_id: "practitioner-1",
    patient_id: `patient-${id}`,
    service_id: null,
    care_plan_item_id: null,
    visit_date: DAY,
    position: 1,
    scheduled_at: null,
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: cairoInstant(DAY, "08:00"),
    note: null,
    rev: 1,
  };
}

function invoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id,
    org_id: "org-1",
    location_id: LOCATION,
    number: 1,
    issued_year: 2026,
    series: 1,
    patient_id: "patient-1",
    practitioner_id: "practitioner-1",
    visit_id: null,
    total: 40000 as Piastres,
    paid: 0 as Piastres,
    status: InvoiceStatus.Unpaid,
    issued_at: cairoInstant(DAY, "10:00"),
    rev: 1,
    ...overrides,
  };
}

function payment(id: string, invoiceId: string, amount: number, method: PaymentMethod): Payment {
  return {
    id,
    invoice_id: invoiceId,
    location_id: LOCATION,
    amount: amount as Piastres,
    method,
    receipt_number: id,
    series: 1,
    note: null,
    after_close: false,
    created_by: "membership-1",
    created_at: cairoInstant(DAY, "10:05"),
    rev: 1,
  };
}

const CLOSE: CashClose = {
  id: "close-1",
  location_id: LOCATION,
  date: DAY,
  total_expected: 90000 as Piastres,
  total_collected: 85000 as Piastres,
  difference: -5000 as Piastres,
  difference_note: "فكة ناقصة",
  closed_by: "membership-1",
  closed_at: cairoInstant(DAY, "18:12"),
  rev: 1,
};

describe("buildDayCloseSummary", () => {
  const summary = buildDayCloseSummary(
    {
      date: DAY,
      visits: [
        visit("v1", VisitStatus.Completed),
        visit("v2", VisitStatus.Completed),
        visit("v3", VisitStatus.NoShow),
        visit("v4", VisitStatus.Cancelled),
        visit("v5", VisitStatus.Cancelled),
        visit("v6", VisitStatus.Booked),
      ],
      invoices: [
        invoice("i1"),
        invoice("i2"),
        // Another day's invoice, another location's and a void one count nothing.
        invoice("i3", { issued_at: cairoInstant("2026-09-06", "10:00") }),
        invoice("i4", { location_id: "location-2" }),
        invoice("i5", { status: InvoiceStatus.Void }),
      ],
      payments: [
        payment("p1", "i1", 30000, PaymentMethod.Cash),
        payment("p2", "i1", 10000, PaymentMethod.Card),
        payment("p3", "i2", 20000, PaymentMethod.Wallet),
        payment("p4", "i2", 30000, PaymentMethod.Cash),
        payment("p5", "i3", 99900, PaymentMethod.Cash),
        payment("p6", "i4", 99900, PaymentMethod.Transfer),
        payment("p7", "i5", 99900, PaymentMethod.Cash),
      ],
      cashClose: CLOSE,
      closedByName: "سارة حسن",
    },
    cairoInstant("2026-09-07", "18:15"),
  );

  it("titles the page with the day's weekday and full date", () => {
    expect(summary.title).toBe("إقفال يوم الاثنين 7 سبتمبر 2026");
  });

  it("counts the patients seen (completed), the no-shows and the cancellations", () => {
    expect(summary.seenCount).toBe(2);
    expect(summary.noShowCount).toBe(1);
    expect(summary.cancelledCount).toBe(2);
  });

  it("collects the day's invoices' payments by method, all four always listed", () => {
    expect(summary.byMethod).toEqual([
      { method: PaymentMethod.Cash, label: "كاش", amount: 60000 },
      { method: PaymentMethod.Card, label: "فيزا", amount: 10000 },
      { method: PaymentMethod.Wallet, label: "محفظة", amount: 20000 },
      { method: PaymentMethod.Transfer, label: "تحويل", amount: 0 },
    ]);
    expect(summary.totalCollected).toBe(90000);
  });

  it("carries the close's own figures, its note, who closed it and when it was printed", () => {
    expect(summary.expected).toBe(90000);
    expect(summary.counted).toBe(85000);
    expect(summary.difference).toBe(-5000);
    expect(summary.differenceNote).toBe("فكة ناقصة");
    expect(summary.closedByName).toBe("سارة حسن");
    expect(summary.printedAt).toBe("طُبعت 7 سبتمبر 18:15");
  });
});

describe("formatPrintedAt", () => {
  it("reads the print's day and 24-hour time in Cairo", () => {
    expect(formatPrintedAt(cairoInstant("2026-09-07", "06:15"))).toBe("طُبعت 7 سبتمبر 06:15");
    expect(formatPrintedAt(cairoInstant("2026-10-14", "23:59"))).toBe("طُبعت 14 أكتوبر 23:59");
  });
});
