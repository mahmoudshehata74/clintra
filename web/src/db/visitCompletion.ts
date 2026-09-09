import { id } from "../domain/id";
import type { Piastres } from "../domain/money";
import { resolveServicePrice } from "../domain/pricing";
import { cairoYear } from "../domain/time";
import { canTransitionVisitStatus } from "../domain/transitions";
import { VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction, InvoiceStatus, type Invoice, type InvoiceItem, type Visit } from "./types";

export interface CompleteVisitResult {
  visitAuditLogId: string;
  invoiceAuditLogId: string;
  /** Null only in the no-service_id fallback below, where no item row is written. */
  invoiceItemAuditLogId: string | null;
  invoice: Invoice;
}

/**
 * The one-tap "complete" action: advances the visit to completed AND creates
 * its invoice, atomically — one shared transaction, so a visit is never left
 * completed without an invoice, or an invoice ever created without its visit
 * actually completing. The invoice's price comes from
 * resolveServicePrice (domain/pricing.ts), which already respects
 * service_price_overrides for this practitioner and location.
 *
 * If the visit has no service_id — not expected with current data, since
 * every booking flow requires a service, but not something this function
 * guards against — the invoice is created with zero total and status
 * "paid", and no invoice_items row is written (there is no service to
 * describe a line item from). This is a deliberate, minimal fallback, not a
 * validation gap: surfaced in the task report for a decision on whether to
 * guard against it.
 *
 * The invoice number is reserved inside this same transaction by reading the
 * current max for (location_id, issued_year) and adding one — never
 * computed outside the transaction and written separately, which is what
 * makes two visits completing at the same instant at the same location safe:
 * IndexedDB serializes overlapping readwrite transactions on the invoices
 * store, so the second transaction's read never runs until the first has
 * already committed its own invoice row.
 */
export async function completeVisitWithInvoice(
  db: ClintraDatabase,
  visitId: string,
): Promise<CompleteVisitResult> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(
    db,
    [db.visits, db.invoices, db.invoice_items, db.services, db.service_price_overrides],
    async (write) => {
      const before = await db.visits.get(visitId);
      if (!before) {
        throw new Error("visit_not_found");
      }
      if (!canTransitionVisitStatus(before.status, VisitStatus.Completed)) {
        throw new Error(`invalid_transition:${before.status}->${VisitStatus.Completed}`);
      }

      const now = new Date().toISOString();
      const after: Visit = { ...before, status: VisitStatus.Completed, ended_at: now };
      const visitAuditLogId = await write({
        table: db.visits,
        entity: "visits",
        entityId: visitId,
        action: AuditAction.Update,
        before,
        after,
        actorMembershipId: actor.id,
        orgId: before.org_id,
      });

      const service = before.service_id ? await db.services.get(before.service_id) : undefined;
      let unitPrice: Piastres = 0 as Piastres;
      if (service) {
        const overrides = await db.service_price_overrides.toArray();
        unitPrice = resolveServicePrice(service, overrides, {
          practitionerId: before.practitioner_id,
          locationId: before.location_id,
        });
      }

      const issuedYear = cairoYear(now);
      const invoicesAtLocation = await db.invoices.where("location_id").equals(before.location_id).toArray();
      const number =
        invoicesAtLocation
          .filter((invoice) => invoice.issued_year === issuedYear)
          .reduce((max, invoice) => Math.max(max, invoice.number), 0) + 1;

      const total: Piastres = service ? unitPrice : (0 as Piastres);
      const invoice: Invoice = {
        id: id(),
        org_id: before.org_id,
        location_id: before.location_id,
        number,
        issued_year: issuedYear,
        patient_id: before.patient_id,
        practitioner_id: before.practitioner_id,
        visit_id: before.id,
        total,
        paid: 0 as Piastres,
        status: service ? InvoiceStatus.Unpaid : InvoiceStatus.Paid,
        issued_at: now,
      };

      const invoiceAuditLogId = await write({
        table: db.invoices,
        entity: "invoices",
        entityId: invoice.id,
        action: AuditAction.Create,
        before: null,
        after: invoice,
        actorMembershipId: actor.id,
        orgId: before.org_id,
      });

      let invoiceItemAuditLogId: string | null = null;
      if (service) {
        const item: InvoiceItem = {
          id: id(),
          invoice_id: invoice.id,
          service_id: service.id,
          description: service.name,
          qty: 1,
          unit_price: unitPrice,
          total: unitPrice,
        };
        invoiceItemAuditLogId = await write({
          table: db.invoice_items,
          entity: "invoice_items",
          entityId: item.id,
          action: AuditAction.Create,
          before: null,
          after: item,
          actorMembershipId: actor.id,
          orgId: before.org_id,
        });
      }

      return { visitAuditLogId, invoiceAuditLogId, invoiceItemAuditLogId, invoice };
    },
  );
}
