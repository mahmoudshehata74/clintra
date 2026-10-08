import { AuditAction, InvoiceStatus, type AuditLog } from "../../db/types";
import { VisitStatus } from "../../domain/visitStatus";

/** `.aud-dot` (default green), `.aud-dot.warn`, `.aud-dot.danger`. */
export type AuditDotTone = "default" | "warn" | "danger";

type AuditDotRow = Pick<AuditLog, "entity" | "action" | "before" | "after">;

function fieldOf(value: unknown, field: string): unknown {
  return value && typeof value === "object" && field in value ? (value as Record<string, unknown>)[field] : undefined;
}

/** True when this row is the write that moved `field` to `target` (not one that merely kept it there). */
function movedTo(row: AuditDotRow, field: string, target: unknown): boolean {
  return fieldOf(row.after, field) === target && fieldOf(row.before, field) !== target;
}

/**
 * Which dot an audit row wears (prototype #s11): danger for any delete and
 * for a cancellation (a visit cancelled, an invoice voided); warn for a
 * no-show and for anything the data already flags as out of the ordinary —
 * today that is a payment recorded after its day was closed
 * (payments.after_close); every other row is the default green. Read from
 * the row's own before/after only — the same diff domain/auditVerb.ts reads
 * the verb from, so a dot never disagrees with its verb.
 */
export function auditDotTone(row: AuditDotRow): AuditDotTone {
  if (row.action === AuditAction.Delete) {
    return "danger";
  }
  if (row.entity === "visits" && movedTo(row, "status", VisitStatus.Cancelled)) {
    return "danger";
  }
  if (row.entity === "invoices" && movedTo(row, "status", InvoiceStatus.Void)) {
    return "danger";
  }
  if (row.entity === "visits" && movedTo(row, "status", VisitStatus.NoShow)) {
    return "warn";
  }
  if (row.entity === "payments" && fieldOf(row.after ?? row.before, "after_close") === true) {
    return "warn";
  }
  return "default";
}
