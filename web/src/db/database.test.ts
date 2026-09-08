import { beforeEach, describe, expect, it } from "vitest";
import { id } from "../domain/id";
import { VisitStatus } from "../domain/visitStatus";
import { VisitSource } from "../domain/visitSource";
import type { Piastres } from "../domain/money";
import { ClintraDatabase } from "./database";
import { InvoiceStatus, type Invoice, type Visit } from "./types";

let db: ClintraDatabase;

const ORG_ID = "org-1";
const LOCATION_ID = "location-1";
const PRACTITIONER_ID = "practitioner-1";
const PATIENT_ID = "patient-1";

function makeVisit(overrides: Partial<Visit>): Visit {
  return {
    id: id(),
    org_id: ORG_ID,
    location_id: LOCATION_ID,
    practitioner_id: PRACTITIONER_ID,
    patient_id: PATIENT_ID,
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-06",
    position: 1,
    scheduled_at: null,
    status: VisitStatus.Booked,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-db-test-${crypto.randomUUID()}`);
});

describe("visits indexes", () => {
  it("returns only visits matching [org_id+location_id+visit_date+status]", async () => {
    await db.visits.bulkAdd([
      makeVisit({ position: 1, status: VisitStatus.Booked, visit_date: "2026-09-06" }),
      makeVisit({ position: 2, status: VisitStatus.Cancelled, visit_date: "2026-09-06" }),
      makeVisit({ position: 3, status: VisitStatus.Booked, visit_date: "2026-09-07" }),
    ]);

    const matches = await db.visits
      .where("[org_id+location_id+visit_date+status]")
      .equals([ORG_ID, LOCATION_ID, "2026-09-06", VisitStatus.Booked])
      .toArray();

    expect(matches).toHaveLength(1);
    expect(matches[0].position).toBe(1);
  });

  it("returns only visits matching [practitioner_id+visit_date]", async () => {
    await db.visits.bulkAdd([
      makeVisit({ position: 1, visit_date: "2026-09-06" }),
      makeVisit({ position: 2, visit_date: "2026-09-07" }),
    ]);

    const matches = await db.visits
      .where("[practitioner_id+visit_date]")
      .equals([PRACTITIONER_ID, "2026-09-06"])
      .toArray();

    expect(matches).toHaveLength(1);
    expect(matches[0].position).toBe(1);
  });

  it("rejects a second visit with the same practitioner, date and position", async () => {
    await db.visits.add(makeVisit({ position: 1 }));

    await expect(db.visits.add(makeVisit({ position: 1 }))).rejects.toThrow();
  });
});

describe("invoices index", () => {
  function makeInvoice(overrides: Partial<Invoice>): Invoice {
    return {
      id: id(),
      org_id: ORG_ID,
      location_id: LOCATION_ID,
      number: 1,
      patient_id: PATIENT_ID,
      practitioner_id: PRACTITIONER_ID,
      visit_id: null,
      total: 0 as Piastres,
      paid: 0 as Piastres,
      status: InvoiceStatus.Unpaid,
      issued_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it("rejects a second invoice with the same location and number", async () => {
    await db.invoices.add(makeInvoice({ number: 1 }));

    await expect(db.invoices.add(makeInvoice({ number: 1 }))).rejects.toThrow();
  });
});

describe("patients indexes", () => {
  it("finds a patient by full_name", async () => {
    await db.patients.bulkAdd([
      {
        id: id(),
        org_id: ORG_ID,
        full_name: "منى عبد الله",
        phone: null,
        gender: null,
        birth_year: null,
        note: null,
        created_at: new Date().toISOString(),
      },
      {
        id: id(),
        org_id: ORG_ID,
        full_name: "كريم فتحي",
        phone: "+201001234567",
        gender: null,
        birth_year: null,
        note: null,
        created_at: new Date().toISOString(),
      },
    ]);

    const byName = await db.patients.where("full_name").equals("كريم فتحي").toArray();
    expect(byName).toHaveLength(1);

    const byPhone = await db.patients.where("phone").equals("+201001234567").toArray();
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0].full_name).toBe("كريم فتحي");
  });

  it("allows two patients to share the same phone — families share phone numbers", async () => {
    await db.patients.add({
      id: id(),
      org_id: ORG_ID,
      full_name: "أحمد محمود",
      phone: "+201001234567",
      gender: null,
      birth_year: null,
      note: null,
      created_at: new Date().toISOString(),
    });

    await expect(
      db.patients.add({
        id: id(),
        org_id: ORG_ID,
        full_name: "ابن أحمد محمود",
        phone: "+201001234567",
        gender: null,
        birth_year: null,
        note: null,
        created_at: new Date().toISOString(),
      }),
    ).resolves.toBeTruthy();
  });
});

describe("users index", () => {
  it("rejects a second user with the same phone — unlike patients, users has no household-sharing case", async () => {
    await db.users.add({
      id: id(),
      full_name: "سارة حسن",
      phone: "+201123456789",
      email: null,
      is_active: true,
    });

    await expect(
      db.users.add({
        id: id(),
        full_name: "شخص آخر",
        phone: "+201123456789",
        email: null,
        is_active: true,
      }),
    ).rejects.toThrow();
  });
});
