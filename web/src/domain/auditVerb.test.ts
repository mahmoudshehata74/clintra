import { describe, expect, it } from "vitest";
import { describeAuditVerb } from "./auditVerb";
import { AuditAction, InvoiceStatus } from "../db/types";
import { VISIT_TRANSITIONS } from "./transitions";
import { VisitStatus } from "./visitStatus";

function visit(overrides: Record<string, unknown>) {
  return { id: "visit-1", position: 1, ...overrides };
}

describe("describeAuditVerb", () => {
  describe("visits: every reachable status transition maps to a specific verb, never the generic fallback", () => {
    const fallback = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Update,
      before: visit({ status: "x" }),
      after: visit({ status: "x" }),
    });

    for (const [from, targets] of Object.entries(VISIT_TRANSITIONS)) {
      for (const to of targets) {
        it(`${from} -> ${to}`, () => {
          const verb = describeAuditVerb({
            entity: "visits",
            action: AuditAction.Update,
            before: visit({ status: from }),
            after: visit({ status: to }),
          });
          expect(verb).not.toBe(fallback);
          expect(verb).not.toMatch(/^عدّل/);
        });
      }
    }
  });

  it.each([
    [VisitStatus.Booked, VisitStatus.Confirmed, "أكّد الحجز"],
    [VisitStatus.Booked, VisitStatus.Arrived, "علّم وصول"],
    [VisitStatus.Confirmed, VisitStatus.Arrived, "علّم وصول"],
    [VisitStatus.Arrived, VisitStatus.InRoom, "حوّل للكشف"],
    [VisitStatus.InRoom, VisitStatus.Completed, "قفل الزيارة"],
  ])("names the exact verb for %s -> %s", (from, to, expected) => {
    const verb = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Update,
      before: visit({ status: from }),
      after: visit({ status: to }),
    });
    expect(verb).toBe(expected);
  });

  it.each([
    [VisitStatus.Booked, VisitStatus.Cancelled, "ألغى الزيارة"],
    [VisitStatus.Arrived, VisitStatus.Cancelled, "ألغى الزيارة"],
    [VisitStatus.Booked, VisitStatus.NoShow, "سجّل غياب"],
    [VisitStatus.InRoom, VisitStatus.NoShow, "سجّل غياب"],
    [VisitStatus.Confirmed, VisitStatus.Rescheduled, "نقل الميعاد"],
  ])("the same terminal verb applies regardless of the starting status: %s -> %s", (from, to, expected) => {
    const verb = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Update,
      before: visit({ status: from }),
      after: visit({ status: to }),
    });
    expect(verb).toBe(expected);
  });

  it("reports a queue reorder when status is unchanged but position moved", () => {
    const verb = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Update,
      before: visit({ status: VisitStatus.Booked, position: 2 }),
      after: visit({ status: VisitStatus.Booked, position: 5 }),
    });
    expect(verb).toBe("غيّر ترتيب الدور");
  });

  it("falls back to a plain edit verb for a genuine field edit with no status or position change", () => {
    const verb = describeAuditVerb({
      entity: "patients",
      action: AuditAction.Update,
      before: { id: "patient-1", full_name: "قديم" },
      after: { id: "patient-1", full_name: "جديد" },
    });
    expect(verb).toBe("عدّل بيانات المريض");
  });

  it.each([
    [InvoiceStatus.Unpaid, InvoiceStatus.Partial, "سجّل دفعة جزئية"],
    [InvoiceStatus.Unpaid, InvoiceStatus.Paid, "سجّل السداد الكامل"],
    [InvoiceStatus.Partial, InvoiceStatus.Paid, "سجّل السداد الكامل"],
    [InvoiceStatus.Unpaid, InvoiceStatus.Void, "ألغى الفاتورة"],
  ])("invoices: %s -> %s", (from, to, expected) => {
    const verb = describeAuditVerb({
      entity: "invoices",
      action: AuditAction.Update,
      before: { id: "invoice-1", status: from },
      after: { id: "invoice-1", status: to },
    });
    expect(verb).toBe(expected);
  });

  it.each([
    ["visits", "سجّل حجز"],
    ["patients", "أضاف مريض"],
    ["invoices", "أنشأ فاتورة"],
    ["payments", "سجّل دفعة"],
    ["cash_close", "قفل اليوم"],
  ])("create verb for %s", (entity, expected) => {
    const verb = describeAuditVerb({ entity, action: AuditAction.Create, before: null, after: { id: "x" } });
    expect(verb).toBe(expected);
  });

  it("falls back to a generic create verb for an entity with no specific one", () => {
    const verb = describeAuditVerb({ entity: "schedules", action: AuditAction.Create, before: null, after: { id: "x" } });
    expect(verb).toBe("أنشأ (schedules)");
  });

  it("delete verb for visits", () => {
    const verb = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Delete,
      before: visit({ status: VisitStatus.Booked }),
      after: null,
    });
    expect(verb).toBe("حذف الزيارة");
  });
});
