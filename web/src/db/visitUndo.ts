import { resolveActingMembership } from "./actingMembership";
import { refreshPlansAfterVisitUndo, sessionLinksToRestore, sessionLinkTables } from "./carePlans";
import type { ClintraDatabase } from "./database";
import { checkUndo, reversalOf, runAtomicMutations, type UndoOutcome } from "./mutate";
import { AuditAction } from "./types";

/**
 * The constrained undo mechanism (db/mutate.ts's undoMostRecentMutation),
 * scoped to the visits table, with the care plan session links the visit's
 * write changed put back in the same transaction: undoing a cancel or a
 * no-show relinks the session it freed, undoing a move's new visit carries
 * the session back to the original visit, and undoing a booking unlinks
 * the session it booked (db/carePlans.ts's sessionLinksToRestore). The
 * links are written before the visit itself, so a visit the undo deletes
 * is never deleted while a session still points to it — the server would
 * refuse that delete on the foreign key. Refused as "stale" when a session
 * changed since would still point to a visit the undo deletes. The plans
 * concerned get their derived fields rewritten last, against the visit as
 * the undo leaves it.
 */
export async function undoMostRecentVisitMutation(db: ClintraDatabase, auditLogId: string): Promise<UndoOutcome> {
  const actor = await resolveActingMembership(db);
  return runAtomicMutations(db, [db.visits, ...sessionLinkTables(db)], async (write): Promise<UndoOutcome> => {
    const check = await checkUndo(db, auditLogId, "visits", db.visits);
    if (!check.ok) {
      return check;
    }
    const restores = await sessionLinksToRestore(db, check.auditRow);
    if (restores === null) {
      return { ok: false, reason: "stale" };
    }
    for (const restore of restores) {
      await write({
        table: db.care_plan_items,
        entity: "care_plan_items",
        entityId: restore.before.id,
        action: AuditAction.Update,
        before: restore.before,
        after: restore.after,
        actorMembershipId: actor.id,
        orgId: check.auditRow.org_id,
      });
    }
    await write(reversalOf(check, "visits", db.visits, actor.id));
    await refreshPlansAfterVisitUndo(write, db, check.auditRow.entity_id, restores, actor.id);
    return { ok: true };
  });
}
