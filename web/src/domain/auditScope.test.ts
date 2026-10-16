import { describe, expect, it } from "vitest";
import { AuditAction } from "../db/types";
import { auditScopeParentId, auditScopeTags, isInAuditScope } from "./auditScope";

function row(entity: string, after: Record<string, unknown> | null, before: Record<string, unknown> | null = null) {
  return { entity, entity_id: "entity-1", action: after ? AuditAction.Create : AuditAction.Delete, before, after };
}

describe("auditScopeTags", () => {
  it("takes a record's own location and practitioner, each null when absent", () => {
    expect(auditScopeTags(row("visits", { location_id: "loc-1", practitioner_id: "pr-1" }), undefined)).toEqual({ location_id: "loc-1", practitioner_id: "pr-1" });
    expect(auditScopeTags(row("payments", { location_id: "loc-1" }), undefined)).toEqual({ location_id: "loc-1", practitioner_id: null });
    expect(auditScopeTags(row("patients", { full_name: "كريم" }), undefined)).toEqual({ location_id: null, practitioner_id: null });
  });

  it("reads a deleted row's record from before", () => {
    expect(auditScopeTags(row("visits", null, { location_id: "loc-2", practitioner_id: "pr-2" }), undefined)).toEqual({ location_id: "loc-2", practitioner_id: "pr-2" });
  });

  it("scopes a practitioner's own row to that practitioner at any location", () => {
    expect(auditScopeTags({ ...row("practitioners", { full_name: "د. منى", location_id: "x" }), entity_id: "pr-9" }, undefined)).toEqual({ location_id: null, practitioner_id: "pr-9" });
  });

  it("scopes a child row by its parent, and has no tags without the parent", () => {
    for (const [entity, field] of [
      ["visit_form_data", "visit_id"],
      ["prescription_items", "prescription_id"],
      ["care_plan_items", "care_plan_id"],
      ["invoice_items", "invoice_id"],
    ]) {
      const child = row(entity, { [field]: "parent-1" });
      expect(auditScopeParentId(child)).toBe("parent-1");
      expect(auditScopeTags(child, { location_id: "loc-1", practitioner_id: "pr-1" })).toEqual({ location_id: "loc-1", practitioner_id: "pr-1" });
      expect(auditScopeTags(child, undefined)).toBeNull();
    }
    expect(auditScopeParentId(row("visits", { location_id: "loc-1" }))).toBeNull();
  });
});

describe("isInAuditScope", () => {
  it("matches a null tag anywhere and a set tag only where it is", () => {
    expect(isInAuditScope({ location_id: null, practitioner_id: null }, "pr-1", "loc-1")).toBe(true);
    expect(isInAuditScope({ location_id: "loc-1", practitioner_id: "pr-1" }, "pr-1", "loc-1")).toBe(true);
    expect(isInAuditScope({ location_id: "loc-2", practitioner_id: null }, "pr-1", "loc-1")).toBe(false);
    expect(isInAuditScope({ location_id: null, practitioner_id: "pr-2" }, "pr-1", "loc-1")).toBe(false);
  });
});
