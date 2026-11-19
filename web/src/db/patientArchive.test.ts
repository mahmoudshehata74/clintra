import { beforeEach, describe, expect, it } from "vitest";
import { cairoInstant, addDaysToClinicDay } from "../domain/time";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { createPatient } from "./patientCreate";
import { archivePatient, restorePatient } from "./patientArchive";
import { searchPatients } from "./patientSearch";
import { seedDatabase, seededVisitsDate } from "./seed";
import { AuditAction } from "./types";

let db: ClintraDatabase;

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-patient-archive-test-${crypto.randomUUID()}`);
  await seedDatabase(db);
});

/** A seeded patient with a visit of `status` on the seeded day. */
async function patientWith(status: VisitStatus) {
  const visit = (await db.visits.toArray()).find((row) => row.status === status && row.visit_date === seededVisitsDate())!;
  return (await db.patients.get(visit.patient_id))!;
}

describe("archivePatient", () => {
  it("sets archived_at through an audited, synced update, and restorePatient clears it the same way", async () => {
    const [membership] = await db.memberships.toArray();
    const { patient } = await createPatient(db, { orgId: membership.org_id, fullName: "مريض للأرشيف", phone: null });
    const now = new Date("2026-11-18T10:15:00.000Z");

    const archived = await archivePatient(db, patient.id, now);
    expect(archived.ok).toBe(true);
    expect((await db.patients.get(patient.id))?.archived_at).toBe("2026-11-18T10:15:00.000Z");

    const restored = await restorePatient(db, patient.id);
    expect(restored.ok).toBe(true);
    expect((await db.patients.get(patient.id))?.archived_at).toBeNull();

    const audit = (await db.audit_log.toArray()).filter((row) => row.entity_id === patient.id && row.action === AuditAction.Update);
    expect(audit).toHaveLength(2);
    const ops = (await db.sync_ops.toArray())
      .filter((op) => op.entity_id === patient.id && op.action === AuditAction.Update)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(ops.map((op) => (op.payload as { archived_at: string | null }).archived_at)).toEqual(["2026-11-18T10:15:00.000Z", null]);
  });

  it("refuses while a visit is still to come on the day, and allows it once that day is past", async () => {
    const patient = await patientWith(VisitStatus.Booked);
    const onTheDay = new Date(cairoInstant(seededVisitsDate(), "08:00"));
    const before = await db.sync_ops.count();

    expect(await archivePatient(db, patient.id, onTheDay)).toEqual({ ok: false, reason: "upcoming_visit" });
    expect((await db.patients.get(patient.id))?.archived_at ?? null).toBeNull();
    expect(await db.sync_ops.count()).toBe(before);

    const nextDay = new Date(cairoInstant(addDaysToClinicDay(seededVisitsDate(), 1), "08:00"));
    expect((await archivePatient(db, patient.id, nextDay)).ok).toBe(true);
  });

  it("refuses a patient arrived today, and an archive or restore that would change nothing", async () => {
    const arrived = await patientWith(VisitStatus.Arrived);
    const onTheDay = new Date(cairoInstant(seededVisitsDate(), "12:00"));
    expect(await archivePatient(db, arrived.id, onTheDay)).toEqual({ ok: false, reason: "upcoming_visit" });
    expect(await restorePatient(db, arrived.id)).toEqual({ ok: false, reason: "not_archived" });

    const completed = await patientWith(VisitStatus.Completed);
    expect((await archivePatient(db, completed.id, onTheDay)).ok).toBe(true);
    expect(await archivePatient(db, completed.id, onTheDay)).toEqual({ ok: false, reason: "already_archived" });
    expect(await archivePatient(db, "no-such-patient", onTheDay)).toEqual({ ok: false, reason: "patient_not_found" });
  });

  it("keeps the patient's visits and invoices", async () => {
    const completed = await patientWith(VisitStatus.Completed);
    const visitsBefore = (await db.visits.toArray()).filter((visit) => visit.patient_id === completed.id).length;
    const invoicesBefore = (await db.invoices.toArray()).filter((invoice) => invoice.patient_id === completed.id).length;
    await archivePatient(db, completed.id, new Date(cairoInstant(addDaysToClinicDay(seededVisitsDate(), 1), "08:00")));
    expect((await db.visits.toArray()).filter((visit) => visit.patient_id === completed.id)).toHaveLength(visitsBefore);
    expect((await db.invoices.toArray()).filter((invoice) => invoice.patient_id === completed.id)).toHaveLength(invoicesBefore);
  });
});

describe("searchPatients and archived patients", () => {
  it("leaves an archived patient out unless asked to include them", async () => {
    const [membership] = await db.memberships.toArray();
    const { patient } = await createPatient(db, { orgId: membership.org_id, fullName: "مريض مؤرشف للبحث", phone: null });
    await archivePatient(db, patient.id);

    expect(await searchPatients(db, "مؤرشف للبحث")).toEqual([]);
    const included = await searchPatients(db, "مؤرشف للبحث", { includeArchived: true });
    expect(included.map((result) => result.patient.id)).toEqual([patient.id]);

    await restorePatient(db, patient.id);
    expect((await searchPatients(db, "مؤرشف للبحث")).map((result) => result.patient.id)).toEqual([patient.id]);
  });
});
