import { describe, expect, it } from "vitest";
import { filterAuditRows, isAuditRowInScope } from "./auditLogFilters";
import { AuditAction, type AuditLog } from "../../db/types";

function row(overrides: Partial<AuditLog>): Pick<AuditLog, "entity" | "action" | "before" | "after"> {
  return { entity: "visits", action: AuditAction.Update, before: null, after: null, ...overrides };
}

describe("filterAuditRows", () => {
  const rows = [
    row({ entity: "visits", action: AuditAction.Create }),
    row({ entity: "visits", action: AuditAction.Update }),
    row({ entity: "patients", action: AuditAction.Create }),
    row({ entity: "invoices", action: AuditAction.Delete }),
  ];

  it("matches every row when both filters are 'all'", () => {
    expect(filterAuditRows(rows, "all", "all")).toHaveLength(4);
  });

  it("filters by entity type alone", () => {
    const result = filterAuditRows(rows, "visits", "all");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.entity === "visits")).toBe(true);
  });

  it("filters by action alone", () => {
    const result = filterAuditRows(rows, "all", AuditAction.Create);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.action === AuditAction.Create)).toBe(true);
  });

  it("filters by entity type and action together", () => {
    const result = filterAuditRows(rows, "visits", AuditAction.Create);
    expect(result).toHaveLength(1);
    expect(result[0].entity).toBe("visits");
    expect(result[0].action).toBe(AuditAction.Create);
  });

  it("returns an empty list when no row matches both filters", () => {
    expect(filterAuditRows(rows, "patients", AuditAction.Delete)).toHaveLength(0);
  });
});

describe("isAuditRowInScope", () => {
  it("includes a row whose payload matches both practitioner_id and location_id", () => {
    const inScope = isAuditRowInScope(
      { before: null, after: { practitioner_id: "prac-1", location_id: "loc-1" } },
      "prac-1",
      "loc-1",
    );
    expect(inScope).toBe(true);
  });

  it("excludes a row whose payload has a mismatching location_id", () => {
    const inScope = isAuditRowInScope(
      { before: null, after: { practitioner_id: "prac-1", location_id: "loc-2" } },
      "prac-1",
      "loc-1",
    );
    expect(inScope).toBe(false);
  });

  it("excludes a row whose payload has a mismatching practitioner_id", () => {
    const inScope = isAuditRowInScope(
      { before: null, after: { practitioner_id: "prac-2", location_id: "loc-1" } },
      "prac-1",
      "loc-1",
    );
    expect(inScope).toBe(false);
  });

  it("includes a row whose payload has neither field at all (e.g. a patient)", () => {
    const inScope = isAuditRowInScope({ before: null, after: { full_name: "مريض" } }, "prac-1", "loc-1");
    expect(inScope).toBe(true);
  });

  it("includes a row whose payload has only location_id, when it matches (e.g. a payment)", () => {
    const inScope = isAuditRowInScope({ before: null, after: { location_id: "loc-1" } }, "prac-1", "loc-1");
    expect(inScope).toBe(true);
  });

  it("falls back to before when after is null (a delete)", () => {
    const inScope = isAuditRowInScope(
      { before: { practitioner_id: "prac-1", location_id: "loc-1" }, after: null },
      "prac-1",
      "loc-1",
    );
    expect(inScope).toBe(true);
  });

  it("includes a row with no payload on either side", () => {
    expect(isAuditRowInScope({ before: null, after: null }, "prac-1", "loc-1")).toBe(true);
  });
});
