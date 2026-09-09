import { beforeEach, describe, expect, it } from "vitest";
import type { Piastres } from "../domain/money";
import { todayInCairo } from "../domain/time";
import { ClintraDatabase } from "./database";
import { PaymentMethod } from "./types";
import { markVisitInRoom } from "./visitAttendance";
import { seedDatabase } from "./seed";
import { completeVisitWithInvoice } from "./visitCompletion";
import { recordPayment } from "./payments";
import { closeCashForDay, computeExpectedCashTotal } from "./cashClose";

let db: ClintraDatabase;

function findByPosition<T extends { position: number }>(visits: readonly T[], position: number): T {
  const visit = visits.find((v) => v.position === position);
  if (!visit) throw new Error(`seed did not produce a visit at position ${position}`);
  return visit;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-cash-close-test-${crypto.randomUUID()}`);
});

describe("computeExpectedCashTotal", () => {
  it("sums paid across invoices at the location issued on the given day, ignoring other locations and other days", () => {
    const base = {
      id: "x",
      org_id: "org-1",
      number: 1,
      issued_year: 2026,
      patient_id: "p",
      practitioner_id: "pr",
      visit_id: null,
      status: "unpaid" as const,
    };
    const invoices = [
      { ...base, id: "1", location_id: "loc-a", paid: 100 as Piastres, total: 100 as Piastres, issued_at: "2026-09-07T08:00:00.000Z" },
      { ...base, id: "2", location_id: "loc-a", paid: 200 as Piastres, total: 200 as Piastres, issued_at: "2026-09-07T09:00:00.000Z" },
      // Different location: excluded.
      { ...base, id: "3", location_id: "loc-b", paid: 500 as Piastres, total: 500 as Piastres, issued_at: "2026-09-07T09:00:00.000Z" },
      // Different day: excluded.
      { ...base, id: "4", location_id: "loc-a", paid: 300 as Piastres, total: 300 as Piastres, issued_at: "2026-09-06T09:00:00.000Z" },
    ];

    expect(computeExpectedCashTotal(invoices, "loc-a", "2026-09-07")).toBe(300);
  });
});

describe("closeCashForDay", () => {
  async function seedPaidInvoice() {
    await seedDatabase(db);
    const arrivedVisit = findByPosition(await db.visits.toArray(), 2);
    await markVisitInRoom(db, arrivedVisit.id);
    const { invoice } = await completeVisitWithInvoice(db, arrivedVisit.id);
    await recordPayment(db, { invoiceId: invoice.id, amount: invoice.total, method: PaymentMethod.Cash, note: null });
    return invoice;
  }

  it("records a close matching the actual expected total and the given collected amount", async () => {
    const invoice = await seedPaidInvoice();
    const today = todayInCairo(new Date(invoice.issued_at));

    const result = await closeCashForDay(db, {
      locationId: invoice.location_id,
      orgId: invoice.org_id,
      date: today,
      totalCollected: invoice.total,
      differenceNote: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.cashClose.total_expected).toBe(invoice.total);
    expect(result.cashClose.total_collected).toBe(invoice.total);
    expect(result.cashClose.difference).toBe(0);
  });

  it("records a non-zero difference along with its note", async () => {
    const invoice = await seedPaidInvoice();
    const today = todayInCairo(new Date(invoice.issued_at));
    const shortfall = (invoice.total - 50) as Piastres;

    const result = await closeCashForDay(db, {
      locationId: invoice.location_id,
      orgId: invoice.org_id,
      date: today,
      totalCollected: shortfall,
      differenceNote: "50 قرش ناقصة في الدرج",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.cashClose.difference).toBe(-50);
    expect(result.cashClose.difference_note).toBe("50 قرش ناقصة في الدرج");
  });

  it("rejects a second close for the same location and date", async () => {
    const invoice = await seedPaidInvoice();
    const today = todayInCairo(new Date(invoice.issued_at));

    const first = await closeCashForDay(db, {
      locationId: invoice.location_id,
      orgId: invoice.org_id,
      date: today,
      totalCollected: invoice.total,
      differenceNote: null,
    });
    expect(first.ok).toBe(true);

    const second = await closeCashForDay(db, {
      locationId: invoice.location_id,
      orgId: invoice.org_id,
      date: today,
      totalCollected: invoice.total,
      differenceNote: null,
    });
    expect(second).toEqual({ ok: false, reason: "already_closed" });
    expect(await db.cash_close.count()).toBe(1);
  });

  it("allows a close for the same location on a different date", async () => {
    const invoice = await seedPaidInvoice();
    const today = todayInCairo(new Date(invoice.issued_at));

    const first = await closeCashForDay(db, {
      locationId: invoice.location_id,
      orgId: invoice.org_id,
      date: today,
      totalCollected: invoice.total,
      differenceNote: null,
    });
    expect(first.ok).toBe(true);

    const second = await closeCashForDay(db, {
      locationId: invoice.location_id,
      orgId: invoice.org_id,
      date: "2099-01-01",
      totalCollected: 0 as Piastres,
      differenceNote: null,
    });
    expect(second.ok).toBe(true);
  });
});
