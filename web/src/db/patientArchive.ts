import { blocksArchiving, isArchived } from "../domain/patientArchive";
import { todayInCairo } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations } from "./mutate";
import { AuditAction } from "./types";

export type PatientArchiveResult =
  | { ok: true; auditLogId: string }
  | { ok: false; reason: "patient_not_found" | "already_archived" | "not_archived" | "upcoming_visit" };

/**
 * Archives a patient: archived_at set to now, through the ordinary audited,
 * synced write. Refused while any of the patient's visits is still to come
 * (domain/patientArchive.ts's blocksArchiving), read in the same
 * transaction as the write. Any role may archive. Nothing else about the
 * patient changes: their visits, invoices and audit rows stay, and
 * PatientProfile still opens them; only the searches leave them out
 * (db/patientSearch.ts).
 */
export async function archivePatient(db: ClintraDatabase, patientId: string, now = new Date()): Promise<PatientArchiveResult> {
  const actor = await resolveActingMembership(db);
  return runAtomicMutations(db, [db.patients, db.visits], async (write) => {
    const before = await db.patients.get(patientId);
    if (!before) {
      return { ok: false, reason: "patient_not_found" };
    }
    if (isArchived(before)) {
      return { ok: false, reason: "already_archived" };
    }
    const visits = await db.visits.filter((visit) => visit.patient_id === patientId).toArray();
    if (blocksArchiving(visits, todayInCairo(now))) {
      return { ok: false, reason: "upcoming_visit" };
    }
    const auditLogId = await write({
      table: db.patients,
      entity: "patients",
      entityId: patientId,
      action: AuditAction.Update,
      before,
      after: { ...before, archived_at: now.toISOString() },
      actorMembershipId: actor.id,
      orgId: before.org_id,
    });
    return { ok: true, auditLogId };
  });
}

/** Brings an archived patient back: archived_at null again, audited and synced like the archive. Any role may restore. */
export async function restorePatient(db: ClintraDatabase, patientId: string): Promise<PatientArchiveResult> {
  const actor = await resolveActingMembership(db);
  return runAtomicMutations(db, [db.patients], async (write) => {
    const before = await db.patients.get(patientId);
    if (!before) {
      return { ok: false, reason: "patient_not_found" };
    }
    if (!isArchived(before)) {
      return { ok: false, reason: "not_archived" };
    }
    const auditLogId = await write({
      table: db.patients,
      entity: "patients",
      entityId: patientId,
      action: AuditAction.Update,
      before,
      after: { ...before, archived_at: null },
      actorMembershipId: actor.id,
      orgId: before.org_id,
    });
    return { ok: true, auditLogId };
  });
}
