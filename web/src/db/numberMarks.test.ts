import { beforeEach, describe, expect, it } from "vitest";
import { setActiveMembershipId } from "../auth/session";
import { id } from "../domain/id";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { formatReceiptNumber } from "../screens/day/invoiceNumber";
import { applyPulledRow, DISPLACED_BY_SERVER_REASON } from "../sync/pullCollisions";
import { describeSyncReview } from "../sync/reviewSummary";
import { ClintraDatabase } from "./database";
import { getDeviceBinding, numberMarkKey } from "./deviceRegistration";
import { mutate } from "./mutate";
import { recordPayment } from "./payments";
import { addPrescriptionItem } from "./prescriptions";
import { seedDatabase } from "./seed";
import { AuditAction, PaymentMethod, type Membership, type Visit } from "./types";
import { completeVisitWithInvoice } from "./visitCompletion";

const VISIT_DATE = "2026-09-20";

let db: ClintraDatabase;
let prescriber: Membership;

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-number-marks-test-${crypto.randomUUID()}`);
  await seedDatabase(db);
  const found = (await db.memberships.toArray()).find((membership) => membership.practitioner_id !== null);
  if (!found) throw new Error("seed did not produce a membership with a practitioner");
  prescriber = found;
  setActiveMembershipId(prescriber.id);
});

/** A visit in the room, created through mutate() so its create op is still queued — a row the server never accepted. */
async function createVisitLocally(): Promise<Visit> {
  const practitionerId = prescriber.practitioner_id!;
  const [location] = await db.locations.toArray();
  const [patient] = await db.patients.toArray();
  const [service] = await db.services.toArray();
  const sameDay = await db.visits.where("[practitioner_id+visit_date]").equals([practitionerId, VISIT_DATE]).toArray();
  const visit: Visit = {
    id: id(),
    org_id: prescriber.org_id,
    location_id: location.id,
    practitioner_id: practitionerId,
    patient_id: patient.id,
    service_id: service.id,
    care_plan_item_id: null,
    visit_date: VISIT_DATE,
    position: sameDay.reduce((max, candidate) => Math.max(max, candidate.position), 0) + 1,
    scheduled_at: null,
    status: VisitStatus.InRoom,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: prescriber.id,
    created_at: new Date().toISOString(),
    note: null,
    rev: 1,
  };
  await mutate(db, {
    table: db.visits,
    entity: "visits",
    entityId: visit.id,
    action: AuditAction.Create,
    before: null,
    after: visit,
    actorMembershipId: prescriber.id,
    orgId: prescriber.org_id,
  });
  return visit;
}

/** Another device's visit for the same queue place arrives by pull, displacing this one with everything under it. */
async function displaceByPull(visit: Visit): Promise<void> {
  await applyPulledRow(db, "visits", { ...visit, id: id(), created_by: "membership-other-device", rev: 1 });
  expect(await db.visits.get(visit.id)).toBeUndefined();
}

async function completeAndPay(visit: Visit) {
  const { invoice } = await completeVisitWithInvoice(db, visit.id);
  const paid = await recordPayment(db, { invoiceId: invoice.id, amount: invoice.total, method: PaymentMethod.Cash, note: null });
  if (!paid.ok) throw new Error(`payment refused: ${paid.reason}`);
  return { invoice, payment: paid.payment };
}

describe("numbers minted on this device stay reserved after their row is displaced", () => {
  it("invoice and receipt numbers continue past a displaced visit's invoice and payment, never repeat", async () => {
    const first = await completeAndPay(await createVisitLocally());
    const displacedVisit = await createVisitLocally();
    const displaced = await completeAndPay(displacedVisit);
    expect(displaced.invoice.number).toBe(first.invoice.number + 1);
    expect(Number(displaced.payment.receipt_number)).toBe(Number(first.payment.receipt_number) + 1);

    await displaceByPull(displacedVisit);
    expect(await db.invoices.get(displaced.invoice.id)).toBeUndefined();
    expect(await db.payments.get(displaced.payment.id)).toBeUndefined();

    const next = await completeAndPay(await createVisitLocally());
    expect(next.invoice.number).toBe(displaced.invoice.number + 1);
    expect(Number(next.payment.receipt_number)).toBe(Number(displaced.payment.receipt_number) + 1);

    // The displacement names the payment it took, so it can be re-entered.
    const [review] = (await db.sync_review.toArray()).filter((row) => row.reason === DISPLACED_BY_SERVER_REASON);
    expect(describeSyncReview(review)).toContain(formatReceiptNumber(displaced.payment));
  });

  it("a prescription number continues past a displaced visit's prescription, never repeats", async () => {
    const item = { name: "Paracetamol 500mg", instructions: "قرص عند الحاجة" };
    await addPrescriptionItem(db, (await createVisitLocally()).id, item);
    const displacedVisit = await createVisitLocally();
    await addPrescriptionItem(db, displacedVisit.id, item);
    const displacedNumber = (await db.prescriptions.where("visit_id").equals(displacedVisit.id).first())!.number;

    await displaceByPull(displacedVisit);
    expect(await db.prescriptions.where("visit_id").equals(displacedVisit.id).count()).toBe(0);

    const nextVisit = await createVisitLocally();
    await addPrescriptionItem(db, nextVisit.id, item);
    expect((await db.prescriptions.where("visit_id").equals(nextVisit.id).first())!.number).toBe(displacedNumber + 1);
  });

  it("records each series' mark on the device row in the minting transaction", async () => {
    const { invoice, payment } = await completeAndPay(await createVisitLocally());
    const device = await getDeviceBinding(db);
    expect(device.number_marks).toMatchObject({
      [numberMarkKey("invoice", invoice.location_id, invoice.series, invoice.issued_year)]: invoice.number,
      [numberMarkKey("receipt", payment.location_id, payment.series, null)]: Number(payment.receipt_number),
    });
  });
});
