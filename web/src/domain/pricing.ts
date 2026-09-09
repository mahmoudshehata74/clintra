import type { Service, ServicePriceOverride } from "../db/types";
import type { Piastres } from "./money";

export interface PriceResolutionContext {
  practitionerId: string;
  locationId: string;
}

/**
 * Resolves what a service actually costs for a given practitioner at a given
 * location: the most specific service_price_overrides row wins over a less
 * specific one, which wins over the service's own default_price. "Most
 * specific" means an override naming both practitioner and location beats
 * one naming only the practitioner, which beats one naming only the
 * location — an override naming neither would apply to every practitioner at
 * every location, which is never more specific than one naming either, so it
 * is treated the same as no match at all (falls through to default_price).
 */
export function resolveServicePrice(
  service: Service,
  overrides: readonly ServicePriceOverride[],
  context: PriceResolutionContext,
): Piastres {
  const forThisService = overrides.filter((override) => override.service_id === service.id);

  const both = forThisService.find(
    (override) => override.practitioner_id === context.practitionerId && override.location_id === context.locationId,
  );
  if (both) {
    return both.price;
  }

  const practitionerOnly = forThisService.find(
    (override) => override.practitioner_id === context.practitionerId && override.location_id === null,
  );
  if (practitionerOnly) {
    return practitionerOnly.price;
  }

  const locationOnly = forThisService.find(
    (override) => override.practitioner_id === null && override.location_id === context.locationId,
  );
  if (locationOnly) {
    return locationOnly.price;
  }

  return service.default_price;
}
