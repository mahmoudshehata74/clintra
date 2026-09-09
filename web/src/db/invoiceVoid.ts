import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction, InvoiceStatus } from "./types";

export type VoidInvoiceResult =
  | { ok: true; auditLogId: string }
  | { ok: false; reason: "invoice_not_found" | "already_void" | "has_payments" };

/**
 * Voids an invoice — refused once any payment exists against it, per the
 * specification's rule that an invoice can never be voided after a payment.
 * The payment count is checked inside the same transaction as the write, so
 * a payment recorded a moment earlier (already committed) is always seen,
 * and one recorded concurrently is either fully committed before this
 * transaction's read runs or fully after this write commits — IndexedDB
 * serializes overlapping readwrite transactions on the payments store, so
 * there is no window where both could believe they "won".
 */
export async function voidInvoice(db: ClintraDatabase, invoiceId: string): Promise<VoidInvoiceResult> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.invoices, db.payments], async (write) => {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) {
      return { ok: false, reason: "invoice_not_found" };
    }
    if (invoice.status === InvoiceStatus.Void) {
      return { ok: false, reason: "already_void" };
    }

    const paymentCount = await db.payments.where("invoice_id").equals(invoiceId).count();
    if (paymentCount > 0) {
      return { ok: false, reason: "has_payments" };
    }

    const auditLogId = await write({
      table: db.invoices,
      entity: "invoices",
      entityId: invoiceId,
      action: AuditAction.Update,
      before: invoice,
      after: { ...invoice, status: InvoiceStatus.Void },
      actorMembershipId: actor.id,
      orgId: invoice.org_id,
    });

    return { ok: true, auditLogId };
  });
}
