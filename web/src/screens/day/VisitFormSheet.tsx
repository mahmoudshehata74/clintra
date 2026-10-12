import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import type { Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { clockTimeInCairo } from "../../domain/time";
import { visitWorkspaceStrings } from "../visit/strings";
import VisitWorkspace, { type VisitCompletion } from "../visit/VisitWorkspace";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";

interface VisitFormSheetProps {
  visitId: string;
  onDismiss: () => void;
  /** The caller's own completion path and cooldown, behind the workspace's "قفل الزيارة". */
  completion: VisitCompletion;
}

/**
 * The visit workspace (reference screen 10, see screens/visit/VisitWorkspace.tsx)
 * in a sheet. Opened deliberately from a pill on an in_room or completed row,
 * or from the doctor's day — never automatically — and just as writable
 * after completion as before it, since filling the visit form is decoupled
 * from completing the visit (see db/visitForm.ts, db/visitCompletion.ts).
 * Titled by its purpose; the patient is named once, in `.pt-summary` below.
 */
export default function VisitFormSheet({ visitId, onDismiss, completion }: VisitFormSheetProps) {
  const visit = useLiveQuery<Visit | null>(async () => (await db.visits.get(visitId)) ?? null, [visitId]);

  return (
    <Sheet onDismiss={onDismiss} size="lg">
      <SheetHeader
        title={visitWorkspaceStrings.visitSheetTitle}
        onDismiss={onDismiss}
        extra={
          visit?.arrived_at && (
            <span className="text-sm text-muted">
              <Ltr>{clockTimeInCairo(visit.arrived_at)}</Ltr>
            </span>
          )
        }
      />
      <VisitWorkspace visitId={visitId} layout="sheet" onClose={onDismiss} completion={completion} />
    </Sheet>
  );
}
