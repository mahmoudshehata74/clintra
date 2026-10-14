import { describe, expect, it } from "vitest";
import { auditGroupOf, filterAuditRows, isAuditRowInScope } from "./auditLogFilters";
import { AuditAction, type AuditLog } from "../../db/types";

function row(overrides: Partial<AuditLog>): Pick<AuditLog, "entity" | "action" | "before" | "after"> {
  return { entity: "visits", action: AuditAction.Update, before: null, after: null, ...overrides };
}

describe("filterAuditRows", () => {
  const rows = [
    row({ entity: "visits", action: AuditAction.Create }),
    row({ entity: "visit_form_data", action: AuditAction.Update }),
    row({ entity: "prescriptions", action: AuditAction.Create }),
    row({ entity: "prescription_items", action: AuditAction.Delete }),
    row({ entity: "care_plans", action: AuditAction.Create }),
    row({ entity: "care_plan_items", action: AuditAction.Update }),
    row({ entity: "patients", action: AuditAction.Create }),
    row({ entity: "messages", action: AuditAction.Create }),
    row({ entity: "invoices", action: AuditAction.Delete }),
    row({ entity: "payments", action: AuditAction.Create }),
    row({ entity: "cash_close", action: AuditAction.Create }),
    row({ entity: "services", action: AuditAction.Update }),
    row({ entity: "service_price_overrides", action: AuditAction.Create }),
    row({ entity: "schedules", action: AuditAction.Update }),
    row({ entity: "users", action: AuditAction.Create }),
    row({ entity: "memberships", action: AuditAction.Update }),
    row({ entity: "membership_locations", action: AuditAction.Create }),
    row({ entity: "membership_practitioners", action: AuditAction.Create }),
    row({ entity: "practitioners", action: AuditAction.Update }),
    row({ entity: "message_templates", action: AuditAction.Delete }),
    row({ entity: "day_state", action: AuditAction.Update }),
  ];
  const entitiesOf = (filter: Parameters<typeof filterAuditRows>[1]) => filterAuditRows(rows, filter).map((r) => r.entity);

  it("lists every row under الكل, including one in no group", () => {
    expect(entitiesOf("all")).toEqual(rows.map((r) => r.entity));
  });

  it("lists visits, visit forms, prescriptions, care plans, patients and messages under زيارات", () => {
    expect(entitiesOf("visits")).toEqual([
      "visits",
      "visit_form_data",
      "prescriptions",
      "prescription_items",
      "care_plans",
      "care_plan_items",
      "patients",
      "messages",
    ]);
  });

  it("lists invoices, payments and the cash close under فواتير", () => {
    expect(entitiesOf("invoices")).toEqual(["invoices", "payments", "cash_close"]);
  });

  it("lists services, prices, hours, staff, practitioners and templates under إعدادات", () => {
    expect(entitiesOf("settings")).toEqual([
      "services",
      "service_price_overrides",
      "schedules",
      "users",
      "memberships",
      "membership_locations",
      "membership_practitioners",
      "practitioners",
      "message_templates",
    ]);
  });

  it("puts an entity in no group in none of the three", () => {
    expect(auditGroupOf("day_state")).toBeNull();
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
