import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Visit } from "./types";

/**
 * Sets the doctor's quick note on a visit (visits.note), through mutate() —
 * audited and queued for sync like every other visit write. The note is
 * trimmed, and an empty or whitespace-only note is stored as null, so
 * "no note" has exactly one representation.
 *
 * Throws "visit_not_found" when visitId names no visit, the same way the
 * other visit writers do (db/visitAttendance.ts). When the normalised note
 * equals the one already stored, writes nothing at all — no audit row, no
 * sync op — and returns null; otherwise returns the audit_log id of the
 * write. The read and the write share one transaction, so the no-op check
 * is never made against a value another write has since replaced.
 */
export async function setVisitNote(db: ClintraDatabase, visitId: string, note: string | null): Promise<string | null> {
  const normalised = note === null ? null : note.trim() === "" ? null : note.trim();
  const actor = await resolveActingMembership(db);

  return db.transaction("rw", db.visits, db.audit_log, db.sync_ops, async () => {
    const before = await db.visits.get(visitId);
    if (!before) {
      throw new Error("visit_not_found");
    }
    if (before.note === normalised) {
      return null;
    }

    const after: Visit = { ...before, note: normalised };
    return mutate(db, {
      table: db.visits,
      entity: "visits",
      entityId: visitId,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: actor.id,
      orgId: before.org_id,
    });
  });
}
