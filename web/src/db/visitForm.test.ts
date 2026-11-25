import { beforeEach, describe, expect, it } from "vitest";
import { VisitStatus } from "../domain/visitStatus";
import { AuditAction } from "./types";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import {
  findGeneralFormDefinition,
  findVisitFormData,
  readVisitFormValues,
  saveVisitFormField,
  VISIT_COMPLETED_ERROR,
  type VisitFormFieldValues,
} from "./visitForm";

let db: ClintraDatabase;

function findByPosition<T extends { position: number }>(visits: readonly T[], position: number): T {
  const visit = visits.find((v) => v.position === position);
  if (!visit) throw new Error(`seed did not produce a visit at position ${position}`);
  return visit;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-visit-form-test-${crypto.randomUUID()}`);
});

it("reads redacted clinical fields as empty values", () => {
  const redacted = { data: { complaint: null, diagnosis: null } } as unknown as Parameters<typeof readVisitFormValues>[0];
  expect(readVisitFormValues(redacted)).toEqual({ complaint: "", diagnosis: "" });
});

describe("findGeneralFormDefinition", () => {
  it("finds the seeded version-1, current definition for the general template", async () => {
    await seedDatabase(db);
    const definition = await findGeneralFormDefinition(db);
    expect(definition.version).toBe(1);
    expect(definition.is_current).toBe(true);

    const template = await db.specialty_templates.get(definition.template_id);
    expect(template?.key).toBe("general");
  });
});

describe("saveVisitFormField", () => {
  it("creates the visit_form_data row on the first save", async () => {
    await seedDatabase(db);
    const arrivedVisit = findByPosition(await db.visits.toArray(), 2);
    expect(arrivedVisit.status).toBe(VisitStatus.Arrived);

    const auditLogId = await saveVisitFormField(db, arrivedVisit.id, "complaint", "ألم في الحلق");

    const definition = await findGeneralFormDefinition(db);
    const row = await findVisitFormData(db, arrivedVisit.id, definition.id);
    expect(row?.data).toEqual({ complaint: "ألم في الحلق", diagnosis: "" });

    const auditRow = await db.audit_log.get(auditLogId);
    expect(auditRow?.action).toBe(AuditAction.Create);
    expect(auditRow?.before).toBeNull();
  });

  it("updates the same row on a second save, never creating a second row", async () => {
    await seedDatabase(db);
    const arrivedVisit = findByPosition(await db.visits.toArray(), 2);

    await saveVisitFormField(db, arrivedVisit.id, "complaint", "ألم في الحلق");
    const auditLogId = await saveVisitFormField(db, arrivedVisit.id, "complaint", "ألم في الحلق من ثلاثة أيام");

    expect(await db.visit_form_data.count()).toBe(1);

    const definition = await findGeneralFormDefinition(db);
    const row = await findVisitFormData(db, arrivedVisit.id, definition.id);
    expect(row?.data).toEqual({ complaint: "ألم في الحلق من ثلاثة أيام", diagnosis: "" });

    const auditRow = await db.audit_log.get(auditLogId);
    expect(auditRow?.action).toBe(AuditAction.Update);
    expect((auditRow?.before as { data: VisitFormFieldValues } | null)?.data).toEqual({
      complaint: "ألم في الحلق",
      diagnosis: "",
    });
  });

  it("saving a second field preserves the first field's value", async () => {
    await seedDatabase(db);
    const arrivedVisit = findByPosition(await db.visits.toArray(), 2);

    await saveVisitFormField(db, arrivedVisit.id, "complaint", "ألم في الحلق");
    await saveVisitFormField(db, arrivedVisit.id, "diagnosis", "التهاب الحلق");

    const definition = await findGeneralFormDefinition(db);
    const row = await findVisitFormData(db, arrivedVisit.id, definition.id);
    expect(row?.data).toEqual({ complaint: "ألم في الحلق", diagnosis: "التهاب الحلق" });
    expect(await db.visit_form_data.count()).toBe(1);
  });

  it("refuses once the visit is completed, writing nothing: a late change goes through a correction with a reason", async () => {
    await seedDatabase(db);
    const completedVisit = findByPosition(await db.visits.toArray(), 3);
    expect(completedVisit.status).toBe(VisitStatus.Completed);

    await expect(saveVisitFormField(db, completedVisit.id, "diagnosis", "متابعة بعد الشفاء")).rejects.toThrow(VISIT_COMPLETED_ERROR);

    const definition = await findGeneralFormDefinition(db);
    expect(await findVisitFormData(db, completedVisit.id, definition.id)).toBeUndefined();
    expect(await db.audit_log.count()).toBe(0);
    expect(await db.sync_ops.count()).toBe(0);
  });

  it("throws for a visit that does not exist, writing nothing", async () => {
    await seedDatabase(db);

    await expect(saveVisitFormField(db, "not-a-real-visit-id", "complaint", "x")).rejects.toThrow("visit_not_found");
    expect(await db.visit_form_data.count()).toBe(0);
    expect(await db.audit_log.count()).toBe(0);
  });
});
