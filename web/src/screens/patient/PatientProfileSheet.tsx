import { createPortal } from "react-dom";
import Sheet from "../day/Sheet";
import SheetHeader from "../day/SheetHeader";
import PatientProfile from "./PatientProfile";
import type { ProfileTab } from "./profileModel";
import { patientProfileStrings as T } from "./strings";

interface PatientProfileSheetProps {
  patientId: string;
  initialTab?: ProfileTab;
  onDismiss: () => void;
}

/**
 * The patient profile (reference screen 18) in a sheet, opened from a visit:
 * the workspace's `.quick` buttons, the doctor's day's "افتح الملف" and the
 * day screen's VisitMenu. Rendered into a body-level portal, like every
 * sheet that can open over another one, and kept off paper.
 */
export default function PatientProfileSheet({ patientId, initialTab, onDismiss }: PatientProfileSheetProps) {
  return createPortal(
    <div className="print:hidden">
      <Sheet onDismiss={onDismiss} size="lg">
        <SheetHeader title={T.sheetTitle} onDismiss={onDismiss} />
        <PatientProfile patientId={patientId} initialTab={initialTab} />
      </Sheet>
    </div>,
    document.body,
  );
}
