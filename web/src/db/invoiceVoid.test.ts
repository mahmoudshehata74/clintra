import { beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "./database";
import { InvoiceStatus, PaymentMethod } from "./types";
import { markVisitInRoom } from "./visitAttendance";
import { seedDatabase } from "./seed";
import { completeVisitWithInvoice } from "./visitCompletion";
import { recordPayment } from "./payments";
import { voidInvoice } from "./invoiceVoid";

let db: ClintraDatabase;

function findByPosition<T extends { position: number }>(visits: readonly T[], position: number): T {
  const visit = visits.find((v) => v.position === position);
  if (!visit) throw new Error(`seed did not produce a visit at position ${position}`);
  return visit;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-invoice-void-test-${crypto.randomUUID()}`);
});

async function seedUnpaidInvoice() {
  await seedDatabase(db);
  const arrivedVisit = findByPosition(await db.visits.toArray(), 2);
  await markVisitInRoom(db, arrivedVisit.id);
  const { invoice } = await completeVisitWithInvoice(db, arrivedVisit.id);
  return invoice;
}

describe("voidInvoice", () => {
  it("voids an invoice with no payments", async () => {
    const invoice = await seedUnpaidInvoice();

    const result = await voidInvoice(db, invoice.id);

    expect(result).toEqual({ ok: true, auditLogId: expect.any(String) });
    const updated = await db.invoices.get(invoice.id);
    expect(updated?.status).toBe(InvoiceStatus.Void);
  });

  it("is refused once any payment exists against the invoice, writing nothing", async () => {
    const invoice = await seedUnpaidInvoice();
    await recordPayment(db, { invoiceId: invoice.id, amount: 100 as typeof invoice.total, method: PaymentMethod.Cash, note: null });

    const result = await voidInvoice(db, invoice.id);

    expect(result).toEqual({ ok: false, reason: "has_payments" });
    const unchanged = await db.invoices.get(invoice.id);
    expect(unchanged?.status).toBe(InvoiceStatus.Partial);
  });

  it("refuses to void an already-void invoice", async () => {
    const invoice = await seedUnpaidInvoice();
    const first = await voidInvoice(db, invoice.id);
    expect(first.ok).toBe(true);

    const second = await voidInvoice(db, invoice.id);
    expect(second).toEqual({ ok: false, reason: "already_void" });
  });

  it("reports invoice_not_found for an unknown id", async () => {
    await seedDatabase(db);
    const result = await voidInvoice(db, "does-not-exist");
    expect(result).toEqual({ ok: false, reason: "invoice_not_found" });
  });
});
