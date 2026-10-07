import type { Piastres } from "../../domain/money";
import type { Service } from "../../db/types";

/**
 * The service a booking confirms against: the explicitly selected one if
 * it's still in the list, otherwise the first available service — so a
 * booking always has a service pre-selected without the assistant ever
 * having to tap the picker for the common case, and a stale selection
 * (e.g. a service that became inactive mid-flow) falls back cleanly rather
 * than confirming against nothing.
 */
export function resolveSelectedService(
  services: readonly Service[],
  selectedServiceId: string | null,
): Service | null {
  if (selectedServiceId) {
    const found = services.find((service) => service.id === selectedServiceId);
    if (found) {
      return found;
    }
  }
  return services[0] ?? null;
}

/**
 * The service picker's own price display (`.svc-row .svc`, e.g. "400"):
 * whole pounds, rounded to the nearest pound rather than truncated, with no
 * fraction shown at all — unlike domain/money.ts's formatPiastresForDisplay
 * or screens/money.ts's formatMoneyAmount, which both keep a piastres
 * remainder when one exists. The caller appends the currency suffix.
 */
export function formatServicePriceWholePounds(priceInPiastres: Piastres): string {
  const pounds = Math.round(priceInPiastres / 100);
  return pounds.toLocaleString("en-US");
}
