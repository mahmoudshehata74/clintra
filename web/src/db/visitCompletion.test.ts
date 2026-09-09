import { beforeEach, describe, expect, it } from "vitest";
import { id } from "../domain/id";
import type { Piastres } from "../domain/money";
import { InvoiceStatus } from "./types";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { markVisitInRoom } from "./visitAttendance";
import { seedDatabase } from "./seed";
import type { Visit } from "./types";
import { completeVisitWithInvoice } from "./visitCompletion";

let db: ClintraDatabase;

function findByPosition<T extends { position: number }>(visits: readonly T[], position: number): T {
  const visit = visits.find((v) => v.position === position);
  if (!visit) throw new Error(`seed did not produce a visit at position ${position}`);
  return visit;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-visit-completion-test-${crypto.randomUUID()}`);
});

/**
 * A fresh visit written directly (bypassing mutate()), already in_room,
 * ready to complete. Resolves practitioner/location/service by re-reading
 * them each call rather than caching, but always takes the first row IndexedDB
 * hands back for each — callers that need a SPECIFIC location (e.g. to test
 * a second one) must pass location_id explicitly, never rely on array order.
 */
async function makeInRoomVisit(overrides: Partial<Visit> = {}): Promise<Visit> {
  const [practitioner] = await db.practitioners.toArray();
  const [location] = await db.locations.toArray();
  const [service] = await db.services.toArray();
  const patient = (await db.patients.toArray())[0];
  const visitsForDay = await db.visits.where("[practitioner_id+visit_date]").equals([practitioner.id, "2026-09-07"]).toArray();
  const position = visitsForDay.reduce((max, v) => Math.max(max, v.position), 0) + 1;

  const visit: Visit = {
    id: id(),
    org_id: practitioner.org_id,
    location_id: location.id,
    practitioner_id: practitioner.id,
    patient_id: patient.id,
    service_id: service.id,
    care_plan_item_id: null,
    visit_date: "2026-09-07",
    position,
    scheduled_at: null,
    status: VisitStatus.InRoom,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: "2026-09-07T06:00:00.000Z",
    started_at: "2026-09-07T06:10:00.000Z",
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: "2026-09-07T06:00:00.000Z",
    ...overrides,
  };
  await db.visits.add(visit);
  return visit;
}

describe("completeVisitWithInvoice", () => {
  it("creates one invoice with the correct total, in the same transaction as the visit update", async () => {
    await seedDatabase(db);
    const arrivedVisit = findByPosition(await db.visits.toArray(), 2);
    await markVisitInRoom(db, arrivedVisit.id);
    const service = await db.services.get(arrivedVisit.service_id!);
    if (!service) throw new Error("seeded visit has no matching service");

    const result = await completeVisitWithInvoice(db, arrivedVisit.id);

    const updatedVisit = await db.visits.get(arrivedVisit.id);
    expect(updatedVisit?.status).toBe(VisitStatus.Completed);
    expect(updatedVisit?.ended_at).not.toBeNull();

    expect(await db.invoices.count()).toBe(1);
    const invoice = await db.invoices.get(result.invoice.id);
    expect(invoice?.visit_id).toBe(arrivedVisit.id);
    expect(invoice?.total).toBe(service.default_price);
    expect(invoice?.paid).toBe(0);
    expect(invoice?.status).toBe(InvoiceStatus.Unpaid);
    expect(invoice?.number).toBe(1);

    const items = await db.invoice_items.where("invoice_id").equals(invoice!.id).toArray();
    expect(items).toHaveLength(1);
    expect(items[0].unit_price).toBe(service.default_price);
    expect(items[0].total).toBe(service.default_price);
    expect(items[0].qty).toBe(1);

    expect(result.invoiceItemAuditLogId).not.toBeNull();
  });

  it("rolls back the visit update too when a later write in the same transaction fails", async () => {
    await seedDatabase(db);
    const arrivedVisit = findByPosition(await db.visits.toArray(), 2);
    await markVisitInRoom(db, arrivedVisit.id);
    const beforeCompletion = await db.visits.get(arrivedVisit.id);

    // Dexie's "creating" hook runs inside the write itself, unlike
    // reassigning table.add (which a Table's internal method dispatch does
    // not actually consult) — the correct way to force a write mid-transaction
    // to fail so the whole transaction's rollback can be observed.
    function throwOnCreate(): void {
      throw new Error("simulated failure");
    }
    db.invoice_items.hook("creating", throwOnCreate);

    await expect(completeVisitWithInvoice(db, arrivedVisit.id)).rejects.toThrow("simulated failure");

    db.invoice_items.hook("creating").unsubscribe(throwOnCreate);

    const unchangedVisit = await db.visits.get(arrivedVisit.id);
    expect(unchangedVisit).toEqual(beforeCompletion);
    expect(await db.invoices.count()).toBe(0);
    expect(await db.invoice_items.count()).toBe(0);
  });

  it("creates an invoice with zero total and status paid when the visit has no service_id", async () => {
    await seedDatabase(db);
    const visit = await makeInRoomVisit({ service_id: null });

    const result = await completeVisitWithInvoice(db, visit.id);

    expect(result.invoice.total).toBe(0);
    expect(result.invoice.status).toBe(InvoiceStatus.Paid);
    expect(result.invoiceItemAuditLogId).toBeNull();
    expect(await db.invoice_items.count()).toBe(0);
  });

  it("respects a service_price_override for this practitioner and location over the service's default_price", async () => {
    await seedDatabase(db);
    const [service] = await db.services.toArray();
    const [practitioner] = await db.practitioners.toArray();
    const [location] = await db.locations.toArray();
    await db.service_price_overrides.add({
      id: id(),
      service_id: service.id,
      practitioner_id: practitioner.id,
      location_id: location.id,
      price: 99900 as Piastres,
    });
    const visit = await makeInRoomVisit();

    const result = await completeVisitWithInvoice(db, visit.id);

    expect(result.invoice.total).toBe(99900);
  });

  it("rejects completing a visit that is not in_room, writing nothing", async () => {
    await seedDatabase(db);
    const bookedVisit = findByPosition(await db.visits.toArray(), 1);

    await expect(completeVisitWithInvoice(db, bookedVisit.id)).rejects.toThrow(/invalid_transition/);
    expect(await db.invoices.count()).toBe(0);
  });

  it("assigns invoice numbers sequentially per location per year without gaps or duplicates under concurrent completion", async () => {
    await seedDatabase(db);
    const visitA = await makeInRoomVisit();
    const visitB = await makeInRoomVisit();

    const [resultA, resultB] = await Promise.all([
      completeVisitWithInvoice(db, visitA.id),
      completeVisitWithInvoice(db, visitB.id),
    ]);

    const numbers = [resultA.invoice.number, resultB.invoice.number].sort();
    expect(numbers).toEqual([1, 2]);
    expect(resultA.invoice.issued_year).toBe(resultB.invoice.issued_year);
    expect(await db.invoices.count()).toBe(2);
  });

  it("keeps invoice numbers independent per location", async () => {
    await seedDatabase(db);
    // Captured before adding the second location: IndexedDB iterates a
    // plain-primary-key store in key order, not insertion order, so a fresh
    // random UUID for "Second branch" could otherwise sort before the
    // seed's own location and make makeInRoomVisit()'s no-override default
    // silently resolve to the wrong one.
    const originalLocationId = (await db.locations.toArray())[0].id;
    const otherLocationId = id();
    await db.locations.add({
      id: otherLocationId,
      org_id: (await db.locations.toArray())[0].org_id,
      name: "Second branch",
      address: "",
      phone: "",
      is_active: true,
    });

    const visitAtFirstLocation = await makeInRoomVisit({ location_id: originalLocationId });
    const visitAtSecondLocation = await makeInRoomVisit({ location_id: otherLocationId });

    const resultFirst = await completeVisitWithInvoice(db, visitAtFirstLocation.id);
    const resultSecond = await completeVisitWithInvoice(db, visitAtSecondLocation.id);

    expect(resultFirst.invoice.number).toBe(1);
    expect(resultSecond.invoice.number).toBe(1);
  });

  // started_at is set to a controlled offset in the past, then completed
  // immediately, so ended_at - started_at lands within rounding distance of
  // the intended duration without depending on real elapsed test time.
  async function completeWithDurationMinutes(minutes: number) {
    const visit = await makeInRoomVisit({ started_at: new Date(Date.now() - minutes * 60_000).toISOString() });
    return completeVisitWithInvoice(db, visit.id);
  }

  it("updates day_state.avg_consult_minutes atomically with the visit that completes it", async () => {
    await seedDatabase(db);
    const [practitioner] = await db.practitioners.toArray();
    const [location] = await db.locations.toArray();
    // The seed already includes one completed visit for this exact
    // practitioner+location+date; removed so this test's own controlled
    // duration is the only one the median sees.
    const seededCompleted = findByPosition(await db.visits.toArray(), 3);
    await db.visits.delete(seededCompleted.id);

    const result = await completeWithDurationMinutes(10);

    const dayState = await db.day_state
      .where("[practitioner_id+location_id+date]")
      .equals([practitioner.id, location.id, "2026-09-07"])
      .first();
    expect(dayState?.avg_consult_minutes).toBe(10);
    expect(result.dayStateAuditLogId).toBeTruthy();
  });

  it("computes the median across multiple completed visits, not the mean", async () => {
    await seedDatabase(db);
    const [practitioner] = await db.practitioners.toArray();
    const [location] = await db.locations.toArray();
    const seededCompleted = findByPosition(await db.visits.toArray(), 3);
    await db.visits.delete(seededCompleted.id);

    // Durations 10, 12 and a 200-minute outlier: median is 12; a mean would
    // be dragged far higher by the outlier.
    await completeWithDurationMinutes(10);
    await completeWithDurationMinutes(12);
    await completeWithDurationMinutes(200);

    const dayState = await db.day_state
      .where("[practitioner_id+location_id+date]")
      .equals([practitioner.id, location.id, "2026-09-07"])
      .first();
    expect(dayState?.avg_consult_minutes).toBe(12);
  });
});
