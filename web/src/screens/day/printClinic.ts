import type { Location, Organization } from "../../db/types";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";

export interface PrintClinicLines {
  /** `.print-clinic`'s title — the organization's own name. */
  title: string | null;
  /**
   * The line below it, in order: location name, address, phone — each
   * omitted when empty, joined with " · " by PrintClinicBlock. The phone is
   * last and already in the local display format; it is kept as its own
   * part so the block can isolate it as a left-to-right run.
   */
  details: string[];
  /** The local-format phone, when present — always details' last entry. */
  phone: string | null;
}

function nonEmpty(value: string | null | undefined): value is string {
  return value != null && value.trim() !== "";
}

/**
 * What every printed page's clinic block shows (day sheet, invoice,
 * receipt): "{organization}" over "{location} · {address} · {phone}". The
 * phone goes through the same local display format the rest of the app
 * uses, never the stored E.164 form.
 */
export function printClinicLines(
  organization: Pick<Organization, "name"> | undefined,
  location: Pick<Location, "name" | "address" | "phone"> | undefined,
): PrintClinicLines {
  const title = nonEmpty(organization?.name) ? organization.name.trim() : null;
  const phone = nonEmpty(location?.phone) ? formatEgyptianPhoneForDisplay(location.phone.trim()) : null;
  const details = [location?.name, location?.address].filter(nonEmpty).map((part) => part.trim());
  return { title, details: phone ? [...details, phone] : details, phone };
}
