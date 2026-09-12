import { id } from "../domain/id";
import type { Piastres } from "../domain/money";
import { todayInCairo } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction, InvoiceStatus, type Invoice, type Payment, type PaymentMethod } from "./types";

export interface RecordPaymentInput {
  invoiceId: string;
  amount: Piastres;
  method: PaymentMethod;
  /** Trimmed, or null when left blank. */
  note: string | null;
}

export type RecordPaymentResult =
  | { ok: true; paymentAuditLogId: string; invoiceAuditLogId: string; payment: Payment }
  | {
      ok: false;
      reason: "invoice_not_found" | "invoice_voided" | "invoice_already_paid" | "amount_not_positive" | "amount_exceeds_remaining";
    };

/**
 * Records a payment against an invoice: inserts the payment row and updates
 * the invoice's paid/status together, in one transaction — a payment
 * recorded without the invoice reflecting it, or an invoice total updated
 * without a payment row to back it, would both be defects. The remaining
 * amount is re-read from the invoice's current state inside this same
 * transaction rather than trusting whatever the caller's form last rendered,
 * for the same reason bookExistingPatientVisit re-reads slot occupancy: a
 * stale snapshot could let two payments together overpay an invoice.
 *
 * receipt_number is reserved the same way invoice numbers are (see
 * db/visitCompletion.ts): read the current max for this location inside the
 * transaction and add one, so IndexedDB's serialization of overlapping
 * readwrite transactions on the payments store rules out a race.
 */
export async function recordPayment(db: ClintraDatabase, input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.invoices, db.payments, db.cash_close], async (write) => {
    const invoice = await db.invoices.get(input.invoiceId);
    if (!invoice) {
      return { ok: false, reason: "invoice_not_found" };
    }
    if (invoice.status === InvoiceStatus.Void) {
      return { ok: false, reason: "invoice_voided" };
    }

    const remaining = (invoice.total - invoice.paid) as Piastres;
    if (remaining <= 0) {
      return { ok: false, reason: "invoice_already_paid" };
    }
    if (input.amount <= 0) {
      return { ok: false, reason: "amount_not_positive" };
    }
    if (input.amount > remaining) {
      return { ok: false, reason: "amount_exceeds_remaining" };
    }

    const now = new Date().toISOString();
    const today = todayInCairo(new Date(now));
    const closedForToday = await db.cash_close
      .where("[location_id+date]")
      .equals([invoice.location_id, today])
      .first();

    const paymentsAtLocation = await db.payments.where("location_id").equals(invoice.location_id).toArray();
    const nextReceiptNumber =
      paymentsAtLocation.reduce((max, payment) => Math.max(max, Number(payment.receipt_number)), 0) + 1;

    const payment: Payment = {
      id: id(),
      invoice_id: invoice.id,
      location_id: invoice.location_id,
      amount: input.amount,
      method: input.method,
      receipt_number: String(nextReceiptNumber),
      note: input.note,
      after_close: Boolean(closedForToday),
      created_by: actor.id,
      created_at: now,
      rev: 1,
    };

    const paymentAuditLogId = await write({
      table: db.payments,
      entity: "payments",
      entityId: payment.id,
      action: AuditAction.Create,
      before: null,
      after: payment,
      actorMembershipId: actor.id,
      orgId: invoice.org_id,
    });

    const newPaid = (invoice.paid + input.amount) as Piastres;
    const updatedInvoice: Invoice = {
      ...invoice,
      paid: newPaid,
      status: newPaid >= invoice.total ? InvoiceStatus.Paid : InvoiceStatus.Partial,
    };

    const invoiceAuditLogId = await write({
      table: db.invoices,
      entity: "invoices",
      entityId: invoice.id,
      action: AuditAction.Update,
      before: invoice,
      after: updatedInvoice,
      actorMembershipId: actor.id,
      orgId: invoice.org_id,
    });

    return { ok: true, paymentAuditLogId, invoiceAuditLogId, payment };
  });
}
