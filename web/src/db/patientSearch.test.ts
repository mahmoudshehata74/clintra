import { beforeEach, describe, expect, it } from "vitest";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { id } from "../domain/id";
import { ClintraDatabase } from "./database";
import { searchPatients } from "./patientSearch";
import { AuditAction, type Patient } from "./types";
import { mutate } from "./mutate";

let db: ClintraDatabase;

function makePatient(overrides: Partial<Patient>): Patient {
  return {
    id: id(),
    org_id: "org-1",
    full_name: "بدون اسم",
    phone: null,
    gender: null,
    birth_year: null,
    note: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-patient-search-test-${crypto.randomUUID()}`);
});

describe("searchPatients", () => {
  it("returns nothing for an empty query", async () => {
    await db.patients.add(makePatient({ full_name: "كريم فتحي" }));
    expect(await searchPatients(db, "")).toEqual([]);
    expect(await searchPatients(db, "   ")).toEqual([]);
  });

  it("matches a name regardless of tashkeel on either side", async () => {
    const patient = makePatient({ full_name: "مُحَمَّد سعيد" });
    await db.patients.add(patient);

    const byBareQuery = await searchPatients(db, "محمد");
    expect(byBareQuery.map((r) => r.patient.id)).toEqual([patient.id]);

    const byDiacritisedQuery = await searchPatients(db, "مُحَمَّد");
    expect(byDiacritisedQuery.map((r) => r.patient.id)).toEqual([patient.id]);
  });

  it("matches by substring, not only prefix", async () => {
    const patient = makePatient({ full_name: "ياسمين توفيق" });
    await db.patients.add(patient);

    const results = await searchPatients(db, "توفيق");
    expect(results.map((r) => r.patient.id)).toEqual([patient.id]);
  });

  it("matches a local phone number against a patient stored in E.164", async () => {
    const patient = makePatient({ full_name: "عمر جمال", phone: "+201001234567" });
    await db.patients.add(patient);

    const results = await searchPatients(db, "01001234567");
    expect(results.map((r) => r.patient.id)).toEqual([patient.id]);
  });

  it("matches an E.164 phone number input directly", async () => {
    const patient = makePatient({ full_name: "هدى رجب", phone: "+201001234567" });
    await db.patients.add(patient);

    const results = await searchPatients(db, "+201001234567");
    expect(results.map((r) => r.patient.id)).toEqual([patient.id]);
  });

  it("does not list every patient for an unmatched query", async () => {
    await db.patients.add(makePatient({ full_name: "كريم فتحي" }));
    expect(await searchPatients(db, "لا يوجد")).toEqual([]);
  });

  it("caps results at 8", async () => {
    for (let i = 0; i < 10; i++) {
      await db.patients.add(makePatient({ full_name: `أحمد رقم ${i}` }));
    }
    const results = await searchPatients(db, "أحمد");
    expect(results).toHaveLength(8);
  });

  it("reports the last completed visit's date, or null when the patient has never completed one", async () => {
    const withHistory = makePatient({ full_name: "سارة علي" });
    const withoutHistory = makePatient({ full_name: "سارة محمود" });
    await db.patients.bulkAdd([withHistory, withoutHistory]);

    const visitId = id();
    await mutate(db, {
      table: db.visits,
      entity: "visits",
      entityId: visitId,
      action: AuditAction.Create,
      before: null,
      after: {
        id: visitId,
        org_id: "org-1",
        location_id: "loc-1",
        practitioner_id: "practitioner-1",
        patient_id: withHistory.id,
        service_id: null,
        care_plan_item_id: null,
        visit_date: "2026-01-05",
        position: 1,
        scheduled_at: "2026-01-05T09:00:00.000Z",
        status: VisitStatus.Completed,
        is_overbooked: false,
        source: VisitSource.Phone,
        arrived_at: "2026-01-05T09:00:00.000Z",
        started_at: "2026-01-05T09:00:00.000Z",
        ended_at: "2026-01-05T09:30:00.000Z",
        cancel_reason: null,
        rescheduled_from: null,
        created_by: "membership-1",
        created_at: "2026-01-05T08:00:00.000Z",
      },
      actorMembershipId: "membership-1",
      orgId: "org-1",
    });

    const results = await searchPatients(db, "سارة");
    const byId = new Map(results.map((r) => [r.patient.id, r.lastVisitDate]));
    expect(byId.get(withHistory.id)).toBe("2026-01-05");
    expect(byId.get(withoutHistory.id)).toBeNull();
  });
});
