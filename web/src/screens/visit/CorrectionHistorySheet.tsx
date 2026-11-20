import { createPortal } from "react-dom";
import Ltr from "../../components/Ltr";
import { SheetPanelBody } from "../../components/ui/SheetPanel";
import { db } from "../../db/database";
import type { VisitFormRevision } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { staffName } from "../../domain/staffName";
import Sheet from "../day/Sheet";
import SheetHeader from "../day/SheetHeader";
import { buildCorrectionHistory } from "./correctionModel";
import { visitCorrectionStrings as T } from "./strings";

interface HistoryData {
  revisions: VisitFormRevision[];
  names: Map<string, string>;
}

/**
 * "سجل التعديلات" (docs/design-clinical-corrections.md section 3.3): every
 * correction of a completed visit's form, newest first — when, "عدّلها
 * {name}", "السبب: …", and for each field that changed its text "قبل" and
 * "بعد". Opened from the workspace and from the patient profile's "تم
 * التعديل" chip, only for whoever reads clinical text
 * (domain/clinicalAccess.ts): the callers decide that. Rendered into the
 * body, so it stacks above the visit sheet or the profile.
 */
export default function CorrectionHistorySheet({ visitId, onDismiss }: { visitId: string; onDismiss: () => void }) {
  const data = useLiveQuery<HistoryData>(async () => {
    const revisions = await db.visit_form_revisions.where("visit_id").equals(visitId).toArray();
    const memberships = await db.memberships.bulkGet([...new Set(revisions.map((revision) => revision.corrected_by))]);
    const users = await db.users.bulkGet([...new Set(memberships.flatMap((membership) => (membership ? [membership.user_id] : [])))]);
    const usersById = new Map(users.flatMap((user) => (user ? [[user.id, user] as const] : [])));
    const names = new Map<string, string>();
    for (const membership of memberships) {
      const name = membership ? staffName(membership, usersById.get(membership.user_id)) : null;
      if (membership && name) {
        names.set(membership.id, name);
      }
    }
    return { revisions, names };
  }, [visitId]);

  const entries = data ? buildCorrectionHistory(data.revisions, data.names) : [];

  return createPortal(
    <Sheet onDismiss={onDismiss}>
      <SheetHeader title={T.historyTitle} onDismiss={onDismiss} />
      <SheetPanelBody>
        {data && entries.length === 0 && <p className="text-sm text-muted">{T.historyEmpty}</p>}
        <ol aria-label={T.historyTitle} className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-control border border-rule bg-field px-3.5 py-3">
              <p className="text-[11px] text-muted tabular-nums">
                <Ltr>{entry.when}</Ltr>
              </p>
              <p className="mt-0.5 text-[13px] font-semibold text-text">{entry.by}</p>
              <p className="mt-0.5 text-[12.5px] text-text">{entry.reason}</p>
              {entry.changes.map((change) => (
                <dl key={change.label} className="mt-2 border-t border-dashed border-hair pt-2 text-[12.5px]">
                  <dt className="text-[11px] font-bold text-muted">{change.label}</dt>
                  <dd className="mt-0.5 text-muted">
                    <span className="font-semibold">{T.before}:</span> {change.before}
                  </dd>
                  <dd className="mt-0.5 text-text">
                    <span className="font-semibold">{T.after}:</span> {change.after}
                  </dd>
                </dl>
              ))}
            </li>
          ))}
        </ol>
      </SheetPanelBody>
    </Sheet>,
    document.body,
  );
}
