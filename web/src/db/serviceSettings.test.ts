import { beforeEach, describe, expect, it } from "vitest";
import type { Piastres } from "../domain/money";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import {
  addServicePriceOverride,
  createService,
  deleteServicePriceOverride,
  updateService,
} from "./serviceSettings";
import { markVisitInRoom } from "./visitAttendance";
import { completeVisitWithInvoice } from "./visitCompletion";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-service-settings-test-${crypto.randomUUID()}`);
});

function findByPosition<T extends { position: number }>(rows: readonly T[], position: number): T {
  const row = rows.find((r) => r.position === position);
  if (!row) throw new Error(`no row at position ${position}`);
  return row;
}

describe("createService / updateService", () => {
  it("creates an active service through the audited pipeline", async () => {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();

    const { service, auditLogId } = await createService(db, {
      orgId: org.id,
      name: "أشعة",
      durationMinutes: 20,
      defaultPrice: 250_00 as Piastres,
    });

    const stored = await db.services.get(service.id);
    expect(stored).toMatchObject({ name: "أشعة", duration_minutes: 20, is_active: true });
    const auditRow = await db.audit_log.get(auditLogId);
    expect(auditRow).toMatchObject({ entity: "services", action: "create" });
  });

  it("deactivating a service leaves a completed invoice's item name untouched", async () => {
    await seedDatabase(db);
    const arrived = findByPosition(await db.visits.toArray(), 2);
    const serviceId = arrived.service_id!;
    const serviceName = (await db.services.get(serviceId))!.name;

    await markVisitInRoom(db, arrived.id);
    const { invoice } = await completeVisitWithInvoice(db, arrived.id);
    const itemsBefore = await db.invoice_items.where("invoice_id").equals(invoice.id).toArray();
    expect(itemsBefore[0].description).toBe(serviceName);

    await updateService(db, serviceId, { isActive: false });

    expect((await db.services.get(serviceId))?.is_active).toBe(false);
    const itemsAfter = await db.invoice_items.where("invoice_id").equals(invoice.id).toArray();
    expect(itemsAfter[0].description).toBe(serviceName);
  });
});

describe("service price overrides", () => {
  it("requires exactly one of practitioner or location", async () => {
    await seedDatabase(db);
    const [service] = await db.services.toArray();
    const [practitioner] = await db.practitioners.toArray();
    const [location] = await db.locations.toArray();

    expect(
      await addServicePriceOverride(db, {
        serviceId: service.id,
        practitionerId: null,
        locationId: null,
        price: 100_00 as Piastres,
      }),
    ).toEqual({ ok: false, reason: "target_required" });

    expect(
      await addServicePriceOverride(db, {
        serviceId: service.id,
        practitionerId: practitioner.id,
        locationId: location.id,
        price: 100_00 as Piastres,
      }),
    ).toEqual({ ok: false, reason: "target_required" });

    const ok = await addServicePriceOverride(db, {
      serviceId: service.id,
      practitionerId: practitioner.id,
      locationId: null,
      price: 100_00 as Piastres,
    });
    expect(ok.ok).toBe(true);
    expect(await db.service_price_overrides.count()).toBe(1);
  });

  it("deletes an override", async () => {
    await seedDatabase(db);
    const [service] = await db.services.toArray();
    const [location] = await db.locations.toArray();
    const created = await addServicePriceOverride(db, {
      serviceId: service.id,
      practitionerId: null,
      locationId: location.id,
      price: 90_00 as Piastres,
    });
    if (!created.ok) throw new Error("expected override");

    await deleteServicePriceOverride(db, created.override.id);
    expect(await db.service_price_overrides.count()).toBe(0);
  });
});
