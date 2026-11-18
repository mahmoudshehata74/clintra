import { beforeEach, describe, expect, it } from "vitest";
import type { DraftInvoiceItem } from "../domain/invoiceItemEdit";
import type { Piastres } from "../domain/money";
import { closeCashForDay } from "./cashClose";
import { ClintraDatabase } from "./database";
import { saveInvoiceItems } from "./invoiceItems";
import { voidInvoice } from "./invoiceVoid";
import { recordPayment } from "./payments";
import { seedDatabase } from "./seed";
import { todayInCairo } from "../domain/time";
import { AuditAction, InvoiceStatus, PaymentMethod } from "./types";
import { markVisitInRoom } from "./visitAttendance";
import { completeVisitWithInvoice } from "./visitCompletion";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-invoice-items-test-${crypto.randomUUID()}`);
});

async function seedUnpaidInvoice() {
  await seedDatabase(db);
  const visit = (await db.visits.toArray()).find((candidate) => candidate.position === 2);
  if (!visit) throw new Error("seed did not produce a visit at position 2");
  await markVisitInRoom(db, visit.id);
  const { invoice } = await completeVisitWithInvoice(db, visit.id);
  const [item] = await db.invoice_items.where("invoice_id").equals(invoice.id).toArray();
  const visitAfterCompletion = await db.visits.get(visit.id);
  const otherService = (await db.services.toArray()).find((service) => service.id !== item.service_id);
  if (!otherService) throw new Error("seed has a single service");
  return { invoice, item, visit: visitAfterCompletion!, otherService };
}

const p = (value: number) => value as Piastres;

describe("saveInvoiceItems", () => {
  it("changes a quantity and a price, adds a line, and recomputes the total in piastres", async () => {
    const { invoice, item, otherService } = await seedUnpaidInvoice();
    const draft: DraftInvoiceItem[] = [
      { id: item.id, service_id: item.service_id, description: item.description, qty: 2, unit_price: p(12_550) },
      { id: null, service_id: otherService.id, description: otherService.name, qty: 1, unit_price: p(7_005) },
    ];

    const result = await saveInvoiceItems(db, invoice.id, draft);

    expect(result.ok).toBe(true);
    const items = await db.invoice_items.where("invoice_id").equals(invoice.id).toArray();
    expect(items.map((line) => [line.qty, line.unit_price, line.total]).sort()).toEqual([
      [1, 7_005, 7_005],
      [2, 12_550, 25_100],
    ]);
    const saved = await db.invoices.get(invoice.id);
    expect(saved?.total).toBe(32_105);
    expect(saved?.status).toBe(InvoiceStatus.Unpaid);
  });

  it("deletes a removed line, its audit row keeping the line as it was", async () => {
    const { invoice, item, otherService } = await seedUnpaidInvoice();
    const draft: DraftInvoiceItem[] = [{ id: null, service_id: otherService.id, description: otherService.name, qty: 1, unit_price: p(5_000) }];

    await saveInvoiceItems(db, invoice.id, draft);

    expect(await db.invoice_items.get(item.id)).toBeUndefined();
    const audit = (await db.audit_log.toArray()).filter((row) => row.entity_id === item.id);
    const deletion = audit.find((row) => row.action === AuditAction.Delete);
    expect(deletion?.before).toMatchObject({ id: item.id, qty: item.qty, unit_price: item.unit_price });
    expect((await db.invoices.get(invoice.id))?.total).toBe(5_000);
  });

  it("never touches the visit's time or slot", async () => {
    const { invoice, item, visit } = await seedUnpaidInvoice();

    await saveInvoiceItems(db, invoice.id, [{ id: item.id, service_id: item.service_id, description: item.description, qty: 3, unit_price: item.unit_price }]);

    expect(await db.visits.get(visit.id)).toEqual(visit);
  });

  it("writes nothing when the items are unchanged", async () => {
    const { invoice, item } = await seedUnpaidInvoice();
    const opsBefore = await db.sync_ops.count();

    const result = await saveInvoiceItems(db, invoice.id, [{ ...item, id: item.id }]);

    expect(result).toEqual({ ok: true, invoice });
    expect(await db.sync_ops.count()).toBe(opsBefore);
  });

  it("is refused once a payment exists, writing nothing", async () => {
    const { invoice, item } = await seedUnpaidInvoice();
    await recordPayment(db, { invoiceId: invoice.id, amount: p(100), method: PaymentMethod.Cash, note: null });
    const opsBefore = await db.sync_ops.count();

    const result = await saveInvoiceItems(db, invoice.id, [{ ...item, qty: 4 }]);

    expect(result).toEqual({ ok: false, reason: "has_payments" });
    expect((await db.invoice_items.get(item.id))?.qty).toBe(1);
    expect(await db.sync_ops.count()).toBe(opsBefore);
  });

  it("is refused for a void invoice and once the day's cash is closed", async () => {
    const voided = await seedUnpaidInvoice();
    await voidInvoice(db, voided.invoice.id);
    expect(await saveInvoiceItems(db, voided.invoice.id, [{ ...voided.item, qty: 2 }])).toEqual({ ok: false, reason: "void" });

    db = new ClintraDatabase(`clintra-invoice-items-test-${crypto.randomUUID()}`);
    const closed = await seedUnpaidInvoice();
    await closeCashForDay(db, {
      locationId: closed.invoice.location_id,
      orgId: closed.invoice.org_id,
      date: todayInCairo(new Date(closed.invoice.issued_at)),
      totalCollected: p(0),
      differenceNote: null,
    });
    expect(await saveInvoiceItems(db, closed.invoice.id, [{ ...closed.item, qty: 2 }])).toEqual({ ok: false, reason: "day_closed" });
  });

  it("refuses a draft with no line, a zero quantity or a fractional price", async () => {
    const { invoice, item } = await seedUnpaidInvoice();
    expect(await saveInvoiceItems(db, invoice.id, [])).toEqual({ ok: false, reason: "no_items" });
    expect(await saveInvoiceItems(db, invoice.id, [{ ...item, qty: 0 }])).toEqual({ ok: false, reason: "qty_invalid" });
    expect(await saveInvoiceItems(db, invoice.id, [{ ...item, unit_price: p(10.5) }])).toEqual({ ok: false, reason: "price_invalid" });
  });
});
