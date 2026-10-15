import { beforeEach, describe, expect, it } from "vitest";
import type { Piastres } from "../domain/money";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import {
  addServicePriceOverride,
  createService,
  deleteServicePriceOverride,
  saveServiceDetails,
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

describe("saveServiceDetails", () => {
  async function orgAndServices() {
    await seedDatabase(db);
    const [org] = await db.organizations.toArray();
    const services = await db.services.toArray();
    return { orgId: org.id, services };
  }

  it("edits a service's name, duration and price, audited and queued; an unchanged save writes nothing", async () => {
    const { orgId, services } = await orgAndServices();
    const [service] = services;
    const auditBefore = await db.audit_log.count();

    const result = await saveServiceDetails(db, {
      serviceId: service.id,
      orgId,
      details: { name: "  كشف مفصل ", durationMinutes: 45, defaultPrice: 400_00 as Piastres },
    });
    expect(result.ok).toBe(true);
    expect(await db.services.get(service.id)).toMatchObject({
      name: "كشف مفصل",
      duration_minutes: 45,
      default_price: 400_00,
      is_active: service.is_active,
    });
    expect(await db.audit_log.count()).toBe(auditBefore + 1);
    const ops = (await db.sync_ops.toArray()).filter((op) => op.entity === "services" && op.entity_id === service.id);
    expect(ops.map((op) => op.action)).toEqual(["update"]);

    await saveServiceDetails(db, {
      serviceId: service.id,
      orgId,
      details: { name: "كشف مفصل", durationMinutes: 45, defaultPrice: 400_00 as Piastres },
    });
    expect(await db.audit_log.count()).toBe(auditBefore + 1);
  });

  it("keeps its own name on an edit, and refuses another service's name, case and spaces ignored", async () => {
    const { orgId, services } = await orgAndServices();
    const [first, second] = services;

    expect(
      (await saveServiceDetails(db, {
        serviceId: first.id,
        orgId,
        details: { name: first.name, durationMinutes: 30, defaultPrice: first.default_price },
      })).ok,
    ).toBe(true);
    expect(
      await saveServiceDetails(db, {
        serviceId: first.id,
        orgId,
        details: { name: ` ${second.name.replace(" ", "  ")} `, durationMinutes: 30, defaultPrice: first.default_price },
      }),
    ).toEqual({ ok: false, reason: "name_taken" });
    expect((await db.services.get(first.id))?.name).toBe(first.name);
  });

  it("adds a new service, active, with the same checks", async () => {
    const { orgId, services } = await orgAndServices();

    expect(
      await saveServiceDetails(db, {
        serviceId: null,
        orgId,
        details: { name: services[0].name, durationMinutes: 30, defaultPrice: 100_00 as Piastres },
      }),
    ).toEqual({ ok: false, reason: "name_taken" });
    expect(
      await saveServiceDetails(db, {
        serviceId: null,
        orgId,
        details: { name: "أشعة", durationMinutes: 7, defaultPrice: 100_00 as Piastres },
      }),
    ).toEqual({ ok: false, reason: "duration_invalid" });

    const result = await saveServiceDetails(db, {
      serviceId: null,
      orgId,
      details: { name: "أشعة", durationMinutes: 20, defaultPrice: 0 as Piastres },
    });
    expect(result.ok).toBe(true);
    expect(await db.services.count()).toBe(services.length + 1);
    if (result.ok) {
      expect(await db.services.get(result.service.id)).toMatchObject({ name: "أشعة", duration_minutes: 20, default_price: 0, is_active: true });
    }
  });
});
