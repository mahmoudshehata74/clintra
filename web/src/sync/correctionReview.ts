import type { ClintraDatabase } from "../db/database";
import { AuditAction, type SyncOp, type VisitFormData } from "../db/types";

/**
 * The reasons a clinical correction, or a late write of a completed visit's
 * form, comes back with (api's SyncOpApplier correction rule,
 * docs/design-clinical-corrections.md section 7).
 */
export const CorrectionReason = {
  /** A form write on a completed visit that came without its correction (a late autosave from another device's offline edit). */
  Required: "correction_required",
  NotAllowed: "correction_not_allowed",
  Invalid: "correction_invalid",
  RevisionImmutable: "revision_immutable",
} as const;

/**
 * A late autosave of a form whose visit another device completed meanwhile,
 * refused `correction_required`: the server keeps its version, and this
 * device must too, or its next correction would describe text the server
 * never had. In the caller's transaction (which covers visit_form_data,
 * audit_log and sync_ops):
 *
 * - the refused op and every other unsent op of the row leave the queue —
 *   each would be refused the same way, and the row's latest text is what
 *   the review keeps — so "تمام" closes the review without anything going
 *   up again;
 * - the row goes back to what the server holds: removed when this device
 *   created it, else the pre-image of this device's first write on the
 *   refused op's base_rev (the oldest local audit row of the row whose
 *   before carries that rev).
 *
 * Resolves to the review's payload: the row's latest local text, so nothing
 * typed is lost.
 */
export async function settleRefusedLateEdit(db: ClintraDatabase, op: SyncOp): Promise<unknown> {
  const local = await db.visit_form_data.get(op.entity_id);
  const unsentOfRow = (await db.sync_ops.toArray()).filter(
    (candidate) => candidate.entity === op.entity && candidate.entity_id === op.entity_id && candidate.synced_at === null,
  );
  await db.sync_ops.bulkDelete(unsentOfRow.map((candidate) => candidate.op_id));

  if (op.action === AuditAction.Create) {
    await db.visit_form_data.delete(op.entity_id);
    return local ?? op.payload;
  }

  const firstWrite = (await db.audit_log.orderBy("seq").toArray()).find(
    (row) =>
      row.entity === op.entity &&
      row.entity_id === op.entity_id &&
      (row.before as { rev?: number } | null)?.rev === op.base_rev,
  );
  if (firstWrite?.before) {
    await db.visit_form_data.put(firstWrite.before as VisitFormData);
  }
  return local ?? op.payload;
}
