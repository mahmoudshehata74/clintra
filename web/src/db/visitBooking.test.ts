import { beforeEach, describe, expect, it } from "vitest";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { undoMostRecentVisitMutation } from "./mutate";
import { seedDatabase } from "./seed";
import { bookExistingPatientVisit } from "./visitBooking";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-booking-test-${crypto.randomUUID()}`);
});

async function seededContext() {
  await seedDatabase(db);
  const [schedule] = await db.schedules.toArray();
  const [practitioner] = await db.practitioners.toArray();
  const patients = await db.patients.toArray();
  const services = await db.services.toArray();
  const visits = await db.visits.toArray();
  return { schedule, practitioner, patients, services, visits };
}

describe("bookExistingPatientVisit", () => {
  it("creates a new booked visit in a slot that never had one, through mutate()", async () => {
    const { schedule, practitioner, patients, services, visits } = await seededContext();
    const patient = patients[patients.length - 1];
    const service = services[0];
    // The seed pins its visits to a fixed deterministic date, not today; read
    // it back from a seeded visit rather than recomputing it here.
    const visitDate = visits[0].visit_date;

    const before = await db.visits.count();
    const outcome = await bookExistingPatientVisit(db, {
      practitionerId: practitioner.id,
      locationId: schedule.location_id,
      orgId: practitioner.org_id,
      patientId: patient.id,
      serviceId: service.id,
      visitDate,
      time: "11:30",
      schedule,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");

    const after = await db.visits.count();
    expect(after).toBe(before + 1);

    // Seed only ever occupies positions 1-5, so position 6 unambiguously
    // identifies the row this call just wrote, regardless of the arbitrary
    // primary-key order db.visits.toArray() otherwise returns rows in.
    const created = await db.visits.toArray();
    const booked = created.find((v) => v.position === 6);
    expect(booked).toBeTruthy();
    expect(booked?.patient_id).toBe(patient.id);
    expect(booked?.service_id).toBe(service.id);
    expect(booked?.status).toBe(VisitStatus.Booked);
    expect(booked?.source).toBe(VisitSource.Phone);
    expect(booked?.is_overbooked).toBe(false);

    const [membership] = await db.memberships.toArray();
    expect(booked?.created_by).toBe(membership.id);

    expect(await db.audit_log.count()).toBe(1);
    expect(await db.sync_ops.count()).toBe(1);
  });

  it("updates a cancelled visit's row in place rather than creating a new one, since position is unique regardless of status", async () => {
    const { schedule, practitioner, patients, services, visits } = await seededContext();
    const cancelledVisit = visits.find((v) => v.status === VisitStatus.Cancelled);
    if (!cancelledVisit) throw new Error("seed did not produce a cancelled visit");
    const newPatient = patients.find((p) => p.id !== cancelledVisit.patient_id);
    if (!newPatient) throw new Error("no other patient to book");
    const service = services[0];

    const visitCountBefore = await db.visits.count();

    const outcome = await bookExistingPatientVisit(db, {
      practitionerId: practitioner.id,
      locationId: schedule.location_id,
      orgId: practitioner.org_id,
      patientId: newPatient.id,
      serviceId: service.id,
      visitDate: cancelledVisit.visit_date,
      time: "11:00",
      schedule,
    });

    expect(outcome.ok).toBe(true);
    expect(await db.visits.count()).toBe(visitCountBefore);

    const updated = await db.visits.get(cancelledVisit.id);
    expect(updated?.patient_id).toBe(newPatient.id);
    expect(updated?.status).toBe(VisitStatus.Booked);
    expect(updated?.cancel_reason).toBeNull();
    expect(updated?.position).toBe(cancelledVisit.position);

    const auditRows = await db.audit_log.toArray();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entity_id).toBe(cancelledVisit.id);
    expect(await db.sync_ops.count()).toBe(1);
  });

  it("surfaces a uniqueness collision as a typed result without writing anything", async () => {
    const { schedule, practitioner, patients, services, visits } = await seededContext();
    const alreadyBooked = visits.find((v) => v.status === VisitStatus.Booked);
    if (!alreadyBooked) throw new Error("seed did not produce a booked visit");
    const otherPatient = patients.find((p) => p.id !== alreadyBooked.patient_id);
    if (!otherPatient) throw new Error("no other patient to book");

    const visitCountBefore = await db.visits.count();

    const outcome = await bookExistingPatientVisit(db, {
      practitionerId: practitioner.id,
      locationId: schedule.location_id,
      orgId: practitioner.org_id,
      patientId: otherPatient.id,
      serviceId: services[0].id,
      visitDate: alreadyBooked.visit_date,
      // The already-booked visit's own time: bookExistingPatientVisit
      // re-checks the slot itself at write time, so this is caught even
      // though the caller never passed any prior visit for this slot.
      time: "09:00",
      schedule,
    });

    expect(outcome).toEqual({ ok: false, reason: "slot_taken" });
    expect(await db.visits.count()).toBe(visitCountBefore);
    expect(await db.audit_log.count()).toBe(0);
    expect(await db.sync_ops.count()).toBe(0);
  });

  it("refuses to reuse a freed slot that another booking already reused, rather than silently overwriting it", async () => {
    const { schedule, practitioner, patients, services, visits } = await seededContext();
    const cancelledVisit = visits.find((v) => v.status === VisitStatus.Cancelled);
    if (!cancelledVisit) throw new Error("seed did not produce a cancelled visit");
    const [firstPatient, secondPatient] = patients.filter((p) => p.id !== cancelledVisit.patient_id);

    const firstOutcome = await bookExistingPatientVisit(db, {
      practitionerId: practitioner.id,
      locationId: schedule.location_id,
      orgId: practitioner.org_id,
      patientId: firstPatient.id,
      serviceId: services[0].id,
      visitDate: cancelledVisit.visit_date,
      time: "11:00",
      schedule,
    });
    expect(firstOutcome.ok).toBe(true);

    // A second attempt at the exact same slot, as if a stale "still cancelled"
    // slot list had offered it again — the write path must catch this itself
    // rather than trusting whatever the caller last saw.
    const secondOutcome = await bookExistingPatientVisit(db, {
      practitionerId: practitioner.id,
      locationId: schedule.location_id,
      orgId: practitioner.org_id,
      patientId: secondPatient.id,
      serviceId: services[0].id,
      visitDate: cancelledVisit.visit_date,
      time: "11:00",
      schedule,
    });

    expect(secondOutcome).toEqual({ ok: false, reason: "slot_taken" });
    const stillFirstBooking = await db.visits.get(cancelledVisit.id);
    expect(stillFirstBooking?.patient_id).toBe(firstPatient.id);
    expect(await db.audit_log.count()).toBe(1);
    expect(await db.sync_ops.count()).toBe(1);
  });

  it("walk-in: books and marks arrived in the same write, not two separate calls", async () => {
    const { schedule, practitioner, patients, services, visits } = await seededContext();
    const patient = patients[0];
    const visitDate = visits[0].visit_date;

    const outcome = await bookExistingPatientVisit(db, {
      practitionerId: practitioner.id,
      locationId: schedule.location_id,
      orgId: practitioner.org_id,
      patientId: patient.id,
      serviceId: services[0].id,
      visitDate,
      time: "11:30",
      schedule,
      status: VisitStatus.Arrived,
      source: VisitSource.Walkin,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected success");

    // Exactly one audit_log row: the booking and the arrival are the same write.
    expect(await db.audit_log.count()).toBe(1);
    expect(await db.sync_ops.count()).toBe(1);

    const created = (await db.visits.toArray()).find((v) => v.position === 6);
    expect(created?.status).toBe(VisitStatus.Arrived);
    expect(created?.source).toBe(VisitSource.Walkin);
    expect(created?.arrived_at).not.toBeNull();

    // Undoing the one write reverses both the booking and the arrival together.
    const undoOutcome = await undoMostRecentVisitMutation(db, outcome.auditLogId);
    expect(undoOutcome).toEqual({ ok: true });
    expect(await db.visits.get(created!.id)).toBeUndefined();
  });

  it("overbook: succeeds where a normal booking at the same time would collide", async () => {
    const { schedule, practitioner, patients, services, visits } = await seededContext();
    const alreadyBooked = visits.find((v) => v.status === VisitStatus.Booked);
    if (!alreadyBooked) throw new Error("seed did not produce a booked visit");
    const otherPatient = patients.find((p) => p.id !== alreadyBooked.patient_id);
    if (!otherPatient) throw new Error("no other patient to book");

    const visitCountBefore = await db.visits.count();

    const outcome = await bookExistingPatientVisit(db, {
      practitionerId: practitioner.id,
      locationId: schedule.location_id,
      orgId: practitioner.org_id,
      patientId: otherPatient.id,
      serviceId: services[0].id,
      visitDate: alreadyBooked.visit_date,
      time: "09:00",
      schedule,
      isOverbooked: true,
    });

    expect(outcome.ok).toBe(true);
    expect(await db.visits.count()).toBe(visitCountBefore + 1);

    if (!outcome.ok) throw new Error("expected success");
    const auditRow = await db.audit_log.get(outcome.auditLogId);
    const overbooked = await db.visits.get((auditRow!.after as { id: string }).id);
    expect(overbooked?.is_overbooked).toBe(true);
    expect(overbooked?.scheduled_at).toBe(alreadyBooked.scheduled_at);
    // Position stays unique even though the time collides.
    expect(overbooked?.position).not.toBe(alreadyBooked.position);
  });

  it("overbook: two concurrent overbook writes at the same time both succeed with distinct positions", async () => {
    const { schedule, practitioner, patients, services, visits } = await seededContext();
    const visitDate = visits[0].visit_date;
    const [patientA, patientB] = patients;

    const [outcomeA, outcomeB] = await Promise.all([
      bookExistingPatientVisit(db, {
        practitionerId: practitioner.id,
        locationId: schedule.location_id,
        orgId: practitioner.org_id,
        patientId: patientA.id,
        serviceId: services[0].id,
        visitDate,
        time: "09:00",
        schedule,
        isOverbooked: true,
      }),
      bookExistingPatientVisit(db, {
        practitionerId: practitioner.id,
        locationId: schedule.location_id,
        orgId: practitioner.org_id,
        patientId: patientB.id,
        serviceId: services[0].id,
        visitDate,
        time: "09:00",
        schedule,
        isOverbooked: true,
      }),
    ]);

    expect(outcomeA.ok).toBe(true);
    expect(outcomeB.ok).toBe(true);
    if (!outcomeA.ok || !outcomeB.ok) throw new Error("expected both to succeed");

    const allVisits = await db.visits.toArray();
    const positions = allVisits.map((v) => v.position);
    // No two visits collide on position, even though both overbook writes
    // targeted the same time concurrently.
    expect(new Set(positions).size).toBe(positions.length);
  });
});
