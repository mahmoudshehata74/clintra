import { beforeEach, describe, expect, it } from "vitest";
import { todayInCairo } from "../domain/time";
import { ClintraDatabase } from "./database";
import { InvoiceStatus, PaymentMethod } from "./types";
import { markVisitArrived, markVisitInRoom } from "./visitAttendance";
import { seedDatabase } from "./seed";
import { completeVisitWithInvoice } from "./visitCompletion";
import { recordPayment } from "./payments";

let db: ClintraDatabase;

function findByPosition<T extends { position: number }>(visits: readonly T[], position: number): T {
  const visit = visits.find((v) => v.position === position);
  if (!visit) throw new Error(`seed did not produce a visit at position ${position}`);
  return visit;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-payments-test-${crypto.randomUUID()}`);
});

async function seedUnpaidInvoice() {
  await seedDatabase(db);
  const arrivedVisit = findByPosition(await db.visits.toArray(), 2);
  await markVisitInRoom(db, arrivedVisit.id);
  const { invoice } = await completeVisitWithInvoice(db, arrivedVisit.id);
  return invoice;
}

describe("recordPayment", () => {
  it("a payment that exactly clears the remaining sets status to paid", async () => {
    const invoice = await seedUnpaidInvoice();

    const result = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: invoice.total,
      method: PaymentMethod.Cash,
      note: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const updatedInvoice = await db.invoices.get(invoice.id);
    expect(updatedInvoice?.paid).toBe(invoice.total);
    expect(updatedInvoice?.status).toBe(InvoiceStatus.Paid);
    expect(result.payment.amount).toBe(invoice.total);
    expect(result.payment.receipt_number).toBe("1");
  });

  it("a partial payment sets status to partial and leaves a remaining balance", async () => {
    const invoice = await seedUnpaidInvoice();
    const half = Math.floor(invoice.total / 2);

    const result = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: half as typeof invoice.total,
      method: PaymentMethod.Card,
      note: null,
    });

    expect(result.ok).toBe(true);
    const updatedInvoice = await db.invoices.get(invoice.id);
    expect(updatedInvoice?.status).toBe(InvoiceStatus.Partial);
    expect(updatedInvoice?.paid).toBe(half);
  });

  it("rejects an amount greater than the remaining balance, writing nothing", async () => {
    const invoice = await seedUnpaidInvoice();

    const result = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: (invoice.total + 1) as typeof invoice.total,
      method: PaymentMethod.Cash,
      note: null,
    });

    expect(result).toEqual({ ok: false, reason: "amount_exceeds_remaining" });
    expect(await db.payments.count()).toBe(0);
    const unchangedInvoice = await db.invoices.get(invoice.id);
    expect(unchangedInvoice?.paid).toBe(0);
  });

  it("rejects a zero or negative amount", async () => {
    const invoice = await seedUnpaidInvoice();
    const result = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: 0 as typeof invoice.total,
      method: PaymentMethod.Cash,
      note: null,
    });
    expect(result).toEqual({ ok: false, reason: "amount_not_positive" });
  });

  it("rejects a payment against an already fully paid invoice", async () => {
    const invoice = await seedUnpaidInvoice();
    const first = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: invoice.total,
      method: PaymentMethod.Cash,
      note: null,
    });
    expect(first.ok).toBe(true);

    const second = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: 1 as typeof invoice.total,
      method: PaymentMethod.Cash,
      note: null,
    });
    expect(second).toEqual({ ok: false, reason: "invoice_already_paid" });
  });

  it("receipt numbers are sequential per location, monotonic, and never reused", async () => {
    const invoice = await seedUnpaidInvoice();
    const partAmount = 100;

    const first = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: partAmount as typeof invoice.total,
      method: PaymentMethod.Cash,
      note: null,
    });
    const second = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: partAmount as typeof invoice.total,
      method: PaymentMethod.Cash,
      note: null,
    });

    expect(first.ok && first.payment.receipt_number).toBe("1");
    expect(second.ok && second.payment.receipt_number).toBe("2");
  });

  it("assigns receipt numbers correctly under two concurrent payments against different invoices at the same location", async () => {
    await seedDatabase(db);
    const arrivedVisit = findByPosition(await db.visits.toArray(), 2);
    await markVisitInRoom(db, arrivedVisit.id);
    const { invoice: invoiceA } = await completeVisitWithInvoice(db, arrivedVisit.id);

    // A second completed visit, same location, for a second invoice.
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);
    await markVisitArrived(db, bookedVisit.id);
    await markVisitInRoom(db, bookedVisit.id);
    const { invoice: invoiceB } = await completeVisitWithInvoice(db, bookedVisit.id);

    const [resultA, resultB] = await Promise.all([
      recordPayment(db, { invoiceId: invoiceA.id, amount: 100 as typeof invoiceA.total, method: PaymentMethod.Cash, note: null }),
      recordPayment(db, { invoiceId: invoiceB.id, amount: 100 as typeof invoiceB.total, method: PaymentMethod.Cash, note: null }),
    ]);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    const receiptNumbers = [
      resultA.ok ? resultA.payment.receipt_number : null,
      resultB.ok ? resultB.payment.receipt_number : null,
    ].sort();
    expect(receiptNumbers).toEqual(["1", "2"]);
  });

  it("flags a payment recorded after the location's cash close for that day with after_close", async () => {
    const invoice = await seedUnpaidInvoice();

    // recordPayment checks for a close on today's Cairo day at write time,
    // regardless of the invoice's own issued_at — matched here directly
    // rather than depending on the wall clock some other way.
    const today = todayInCairo();
    await db.cash_close.add({
      id: "close-1",
      location_id: invoice.location_id,
      date: today,
      total_expected: 0 as typeof invoice.total,
      total_collected: 0 as typeof invoice.total,
      difference: 0 as typeof invoice.total,
      difference_note: null,
      closed_by: "membership-1",
      closed_at: new Date().toISOString(),
      rev: 1,
    });

    const result = await recordPayment(db, {
      invoiceId: invoice.id,
      amount: invoice.total,
      method: PaymentMethod.Cash,
      note: null,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.payment.after_close).toBe(true);
  });
});
