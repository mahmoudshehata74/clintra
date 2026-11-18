import type { ClinicDay } from "./time";
import { VisitStatus } from "./visitStatus";

/** A visit still to come: booked or confirmed, or the patient already at the clinic. */
const UPCOMING_STATUSES = new Set<string>([VisitStatus.Booked, VisitStatus.Confirmed, VisitStatus.Arrived, VisitStatus.InRoom]);

/**
 * Whether a patient with these visits can be archived on `today` (a Cairo
 * day): not while any of them is still to come — booked or confirmed for
 * today or later, or the patient arrived or in the room today. A past
 * visit left booked (never marked) does not count: it is history, not a
 * booking.
 */
export function blocksArchiving(visits: readonly { status: string; visit_date: ClinicDay }[], today: ClinicDay): boolean {
  return visits.some((visit) => UPCOMING_STATUSES.has(visit.status) && visit.visit_date >= today);
}

/** Whether a patient row is archived; a row from before archiving existed (no field) is not. */
export function isArchived(patient: { archived_at?: string | null }): boolean {
  return (patient.archived_at ?? null) !== null;
}
