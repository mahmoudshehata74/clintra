import { Role } from "./role";

/** The part of a membership that decides whether it reads a patient's clinical text. */
export interface ClinicalReader {
  role: Role;
  practitioner_id: string | null;
}

/**
 * Whether the signed-in staff member reads a patient's clinical text: the
 * complaint, the diagnosis, the visit form's fields, prescription items and
 * the doctor's quick note. The owner and doctors do; an assistant or a
 * manager (the front desk) sees each event with its date, doctor and status
 * only. A membership tied to a practitioner is that doctor's own, whatever
 * its role. Nobody signed in (undefined) reads nothing.
 *
 * Presentation only: every row stays on the device and in sync — this
 * decides what a screen shows, not what the device holds
 * (docs/session-handoff.md).
 */
export function readsClinicalText(membership: ClinicalReader | undefined): boolean {
  if (!membership) {
    return false;
  }
  return membership.role === Role.Owner || membership.role === Role.Practitioner || membership.practitioner_id !== null;
}
