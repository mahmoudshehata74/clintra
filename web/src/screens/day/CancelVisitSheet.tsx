import { useEffect, useRef } from "react";
import { SheetPanelBody } from "../../components/ui/SheetPanel";
import { CancelReason } from "../../domain/visitStatus";
import type { VisitCancelReason } from "../../db/visitCancel";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
import { dayScreenStrings } from "./strings";

interface CancelVisitSheetProps {
  patientName: string;
  onDismiss: () => void;
  onSelectReason: (reason: VisitCancelReason) => void;
}

/** The cancel-reason prompt: two buttons, no free-text, per the specification, under the shared sheet head (title + ×). */
export default function CancelVisitSheet({ patientName, onDismiss, onSelectReason }: CancelVisitSheetProps) {
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  return (
    <Sheet onDismiss={onDismiss}>
      <SheetHeader title={dayScreenStrings.cancelPromptTitle} onDismiss={onDismiss} />
      <SheetPanelBody>
        <p className="text-sm text-muted">{patientName}</p>
        <div className="flex flex-col gap-2">
          <button
            ref={firstButtonRef}
            type="button"
            onClick={() => onSelectReason(CancelReason.Patient)}
            className="rounded-control border border-rule p-3 text-center"
          >
            {dayScreenStrings.cancelReasonPatient}
          </button>
          <button
            type="button"
            onClick={() => onSelectReason(CancelReason.Clinic)}
            className="rounded-control border border-rule p-3 text-center"
          >
            {dayScreenStrings.cancelReasonClinic}
          </button>
        </div>
      </SheetPanelBody>
    </Sheet>
  );
}
