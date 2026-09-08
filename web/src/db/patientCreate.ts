import { id } from "../domain/id";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Patient } from "./types";

export interface CreatePatientInput {
  orgId: string;
  /** Already trimmed and non-empty; validated by the caller (see newPatientForm.ts). */
  fullName: string;
  /** Already normalised E.164, or null when no phone was given. */
  phone: string | null;
}

export interface CreatePatientResult {
  patient: Patient;
  auditLogId: string;
}

/**
 * Creates a patient with only the fields the booking sheet's new-patient form
 * collects — no gender, birth year or note, which stay optional and are left
 * for a patient screen that does not exist yet. Written through mutate() like
 * every other write, returning the audit_log id so a caller booking a visit
 * for this patient in the same flow can bundle it into a two-step undo (see
 * undoMostRecentPatientMutation in mutate.ts).
 *
 * Per the specification, patients have no uniqueness constraint on full_name
 * (same-name patients are told apart by last-visit date) or on phone. This
 * function does not invent one: two patients with the same phone in the same
 * org can both be created. See docs/schema.md and the task history for this
 * being called out explicitly rather than silently assumed.
 */
export async function createPatient(
  db: ClintraDatabase,
  input: CreatePatientInput,
): Promise<CreatePatientResult> {
  const actor = await resolveActingMembership(db);
  const patient: Patient = {
    id: id(),
    org_id: input.orgId,
    full_name: input.fullName,
    phone: input.phone,
    gender: null,
    birth_year: null,
    note: null,
    created_at: new Date().toISOString(),
  };

  const auditLogId = await mutate(db, {
    table: db.patients,
    entity: "patients",
    entityId: patient.id,
    action: AuditAction.Create,
    before: null,
    after: patient,
    actorMembershipId: actor.id,
    orgId: input.orgId,
  });

  return { patient, auditLogId };
}
