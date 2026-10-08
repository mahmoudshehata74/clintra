import { describe, expect, it } from "vitest";
import type { Invoice } from "../../db/types";
import { InvoiceStatus } from "../../db/types";
import type { Piastres } from "../../domain/money";
import { buildDayInvoicesCsv, csvFileNameForDay, type CsvInvoiceRow } from "./cashCloseCsv";

const DATE = "2026-09-07";

function invoiceFixture(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    org_id: "org-1",
    location_id: "location-1",
    number: 1,
    issued_year: 2026,
    patient_id: "patient-1",
    practitioner_id: "practitioner-1",
    visit_id: "visit-1",
    total: 15000 as Piastres,
    paid: 15000 as Piastres,
    status: InvoiceStatus.Paid,
    issued_at: "2026-09-07T10:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

function row(overrides: Partial<CsvInvoiceRow> = {}): CsvInvoiceRow {
  return {
    invoice: invoiceFixture(),
    patientName: "منى عبد الله",
    itemDescriptions: ["كشف عام"],
    ...overrides,
  };
}

describe("buildDayInvoicesCsv", () => {
  it("emits only the header row when there are no invoices", () => {
    expect(buildDayInvoicesCsv(DATE, [])).toBe("التاريخ,المريض,الخدمة,المبلغ,حالة الدفع\r\n");
  });

  it("emits one row per invoice with the expected columns, CRLF-terminated", () => {
    const csv = buildDayInvoicesCsv(DATE, [row()]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("التاريخ,المريض,الخدمة,المبلغ,حالة الدفع");
    expect(lines[1]).toBe("2026-09-07,منى عبد الله,كشف عام,150,مدفوعة بالكامل");
    expect(lines[2]).toBe(""); // trailing CRLF
  });

  it("joins multiple service items with ' + '", () => {
    const csv = buildDayInvoicesCsv(DATE, [row({ itemDescriptions: ["كشف عام", "أشعة"] })]);
    expect(csv).toContain("كشف عام + أشعة");
  });

  it("formats the amount with a fraction only when the piastres remainder is non-zero, no thousands separator", () => {
    const whole = buildDayInvoicesCsv(DATE, [row({ invoice: invoiceFixture({ total: 123400 as Piastres }) })]);
    expect(whole).toContain(",1234,");
    const fraction = buildDayInvoicesCsv(DATE, [row({ invoice: invoiceFixture({ total: 123450 as Piastres }) })]);
    expect(fraction).toContain(",1234.50,");
  });

  it("maps every invoice status to its existing Arabic label", () => {
    const statuses: [Invoice["status"], string][] = [
      [InvoiceStatus.Unpaid, "غير مدفوعة"],
      [InvoiceStatus.Partial, "مدفوعة جزئيًا"],
      [InvoiceStatus.Paid, "مدفوعة بالكامل"],
      [InvoiceStatus.Void, "ملغاة"],
    ];
    for (const [status, label] of statuses) {
      const csv = buildDayInvoicesCsv(DATE, [row({ invoice: invoiceFixture({ status }) })]);
      expect(csv).toContain(`,${label}\r\n`);
    }
  });

  it("quotes a cell containing a comma", () => {
    const csv = buildDayInvoicesCsv(DATE, [row({ patientName: "محمد, أحمد" })]);
    expect(csv).toContain('"محمد, أحمد"');
  });

  it("quotes a cell containing a double quote, doubling the embedded quote", () => {
    const csv = buildDayInvoicesCsv(DATE, [row({ patientName: 'اسمه "الدكتور"' })]);
    expect(csv).toContain('"اسمه ""الدكتور"""');
  });

  it("quotes a cell containing a newline", () => {
    const csv = buildDayInvoicesCsv(DATE, [row({ patientName: "سطر1\nسطر2" })]);
    expect(csv).toContain('"سطر1\nسطر2"');
  });

  it.each([["=cmd()"], ["+1+1"], ["-1+1"], ["@SUM(1)"], ["\tA1"]])(
    "prefixes a cell beginning with %s with a single quote, so it never runs as a formula",
    (dangerous) => {
      const csv = buildDayInvoicesCsv(DATE, [row({ patientName: dangerous })]);
      const patientCell = csv.split("\r\n")[1].split(",")[1];
      expect(patientCell.startsWith("'")).toBe(true);
      expect(patientCell).toBe(`'${dangerous}`);
    },
  );

  it("does not neutralize a cell that merely contains, but does not start with, a dangerous character", () => {
    const csv = buildDayInvoicesCsv(DATE, [row({ patientName: "أحمد = الدكتور" })]);
    expect(csv).toContain("أحمد = الدكتور");
    expect(csv).not.toContain("'أحمد");
  });
});

describe("csvFileNameForDay", () => {
  it("builds the clintra-{date}.csv file name", () => {
    expect(csvFileNameForDay("2026-09-07")).toBe("clintra-2026-09-07.csv");
  });
});
