import { AuditAction, type AuditLog } from "../../db/types";

export type AuditEntityFilter = "all" | "visits" | "patients" | "invoices" | "payments" | "cash_close";
export type AuditActionFilter = "all" | AuditAction;

/** Applies the audit sheet's two independent filters: entity type and action. Either left at "all" matches every row. */
export function filterAuditRows<T extends Pick<AuditLog, "entity" | "action">>(
  rows: readonly T[],
  entityFilter: AuditEntityFilter,
  actionFilter: AuditActionFilter,
): T[] {
  return rows.filter((row) => {
    if (entityFilter !== "all" && row.entity !== entityFilter) {
      return false;
    }
    if (actionFilter !== "all" && row.action !== actionFilter) {
      return false;
    }
    return true;
  });
}

/**
 * Whether an audit_log row belongs to the current practitioner+location.
 * AuditLog itself carries neither field — only some entity payloads do (a
 * visit or invoice has both, a payment or cash_close has only location_id, a
 * patient has neither) — so a row is excluded only when a field IS present
 * on its payload AND mismatches the current scope. A field's mere absence
 * never excludes the row: there is nothing to compare it against, so it is
 * treated as org-wide rather than silently dropped.
 */
export function isAuditRowInScope(
  row: Pick<AuditLog, "before" | "after">,
  practitionerId: string,
  locationId: string,
): boolean {
  const payload = (row.after ?? row.before) as Record<string, unknown> | null;
  if (!payload) {
    return true;
  }
  const rowLocationId = payload.location_id;
  if (typeof rowLocationId === "string" && rowLocationId !== locationId) {
    return false;
  }
  const rowPractitionerId = payload.practitioner_id;
  if (typeof rowPractitionerId === "string" && rowPractitionerId !== practitionerId) {
    return false;
  }
  return true;
}
