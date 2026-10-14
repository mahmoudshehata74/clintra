import type { AuditLog } from "../../db/types";

/** The audit sheet's four filters, the prototype's `.filts`: الكل، زيارات، فواتير، إعدادات. */
export type AuditFilter = "all" | "visits" | "invoices" | "settings";
export type AuditGroup = Exclude<AuditFilter, "all">;

// Which filter each audited entity is listed under. Visits gathers
// everything about a patient's care — the visit itself, its form and note
// (a visit update), its prescription and drugs, care plans and their
// sessions, the patient record and its messages; invoices the money
// (invoices, payments, the cash close); settings everything the owner
// configures (services and their prices, working hours, staff and their
// scopes, practitioners, message templates). An entity in no group is
// still listed under "الكل".
const ENTITY_GROUP: Partial<Record<string, AuditGroup>> = {
  visits: "visits",
  visit_form_data: "visits",
  prescriptions: "visits",
  prescription_items: "visits",
  care_plans: "visits",
  care_plan_items: "visits",
  patients: "visits",
  messages: "visits",
  invoices: "invoices",
  payments: "invoices",
  cash_close: "invoices",
  services: "settings",
  service_price_overrides: "settings",
  schedules: "settings",
  users: "settings",
  memberships: "settings",
  membership_locations: "settings",
  membership_practitioners: "settings",
  practitioners: "settings",
  message_templates: "settings",
};

/** The filter a row's entity is listed under, or null for one listed under "الكل" only. */
export function auditGroupOf(entity: string): AuditGroup | null {
  return ENTITY_GROUP[entity] ?? null;
}

/** The rows a filter shows: every row for "all", else the rows whose entity is in that group. */
export function filterAuditRows<T extends Pick<AuditLog, "entity">>(rows: readonly T[], filter: AuditFilter): T[] {
  return filter === "all" ? [...rows] : rows.filter((row) => auditGroupOf(row.entity) === filter);
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
