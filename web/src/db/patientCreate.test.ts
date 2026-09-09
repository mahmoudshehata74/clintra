import { beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "./database";
import { undoMostRecentPatientMutation, undoMostRecentVisitMutation } from "./mutate";
import { createPatient } from "./patientCreate";
import { findSeededSlotsPractitioner, seedDatabase, seededVisitsDate } from "./seed";
import { bookExistingPatientVisit } from "./visitBooking";
import { weekdayOf } from "../domain/time";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-patient-create-test-${crypto.randomUUID()}`);
});

describe("createPatient", () => {
  it("writes a patient with only the collected fields, through mutate()", async () => {
    await seedDatabase(db);
    const [membership] = await db.memberships.toArray();

    const before = await db.patients.count();
    const { patient, auditLogId } = await createPatient(db, {
      orgId: membership.org_id,
      fullName: "مريض جديد",
      phone: "+201001234567",
    });

    expect(await db.patients.count()).toBe(before + 1);
    const stored = await db.patients.get(patient.id);
    expect(stored).toMatchObject({
      org_id: membership.org_id,
      full_name: "مريض جديد",
      phone: "+201001234567",
      gender: null,
      birth_year: null,
      note: null,
    });
    expect(stored?.created_at).toBeTruthy();

    const auditRows = await db.audit_log.toArray();
    const auditRow = auditRows.find((row) => row.id === auditLogId);
    expect(auditRow).toMatchObject({ entity: "patients", entity_id: patient.id, action: "create", before: null });
    expect(await db.sync_ops.count()).toBeGreaterThan(0);
  });

  it("writes a null phone when none is given", async () => {
    await seedDatabase(db);
    const [membership] = await db.memberships.toArray();

    const { patient } = await createPatient(db, {
      orgId: membership.org_id,
      fullName: "مريض بدون رقم",
      phone: null,
    });

    const stored = await db.patients.get(patient.id);
    expect(stored?.phone).toBeNull();
  });

  it("allows two patients with the same phone in the same org — no uniqueness is enforced on patients.phone", async () => {
    await seedDatabase(db);
    const [membership] = await db.memberships.toArray();

    const first = await createPatient(db, {
      orgId: membership.org_id,
      fullName: "أحمد محمود",
      phone: "+201001234567",
    });
    const second = await createPatient(db, {
      orgId: membership.org_id,
      fullName: "أحمد محمود آخر",
      phone: "+201001234567",
    });

    expect(first.patient.id).not.toBe(second.patient.id);
    expect(await db.patients.where("phone").equals("+201001234567").count()).toBe(2);
  });
});

describe("undoing a new-patient booking (patient create + visit create)", () => {
  it("reverses both the visit and the patient, in reverse order, leaving neither behind", async () => {
    await seedDatabase(db);
    const practitioner = await findSeededSlotsPractitioner(db);
    const visitDate = seededVisitsDate();
    const schedule = (await db.schedules.toArray()).find(
      (candidate) => candidate.practitioner_id === practitioner.id && candidate.weekday === weekdayOf(visitDate),
    )!;
    const services = await db.services.toArray();

    const patientsBefore = await db.patients.count();
    const visitsBefore = await db.visits.count();

    const { patient, auditLogId: patientAuditLogId } = await createPatient(db, {
      orgId: practitioner.org_id,
      fullName: "مريض جديد للحجز",
      phone: null,
    });

    const bookingOutcome = await bookExistingPatientVisit(db, {
      practitionerId: practitioner.id,
      locationId: schedule.location_id,
      orgId: practitioner.org_id,
      patientId: patient.id,
      serviceId: services[0].id,
      visitDate,
      // A slot the seed never touches (only positions 1-5 are seeded).
      time: "13:00",
      schedule,
    });
    expect(bookingOutcome.ok).toBe(true);
    if (!bookingOutcome.ok) throw new Error("expected success");

    // Mirrors DayScreen's undo handler exactly: visit first, then patient.
    const visitUndo = await undoMostRecentVisitMutation(db, bookingOutcome.auditLogId);
    expect(visitUndo).toEqual({ ok: true });

    const patientUndo = await undoMostRecentPatientMutation(db, patientAuditLogId);
    expect(patientUndo).toEqual({ ok: true });

    expect(await db.patients.count()).toBe(patientsBefore);
    expect(await db.visits.count()).toBe(visitsBefore);
    expect(await db.patients.get(patient.id)).toBeUndefined();
  });
});
