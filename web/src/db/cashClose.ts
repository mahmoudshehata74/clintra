import Dexie from "dexie";
import { id } from "../domain/id";
import type { Piastres } from "../domain/money";
import { todayInCairo, type ClinicDay } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction, type CashClose, type Invoice } from "./types";

/**
 * The day's expected cash total per the specification: the sum of `paid`
 * across every invoice at this location issued on this Africa/Cairo day —
 * not the sum of payments received today, which can differ when a payment
 * against an earlier-issued invoice lands today. Shared by the write path
 * below (the authoritative figure a close is computed from) and the sheet
 * that shows it live before an assistant confirms, so both are always the
 * same number.
 */
export function computeExpectedCashTotal(
  invoices: readonly Invoice[],
  locationId: string,
  date: ClinicDay,
): Piastres {
  return invoices
    .filter((invoice) => invoice.location_id === locationId && todayInCairo(new Date(invoice.issued_at)) === date)
    .reduce((sum, invoice) => (sum + invoice.paid) as Piastres, 0 as Piastres);
}

export interface CloseCashInput {
  locationId: string;
  /** cash_close has no org_id of its own (same reasoning as day_state — see mutate.ts); needed only to stamp this write's audit_log row. */
  orgId: string;
  date: ClinicDay;
  totalCollected: Piastres;
  /** Required by the caller (see cashCloseForm.ts) when totalCollected differs from the expected total. */
  differenceNote: string | null;
}

export type CloseCashResult =
  | { ok: true; auditLogId: string; cashClose: CashClose }
  | { ok: false; reason: "already_closed" };

/**
 * Closes the cash drawer for one location and day. Refuses a second close
 * for the same location+date — enforced by the database itself via
 * cash_close's &[location_id+date] unique index (see docs/schema.md's v7
 * additions), not just checked here first: this catches the write-time
 * ConstraintError rather than trusting a read-then-write race window. Total
 * expected is recomputed here from the invoices table directly rather than
 * trusting a number the caller's UI last rendered, same reasoning as every
 * other re-read-inside-the-transaction write in this codebase.
 */
export async function closeCashForDay(db: ClintraDatabase, input: CloseCashInput): Promise<CloseCashResult> {
  const actor = await resolveActingMembership(db);

  try {
    return await runAtomicMutations(db, [db.invoices, db.cash_close], async (write) => {
      const invoicesAtLocation = await db.invoices.where("location_id").equals(input.locationId).toArray();
      const totalExpected = computeExpectedCashTotal(invoicesAtLocation, input.locationId, input.date);
      const difference = (input.totalCollected - totalExpected) as Piastres;

      const cashClose: CashClose = {
        id: id(),
        location_id: input.locationId,
        date: input.date,
        total_expected: totalExpected,
        total_collected: input.totalCollected,
        difference,
        difference_note: input.differenceNote,
        closed_by: actor.id,
        closed_at: new Date().toISOString(),
      };

      const auditLogId = await write({
        table: db.cash_close,
        entity: "cash_close",
        entityId: cashClose.id,
        action: AuditAction.Create,
        before: null,
        after: cashClose,
        actorMembershipId: actor.id,
        orgId: input.orgId,
      });

      return { ok: true, auditLogId, cashClose };
    });
  } catch (error) {
    if (error instanceof Dexie.ConstraintError) {
      return { ok: false, reason: "already_closed" };
    }
    throw error;
  }
}
