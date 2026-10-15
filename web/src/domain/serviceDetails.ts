import { parsePoundsToPiastres, type Piastres } from "./money";

/** A service's duration in minutes: 5 to 480, in steps of 5. */
export const SERVICE_DURATION_MINUTES = { min: 5, max: 480, step: 5 } as const;

export type ServiceDetailsField = "name" | "duration" | "price";

export type ServiceDetailsError = "name_required" | "name_taken" | "duration_invalid" | "price_invalid";

export interface ServiceDetails {
  /** Trimmed; inner spacing kept as typed. */
  name: string;
  durationMinutes: number;
  defaultPrice: Piastres;
}

/** The field each refusal belongs under on the service form. */
export const SERVICE_DETAILS_ERROR_FIELD: Record<ServiceDetailsError, ServiceDetailsField> = {
  name_required: "name",
  name_taken: "name",
  duration_invalid: "duration",
  price_invalid: "price",
};

/** What two service names are compared by: case and runs of spaces ignored. */
export function serviceNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isValidServiceDuration(minutes: number): boolean {
  const { min, max, step } = SERVICE_DURATION_MINUTES;
  return Number.isInteger(minutes) && minutes >= min && minutes <= max && minutes % step === 0;
}

/**
 * The checks every service create and edit passes, on the form and in the
 * writer alike: a name, not used by another of the organization's services
 * (serviceNameKey), a duration of 5–480 minutes in steps of 5, and a price
 * of zero or more. `others` are the organization's other services — the one
 * being edited left out.
 */
export function checkServiceDetails(
  details: ServiceDetails,
  others: readonly { name: string }[],
): ServiceDetailsError | null {
  const key = serviceNameKey(details.name);
  if (key === "") {
    return "name_required";
  }
  if (others.some((other) => serviceNameKey(other.name) === key)) {
    return "name_taken";
  }
  if (!isValidServiceDuration(details.durationMinutes)) {
    return "duration_invalid";
  }
  if (!Number.isInteger(details.defaultPrice) || details.defaultPrice < 0) {
    return "price_invalid";
  }
  return null;
}

/**
 * The service form's three text inputs, read and checked: the details to
 * save, or the first refusal (name, then duration, then price). The price is
 * typed in pounds ("150", "150.50").
 */
export function parseServiceForm(
  input: { name: string; duration: string; price: string },
  others: readonly { name: string }[],
): { ok: true; details: ServiceDetails } | { ok: false; error: ServiceDetailsError } {
  const name = input.name.trim();
  const durationText = input.duration.trim();
  const durationMinutes = /^\d+$/.test(durationText) ? Number(durationText) : Number.NaN;
  const price = parsePoundsToPiastres(input.price);
  const nameError = checkServiceDetails({ name, durationMinutes: SERVICE_DURATION_MINUTES.min, defaultPrice: 0 as Piastres }, others);
  if (nameError !== null) {
    return { ok: false, error: nameError };
  }
  if (!isValidServiceDuration(durationMinutes)) {
    return { ok: false, error: "duration_invalid" };
  }
  if (!price.ok) {
    return { ok: false, error: "price_invalid" };
  }
  return { ok: true, details: { name, durationMinutes, defaultPrice: price.value } };
}

/** A price in piastres as the form's pounds input shows it: "150", "99.50". */
export function formatPriceForInput(price: Piastres): string {
  return price % 100 === 0 ? String(price / 100) : (price / 100).toFixed(2);
}
