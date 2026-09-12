import { describe, expect, it } from "vitest";
import type { Piastres } from "./money";
import { resolveServicePrice } from "./pricing";
import type { Service, ServicePriceOverride } from "../db/types";

const SERVICE: Service = {
  id: "service-1",
  org_id: "org-1",
  name: "General checkup",
  duration_minutes: 30,
  default_price: 20000 as Piastres,
  is_active: true,
  rev: 1,
};

const CONTEXT = { practitionerId: "practitioner-1", locationId: "location-1" };

function override(overrides: Partial<ServicePriceOverride> = {}): ServicePriceOverride {
  return {
    id: "override-1",
    service_id: SERVICE.id,
    practitioner_id: null,
    location_id: null,
    price: 15000 as Piastres,
    rev: 1,
    ...overrides,
  };
}

describe("resolveServicePrice", () => {
  it("falls back to the service's default_price when there are no overrides", () => {
    expect(resolveServicePrice(SERVICE, [], CONTEXT)).toBe(20000);
  });

  it("ignores an override for a different service", () => {
    const overrides = [override({ service_id: "other-service", practitioner_id: CONTEXT.practitionerId, location_id: CONTEXT.locationId })];
    expect(resolveServicePrice(SERVICE, overrides, CONTEXT)).toBe(20000);
  });

  it("uses a location-only override when nothing more specific matches", () => {
    const overrides = [override({ location_id: CONTEXT.locationId, price: 18000 as Piastres })];
    expect(resolveServicePrice(SERVICE, overrides, CONTEXT)).toBe(18000);
  });

  it("uses a practitioner-only override when nothing more specific matches", () => {
    const overrides = [override({ practitioner_id: CONTEXT.practitionerId, price: 17000 as Piastres })];
    expect(resolveServicePrice(SERVICE, overrides, CONTEXT)).toBe(17000);
  });

  it("prefers a practitioner-only override over a location-only override", () => {
    const overrides = [
      override({ location_id: CONTEXT.locationId, price: 18000 as Piastres }),
      override({ practitioner_id: CONTEXT.practitionerId, price: 17000 as Piastres }),
    ];
    expect(resolveServicePrice(SERVICE, overrides, CONTEXT)).toBe(17000);
  });

  it("prefers a both-specific override over either single-field override", () => {
    const overrides = [
      override({ location_id: CONTEXT.locationId, price: 18000 as Piastres }),
      override({ practitioner_id: CONTEXT.practitionerId, price: 17000 as Piastres }),
      override({ practitioner_id: CONTEXT.practitionerId, location_id: CONTEXT.locationId, price: 16000 as Piastres }),
    ];
    expect(resolveServicePrice(SERVICE, overrides, CONTEXT)).toBe(16000);
  });

  it("does not match an override for a different practitioner or location", () => {
    const overrides = [
      override({ practitioner_id: "other-practitioner", price: 17000 as Piastres }),
      override({ location_id: "other-location", price: 18000 as Piastres }),
    ];
    expect(resolveServicePrice(SERVICE, overrides, CONTEXT)).toBe(20000);
  });

  it("does not treat an override naming neither practitioner nor location as a match", () => {
    const overrides = [override({ practitioner_id: null, location_id: null, price: 12000 as Piastres })];
    expect(resolveServicePrice(SERVICE, overrides, CONTEXT)).toBe(20000);
  });
});
