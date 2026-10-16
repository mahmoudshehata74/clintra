import type { AuditEntry } from "../db/types";

/** Where an audit row belongs: a location and a practitioner, each null for organization-wide. */
export interface AuditScopeTags {
  location_id: string | null;
  practitioner_id: string | null;
}

/** The fields of a parent row (a visit, prescription, care plan or invoice) a child's scope comes from. */
export interface AuditScopeParent {
  location_id?: string | null;
  practitioner_id?: string | null;
}

type ScopedRow = Pick<AuditEntry, "entity" | "entity_id" | "before" | "after">;

/**
 * The entities whose record names neither field and whose scope is one join
 * away, through the parent this field of the record names.
 */
export const AUDIT_SCOPE_PARENT_FIELD: Partial<Record<string, "visit_id" | "prescription_id" | "care_plan_id" | "invoice_id">> = {
  visit_form_data: "visit_id",
  prescription_items: "prescription_id",
  care_plan_items: "care_plan_id",
  invoice_items: "invoice_id",
};

function recordOf(row: Pick<AuditEntry, "before" | "after">): Record<string, unknown> | null {
  return (row.after ?? row.before) as Record<string, unknown> | null;
}

function idOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The id of the parent a row's scope comes from, or null for an entity scoped by its own record. */
export function auditScopeParentId(row: ScopedRow): string | null {
  const field = AUDIT_SCOPE_PARENT_FIELD[row.entity];
  return field ? idOrNull(recordOf(row)?.[field]) : null;
}

/**
 * A row's scope tags, as the audit sheet scopes it and as the device pushes
 * them (docs/audit-sync.md's scope table; the server checks the same rule,
 * api/app/Support/Sync/DeviceAuditPusher.php):
 * - a practitioner's own row: that practitioner, at any location;
 * - a visit form, prescription drug, care plan session or invoice item: its
 *   parent's (`parent`), or null when the parent is not on this device;
 * - any other row: its record's own `location_id` / `practitioner_id`,
 *   each null when the record has none (organization-wide).
 */
export function auditScopeTags(row: ScopedRow, parent: AuditScopeParent | undefined): AuditScopeTags | null {
  if (row.entity === "practitioners") {
    return { location_id: null, practitioner_id: row.entity_id };
  }
  if (AUDIT_SCOPE_PARENT_FIELD[row.entity]) {
    return parent ? { location_id: idOrNull(parent.location_id), practitioner_id: idOrNull(parent.practitioner_id) } : null;
  }
  return recordScopeTags(row);
}

/** The tags a row's own record gives: its `location_id` and `practitioner_id`, each null when it has none. */
export function recordScopeTags(row: Pick<AuditEntry, "before" | "after">): AuditScopeTags {
  const record = recordOf(row);
  return { location_id: idOrNull(record?.location_id), practitioner_id: idOrNull(record?.practitioner_id) };
}

/** Whether tags fall inside the current practitioner and location: a null tag matches any. */
export function isInAuditScope(tags: AuditScopeTags, practitionerId: string, locationId: string): boolean {
  return (tags.location_id === null || tags.location_id === locationId) && (tags.practitioner_id === null || tags.practitioner_id === practitionerId);
}
