import { describe, expect, it } from "vitest";
import { describeAuditVerb, describeVisitFormChange } from "./auditVerb";
import { AuditAction, InvoiceStatus } from "../db/types";
import { VISIT_TRANSITIONS } from "./transitions";
import { VisitStatus } from "./visitStatus";

function visitFormData(data: Record<string, string>) {
  return { id: "form-1", visit_id: "visit-1", form_definition_id: "def-1", data };
}

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

  it("reports a note edit on a visit, without the note's text", () => {
    const verb = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Update,
      before: visit({ status: VisitStatus.InRoom, note: null }),
      after: visit({ status: VisitStatus.InRoom, note: "ضغط مرتفع" }),
    });
    expect(verb).toBe("عدّل ملاحظة الزيارة");
    expect(verb).not.toContain("ضغط مرتفع");
  });

  it("reports clearing a visit's note as a note edit too", () => {
    const verb = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Update,
      before: visit({ status: VisitStatus.InRoom, note: "ضغط مرتفع" }),
      after: visit({ status: VisitStatus.InRoom, note: null }),
    });
    expect(verb).toBe("عدّل ملاحظة الزيارة");
  });

  it("does not read a missing note field (an audit row from before visits.note) as a note edit", () => {
    const verb = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Update,
      before: visit({ status: VisitStatus.Booked }),
      after: visit({ status: VisitStatus.Booked, note: null }),
    });
    expect(verb).toBe("عدّل الزيارة");
  });

  it("a status change still wins over a note change in the same write", () => {
    const verb = describeAuditVerb({
      entity: "visits",
      action: AuditAction.Update,
      before: visit({ status: VisitStatus.Booked, note: null }),
      after: visit({ status: VisitStatus.Arrived, note: "وصل متأخر" }),
    });
    expect(verb).toBe("علّم وصول");
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

  describe("visit_form_data", () => {
    it("registers a complaint on its first save (a create)", () => {
      const verb = describeAuditVerb({
        entity: "visit_form_data",
        action: AuditAction.Create,
        before: null,
        after: visitFormData({ complaint: "ألم في الحلق", diagnosis: "" }),
      });
      expect(verb).toBe("سجّل شكوى");
    });

    it("registers a diagnosis saved for the first time on an already-existing row (an update, but still 'registered')", () => {
      const verb = describeAuditVerb({
        entity: "visit_form_data",
        action: AuditAction.Update,
        before: visitFormData({ complaint: "ألم في الحلق", diagnosis: "" }),
        after: visitFormData({ complaint: "ألم في الحلق", diagnosis: "التهاب الحلق" }),
      });
      expect(verb).toBe("سجّل تشخيص");
    });

    it("edits a complaint that already had a value", () => {
      const verb = describeAuditVerb({
        entity: "visit_form_data",
        action: AuditAction.Update,
        before: visitFormData({ complaint: "ألم في الحلق", diagnosis: "" }),
        after: visitFormData({ complaint: "ألم في الحلق من ثلاثة أيام", diagnosis: "" }),
      });
      expect(verb).toBe("عدّل شكوى");
    });

    it("falls back to a generic verb when neither field's text actually changed", () => {
      const verb = describeAuditVerb({
        entity: "visit_form_data",
        action: AuditAction.Update,
        before: visitFormData({ complaint: "ألم في الحلق", diagnosis: "" }),
        after: visitFormData({ complaint: "ألم في الحلق", diagnosis: "" }),
      });
      expect(verb).toBe("عدّل النموذج");
    });

    it("truncates the excerpt to 40 characters", () => {
      const longValue = "أ".repeat(60);
      const change = describeVisitFormChange({
        entity: "visit_form_data",
        action: AuditAction.Create,
        before: null,
        after: visitFormData({ complaint: longValue, diagnosis: "" }),
      });
      expect(change?.excerpt).toHaveLength(41); // 40 characters + the ellipsis mark
      expect(change?.excerpt.startsWith("أ".repeat(40))).toBe(true);
    });
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

describe("describeAuditVerb: prescriptions", () => {
  const prescription = (overrides: Record<string, unknown>) => ({
    id: "rx-1",
    visit_id: "visit-1",
    number: 1,
    diagnosis: null,
    printed_at: null,
    ...overrides,
  });
  const item = (overrides: Record<string, unknown>) => ({
    id: "item-1",
    prescription_id: "rx-1",
    name: "Diclofenac 50mg",
    instructions: "قرص مرتين يومياً",
    position: 1,
    ...overrides,
  });

  it.each([
    ["writing a prescription", { entity: "prescriptions", action: AuditAction.Create, before: null, after: prescription({}) }, "كتب وصفة"],
    ["adding a drug", { entity: "prescription_items", action: AuditAction.Create, before: null, after: item({}) }, "أضاف دواء"],
    [
      "editing a drug",
      { entity: "prescription_items", action: AuditAction.Update, before: item({}), after: item({ instructions: "قرص عند اللزوم" }) },
      "عدّل دواء",
    ],
    ["removing a drug", { entity: "prescription_items", action: AuditAction.Delete, before: item({}), after: null }, "شال دواء"],
    [
      "the first print",
      {
        entity: "prescriptions",
        action: AuditAction.Update,
        before: prescription({}),
        after: prescription({ printed_at: "2026-10-12T08:00:00.000Z", diagnosis: "التهاب وتر الرضفة" }),
      },
      "طبع الوصفة",
    ],
  ])("%s reads as a verb alone, never the drug or the diagnosis", (_label, row, expected) => {
    const verb = describeAuditVerb(row);
    expect(verb).toBe(expected);
    for (const secret of ["Diclofenac", "قرص", "التهاب"]) {
      expect(verb).not.toContain(secret);
    }
  });
});
