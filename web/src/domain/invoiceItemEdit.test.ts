import { describe, expect, it } from "vitest";
import { InvoiceStatus, type InvoiceItem } from "../db/types";
import { diffInvoiceItems, invoiceItemEditRefusal, invoiceTotalOf, lineTotal, unpaidInvoiceStatus } from "./invoiceItemEdit";
import type { Piastres } from "./money";

const p = (value: number) => value as Piastres;

function item(id: string, qty: number, unitPrice: number): InvoiceItem {
  return { id, invoice_id: "inv", service_id: "svc", description: id, qty, unit_price: p(unitPrice), total: p(qty * unitPrice), rev: 1 };
}

describe("invoiceItemEditRefusal", () => {
  it("allows an unpaid, open, not-void invoice", () => {
    expect(invoiceItemEditRefusal({ invoice: { status: InvoiceStatus.Unpaid }, paymentCount: 0, dayClosed: false })).toBeNull();
  });

  it("names a payment first, then void, then a closed day", () => {
    expect(invoiceItemEditRefusal({ invoice: { status: InvoiceStatus.Void }, paymentCount: 1, dayClosed: true })).toBe("has_payments");
    expect(invoiceItemEditRefusal({ invoice: { status: InvoiceStatus.Void }, paymentCount: 0, dayClosed: true })).toBe("void");
    expect(invoiceItemEditRefusal({ invoice: { status: InvoiceStatus.Unpaid }, paymentCount: 0, dayClosed: true })).toBe("day_closed");
  });
});

describe("totals", () => {
  it("are integer piastres: quantity times unit price, summed", () => {
    expect(lineTotal(3, p(3_333))).toBe(9_999);
    expect(invoiceTotalOf([{ qty: 3, unit_price: p(3_333) }, { qty: 1, unit_price: p(1) }])).toBe(10_000);
    expect(invoiceTotalOf([])).toBe(0);
  });

  it("an unpaid invoice of zero reads paid, as a zero-total invoice is created", () => {
    expect(unpaidInvoiceStatus(p(0))).toBe(InvoiceStatus.Paid);
    expect(unpaidInvoiceStatus(p(1))).toBe(InvoiceStatus.Unpaid);
  });
});

describe("diffInvoiceItems", () => {
  it("splits a draft into lines added, changed and removed; an untouched line is none of them", () => {
    const current = [item("a", 1, 100), item("b", 1, 200), item("c", 2, 300)];
    const changes = diffInvoiceItems(current, [
      { id: "a", service_id: "svc", description: "a", qty: 1, unit_price: p(100) },
      { id: "b", service_id: "svc", description: "b", qty: 2, unit_price: p(200) },
      { id: null, service_id: "svc2", description: "new", qty: 1, unit_price: p(50) },
    ]);
    expect(changes.created.map((line) => line.description)).toEqual(["new"]);
    expect(changes.updated.map(({ before, after }) => [before.id, after.qty])).toEqual([["b", 2]]);
    expect(changes.deleted.map((line) => line.id)).toEqual(["c"]);
  });
});
