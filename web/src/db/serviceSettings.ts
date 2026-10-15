import { id } from "../domain/id";
import type { Piastres } from "../domain/money";
import { checkServiceDetails, type ServiceDetails, type ServiceDetailsError } from "../domain/serviceDetails";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Service, type ServicePriceOverride } from "./types";

export interface NewServiceInput {
  orgId: string;
  name: string;
  durationMinutes: number;
  defaultPrice: Piastres;
}

/** Creates a service (active by default), attributed to the acting owner. */
export async function createService(
  db: ClintraDatabase,
  input: NewServiceInput,
): Promise<{ service: Service; auditLogId: string }> {
  const actor = await resolveActingMembership(db);
  const service: Service = {
    id: id(),
    org_id: input.orgId,
    name: input.name,
    duration_minutes: input.durationMinutes,
    default_price: input.defaultPrice,
    is_active: true,
    rev: 1,
  };
  const auditLogId = await mutate(db, {
    table: db.services,
    entity: "services",
    entityId: service.id,
    action: AuditAction.Create,
    before: null,
    after: service,
    actorMembershipId: actor.id,
    orgId: input.orgId,
  });
  return { service, auditLogId };
}

export interface ServicePatch {
  name?: string;
  durationMinutes?: number;
  defaultPrice?: Piastres;
  isActive?: boolean;
}

/**
 * Edits a service in place. Deactivating (isActive: false) is deliberately a
 * plain field update: past visits and invoices keep their own service_id and
 * their invoice_items keep the name they were written with, so history is
 * untouched; only the booking sheet's picker (which filters to is_active) stops
 * offering it.
 */
export async function updateService(db: ClintraDatabase, serviceId: string, patch: ServicePatch): Promise<void> {
  const actor = await resolveActingMembership(db);
  const before = await db.services.get(serviceId);
  if (!before) {
    throw new Error("service_not_found");
  }
  const after: Service = {
    ...before,
    name: patch.name ?? before.name,
    duration_minutes: patch.durationMinutes ?? before.duration_minutes,
    default_price: patch.defaultPrice ?? before.default_price,
    is_active: patch.isActive ?? before.is_active,
  };
  await mutate(db, {
    table: db.services,
    entity: "services",
    entityId: serviceId,
    action: AuditAction.Update,
    before,
    after,
    actorMembershipId: actor.id,
    orgId: before.org_id,
  });
}

export interface NewOverrideInput {
  serviceId: string;
  /** Exactly one of practitionerId / locationId must be set. */
  practitionerId: string | null;
  locationId: string | null;
  price: Piastres;
}

export type OverrideResult = { ok: true; override: ServicePriceOverride } | { ok: false; reason: "target_required" };

/**
 * Adds a service_price_override scoped to exactly one of a practitioner or a
 * location — never both (that is a more specific override this UI does not
 * offer) and never neither (that would just shadow the default). See
 * domain/pricing.ts for how specificity is resolved at read time.
 */
export async function addServicePriceOverride(db: ClintraDatabase, input: NewOverrideInput): Promise<OverrideResult> {
  if ((input.practitionerId === null) === (input.locationId === null)) {
    return { ok: false, reason: "target_required" };
  }
  const actor = await resolveActingMembership(db);
  const override: ServicePriceOverride = {
    id: id(),
    service_id: input.serviceId,
    practitioner_id: input.practitionerId,
    location_id: input.locationId,
    price: input.price,
    rev: 1,
  };
  await mutate(db, {
    table: db.service_price_overrides,
    entity: "service_price_overrides",
    entityId: override.id,
    action: AuditAction.Create,
    before: null,
    after: override,
    actorMembershipId: actor.id,
    orgId: actor.org_id,
  });
  return { ok: true, override };
}

/** Changes an override's price. */
export async function updateServicePriceOverride(
  db: ClintraDatabase,
  overrideId: string,
  price: Piastres,
): Promise<void> {
  const actor = await resolveActingMembership(db);
  const before = await db.service_price_overrides.get(overrideId);
  if (!before) {
    throw new Error("override_not_found");
  }
  const after: ServicePriceOverride = { ...before, price };
  await mutate(db, {
    table: db.service_price_overrides,
    entity: "service_price_overrides",
    entityId: overrideId,
    action: AuditAction.Update,
    before,
    after,
    actorMembershipId: actor.id,
    orgId: actor.org_id,
  });
}

/** Removes an override, so the service falls back to a less specific price or its default. */
export async function deleteServicePriceOverride(db: ClintraDatabase, overrideId: string): Promise<void> {
  const actor = await resolveActingMembership(db);
  const before = await db.service_price_overrides.get(overrideId);
  if (!before) {
    return;
  }
  await mutate(db, {
    table: db.service_price_overrides,
    entity: "service_price_overrides",
    entityId: overrideId,
    action: AuditAction.Delete,
    before,
    after: null,
    actorMembershipId: actor.id,
    orgId: actor.org_id,
  });
}

export type SaveServiceDetailsResult = { ok: true; service: Service } | { ok: false; reason: ServiceDetailsError };

/**
 * The service form's save, for a new service (`serviceId` null) and for an
 * edit: checks the details as the form does (checkServiceDetails — the name
 * unique among the organization's other services, case and spaces ignored;
 * 5–480 minutes in steps of 5; a price of zero or more), then creates the
 * service ("أضاف خدمة") or updates its name, duration and price ("عدّل
 * خدمة"). An edit that changes nothing writes nothing. The audit line names
 * the service and never shows its price.
 */
export async function saveServiceDetails(
  db: ClintraDatabase,
  input: { serviceId: string | null; orgId: string; details: ServiceDetails },
): Promise<SaveServiceDetailsResult> {
  const services = (await db.services.toArray()).filter(
    (service) => service.org_id === input.orgId && service.id !== input.serviceId,
  );
  const details = { ...input.details, name: input.details.name.trim() };
  const refusal = checkServiceDetails(details, services);
  if (refusal !== null) {
    return { ok: false, reason: refusal };
  }

  if (input.serviceId === null) {
    const { service } = await createService(db, {
      orgId: input.orgId,
      name: details.name,
      durationMinutes: details.durationMinutes,
      defaultPrice: details.defaultPrice,
    });
    return { ok: true, service };
  }

  const before = await db.services.get(input.serviceId);
  if (!before) {
    throw new Error("service_not_found");
  }
  if (
    before.name === details.name &&
    before.duration_minutes === details.durationMinutes &&
    before.default_price === details.defaultPrice
  ) {
    return { ok: true, service: before };
  }
  await updateService(db, input.serviceId, {
    name: details.name,
    durationMinutes: details.durationMinutes,
    defaultPrice: details.defaultPrice,
  });
  const after = await db.services.get(input.serviceId);
  return { ok: true, service: after ?? before };
}
