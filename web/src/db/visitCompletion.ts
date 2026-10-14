import { computeMedianConsultMinutes } from "../domain/consultStats";
import { id } from "../domain/id";
import type { Piastres } from "../domain/money";
import { resolveServicePrice } from "../domain/pricing";
import { cairoYear } from "../domain/time";
import { canTransitionVisitStatus } from "../domain/transitions";
import { VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { getMintingSeries, numberMarkKey, reserveNextNumber } from "./deviceRegistration";
import { runAtomicMutations } from "./mutate";
import { AuditAction, InvoiceStatus, type DayState, type Invoice, type InvoiceItem, type Visit } from "./types";

export interface CompleteVisitResult {
  visitAuditLogId: string;
  invoiceAuditLogId: string;
  /** Null only in the no-service_id fallback below, where no item row is written. */
  invoiceItemAuditLogId: string | null;
  invoice: Invoice;
  dayStateAuditLogId: string;
}

/**
 * The one-tap "complete" action: advances the visit to completed, creates
 * its invoice, and recomputes day_state.avg_consult_minutes for this
 * practitioner+location+date — all in one shared transaction, so a visit is
 * never left completed without an invoice or a stale average, and neither
 * is ever written without the visit actually completing. The invoice's
 * price comes from resolveServicePrice (domain/pricing.ts), which already
 * respects service_price_overrides for this practitioner and location —
 * except for a visit that books a care plan session (care_plan_items.visit_id),
 * which is billed at that session's own price instead: a plan is billed per
 * session, at the price it was planned at (docs/schema.md's v20 additions).
 * Nothing else about completion depends on the plan. The
 * average is the median, not the mean, across every completed visit that
 * day (see domain/consultStats.ts and docs/schema.md for why).
 *
 * If the visit has no service_id — not expected with current data, since
 * every booking flow requires a service, but not something this function
 * guards against — the invoice is created with zero total and status
 * "paid", and no invoice_items row is written (there is no service to
 * describe a line item from). This is a deliberate, minimal fallback, not a
 * validation gap: surfaced in the task report for a decision on whether to
 * guard against it.
 *
 * The invoice number is minted inside this device's own number series
 * (docs/schema.md's v16 additions): reserved inside this same transaction by
 * reading the current max for (location_id, issued_year, series) and adding
 * one — never computed outside the transaction and written separately, which
 * is what makes two visits completing at the same instant on this device
 * safe: IndexedDB serializes overlapping readwrite transactions on the
 * invoices store, so the second transaction's read never runs until the
 * first has already committed its own invoice row. Another device at the
 * same location mints in a different series, so it can never take the same
 * number, offline or not. The device's high-water mark for the series
 * (reserveNextNumber) is read and raised in the same transaction, so a
 * number whose invoice was displaced by a pulled row is never minted again.
 *
 * A device that does not know its series yet (device_series_unknown, see
 * getMintingSeries) is refused before the transaction starts: nothing is
 * written, so the visit stays where it was, with no invoice.
 */
export async function completeVisitWithInvoice(
  db: ClintraDatabase,
  visitId: string,
): Promise<CompleteVisitResult> {
  const actor = await resolveActingMembership(db);
  const series = await getMintingSeries(db);

  return runAtomicMutations(
    db,
    [
      db.visits,
      db.invoices,
      db.invoice_items,
      db.services,
      db.service_price_overrides,
      db.care_plan_items,
      db.day_state,
      db.device,
    ],
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
      const session = await db.care_plan_items.where("visit_id").equals(visitId).first();
      let unitPrice: Piastres = 0 as Piastres;
      if (service && session) {
        unitPrice = session.price;
      } else if (service) {
        const overrides = await db.service_price_overrides.toArray();
        unitPrice = resolveServicePrice(service, overrides, {
          practitionerId: before.practitioner_id,
          locationId: before.location_id,
        });
      }

      const issuedYear = cairoYear(now);
      const invoicesAtLocation = await db.invoices.where("location_id").equals(before.location_id).toArray();
      const number = await reserveNextNumber(
        db,
        numberMarkKey("invoice", before.location_id, series, issuedYear),
        invoicesAtLocation
          .filter((invoice) => invoice.issued_year === issuedYear && invoice.series === series)
          .reduce((max, invoice) => Math.max(max, invoice.number), 0),
      );

      const total: Piastres = service ? unitPrice : (0 as Piastres);
      const invoice: Invoice = {
        id: id(),
        org_id: before.org_id,
        location_id: before.location_id,
        number,
        issued_year: issuedYear,
        series,
        patient_id: before.patient_id,
        practitioner_id: before.practitioner_id,
        visit_id: before.id,
        total,
        paid: 0 as Piastres,
        status: service ? InvoiceStatus.Unpaid : InvoiceStatus.Paid,
        issued_at: now,
        rev: 1,
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
          rev: 1,
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

      // The median is recomputed from every completed visit for this
      // practitioner+location+date, including the one just completed above
      // (the write already landed in this same transaction, and reads
      // within a transaction see its own prior writes), rather than updated
      // incrementally — simplest to reason about correctly, and this table
      // is small enough per day that a full recompute costs nothing real.
      const visitsForDay = await db.visits
        .where("[practitioner_id+visit_date]")
        .equals([before.practitioner_id, before.visit_date])
        .toArray();
      const avgConsultMinutes = computeMedianConsultMinutes(
        visitsForDay.filter((visit) => visit.location_id === before.location_id),
      );

      const existingDayState = await db.day_state
        .where("[practitioner_id+location_id+date]")
        .equals([before.practitioner_id, before.location_id, before.visit_date])
        .first();
      const dayStateAfter: DayState = existingDayState
        ? { ...existingDayState, avg_consult_minutes: avgConsultMinutes }
        : {
            id: id(),
            practitioner_id: before.practitioner_id,
            location_id: before.location_id,
            date: before.visit_date,
            delay_minutes: 0,
            is_closed: false,
            avg_consult_minutes: avgConsultMinutes,
            rev: 1,
          };
      const dayStateAuditLogId = await write({
        table: db.day_state,
        entity: "day_state",
        entityId: dayStateAfter.id,
        action: existingDayState ? AuditAction.Update : AuditAction.Create,
        before: existingDayState ?? null,
        after: dayStateAfter,
        actorMembershipId: actor.id,
        orgId: before.org_id,
      });

      return { visitAuditLogId, invoiceAuditLogId, invoiceItemAuditLogId, invoice, dayStateAuditLogId };
    },
  );
}
