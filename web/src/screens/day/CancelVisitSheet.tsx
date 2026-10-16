import { useEffect, useRef } from "react";
import { CancelReason } from "../../domain/visitStatus";
import type { VisitCancelReason } from "../../db/visitCancel";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";

interface CancelVisitSheetProps {
  patientName: string;
  onDismiss: () => void;
  onSelectReason: (reason: VisitCancelReason) => void;
}

/** The cancel-reason prompt: two buttons, no free-text, per the specification. */
export default function CancelVisitSheet({ patientName, onDismiss, onSelectReason }: CancelVisitSheetProps) {
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  return (
    <Sheet onDismiss={onDismiss}>
      {/* `.book-body`'s padding: Sheet.tsx draws only the card, so content
          set straight inside it would touch, and be cut by, its rounded edge. */}
      <div className="px-5 py-[18px]">
        <p className="font-medium">{dayScreenStrings.cancelPromptTitle}</p>
        <p className="mt-1 text-sm text-muted">{patientName}</p>
        <div className="mt-4 flex flex-col gap-2">
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
      </div>
    </Sheet>
  );
}
