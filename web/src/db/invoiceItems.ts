import { id } from "../domain/id";
import {
  diffInvoiceItems,
  draftItemsProblem,
  invoiceItemEditRefusal,
  invoiceTotalOf,
  lineTotal,
  unpaidInvoiceStatus,
  type DraftInvoiceItem,
  type DraftItemsProblem,
  type InvoiceItemEditRefusal,
} from "../domain/invoiceItemEdit";
import { todayInCairo } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction, type Invoice, type InvoiceItem } from "./types";

export type SaveInvoiceItemsResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; reason: "invoice_not_found" | InvoiceItemEditRefusal | DraftItemsProblem };

/** Whether the invoice's Cairo day at its location already has a cash close. */
export async function isInvoiceDayClosed(db: ClintraDatabase, invoice: Pick<Invoice, "location_id" | "issued_at">): Promise<boolean> {
  const close = await db.cash_close
    .where("[location_id+date]")
    .equals([invoice.location_id, todayInCairo(new Date(invoice.issued_at))])
    .first();
  return close !== undefined;
}

/**
 * Saves an edit of an invoice's items: lines added, removed, or with a new
 * quantity or price, and the invoice's total recomputed from the lines, in
 * integer piastres — all in one transaction. Refused, with nothing written,
 * once the invoice has a payment, is void, or its day's cash is closed
 * (domain/invoiceItemEdit.ts), each re-read inside the transaction, as
 * voidInvoice does: a payment recorded a moment earlier is always seen.
 *
 * A removed line is deleted: invoice_items has no retired flag, and its
 * audit row keeps the line as it was. The visit is never touched, so its
 * time and slot stay as they are. An unpaid invoice's status follows its new
 * total (unpaidInvoiceStatus).
 */
export async function saveInvoiceItems(
  db: ClintraDatabase,
  invoiceId: string,
  draft: readonly DraftInvoiceItem[],
): Promise<SaveInvoiceItemsResult> {
  const problem = draftItemsProblem(draft);
  if (problem !== null) {
    return { ok: false, reason: problem };
  }
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.invoices, db.invoice_items, db.payments, db.cash_close], async (write) => {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) {
      return { ok: false, reason: "invoice_not_found" };
    }
    const refusal = invoiceItemEditRefusal({
      invoice,
      paymentCount: await db.payments.where("invoice_id").equals(invoiceId).count(),
      dayClosed: await isInvoiceDayClosed(db, invoice),
    });
    if (refusal !== null) {
      return { ok: false, reason: refusal };
    }

    const current = await db.invoice_items.where("invoice_id").equals(invoiceId).toArray();
    const changes = diffInvoiceItems(current, draft);

    for (const before of changes.deleted) {
      await write({
        table: db.invoice_items,
        entity: "invoice_items",
        entityId: before.id,
        action: AuditAction.Delete,
        before,
        after: null,
        actorMembershipId: actor.id,
        orgId: invoice.org_id,
      });
    }
    for (const { before, after } of changes.updated) {
      const updated: InvoiceItem = {
        ...before,
        qty: after.qty,
        unit_price: after.unit_price,
        total: lineTotal(after.qty, after.unit_price),
      };
      await write({
        table: db.invoice_items,
        entity: "invoice_items",
        entityId: before.id,
        action: AuditAction.Update,
        before,
        after: updated,
        actorMembershipId: actor.id,
        orgId: invoice.org_id,
      });
    }
    for (const line of changes.created) {
      const item: InvoiceItem = {
        id: id(),
        invoice_id: invoiceId,
        service_id: line.service_id,
        description: line.description,
        qty: line.qty,
        unit_price: line.unit_price,
        total: lineTotal(line.qty, line.unit_price),
        rev: 1,
      };
      await write({
        table: db.invoice_items,
        entity: "invoice_items",
        entityId: item.id,
        action: AuditAction.Create,
        before: null,
        after: item,
        actorMembershipId: actor.id,
        orgId: invoice.org_id,
      });
    }

    const total = invoiceTotalOf(draft);
    const status = unpaidInvoiceStatus(total);
    if (total === invoice.total && status === invoice.status) {
      return { ok: true, invoice };
    }
    const after: Invoice = { ...invoice, total, status };
    await write({
      table: db.invoices,
      entity: "invoices",
      entityId: invoiceId,
      action: AuditAction.Update,
      before: invoice,
      after,
      actorMembershipId: actor.id,
      orgId: invoice.org_id,
    });
    return { ok: true, invoice: after };
  });
}
