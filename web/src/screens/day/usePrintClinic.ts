import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { printClinicLines, type PrintClinicLines } from "./printClinic";

/** The clinic block for a printed page at one location: its organization's name, then the location's own details. */
export function usePrintClinic(locationId: string): PrintClinicLines {
  return (
    useLiveQuery<PrintClinicLines>(async () => {
      const location = await db.locations.get(locationId);
      const organization = location ? await db.organizations.get(location.org_id) : undefined;
      return printClinicLines(organization, location);
    }, [locationId]) ?? { title: null, details: [], phone: null }
  );
}
