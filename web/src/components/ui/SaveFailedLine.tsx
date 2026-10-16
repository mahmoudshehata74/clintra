import { saveFailedStrings } from "../strings";

/** The shared "ماتحفظش، جرّب تاني" under a control whose write failed (attemptSave). */
export default function SaveFailedLine({ className = "" }: { className?: string }) {
  return (
    <p role="alert" className={`text-[12.5px] text-danger ${className}`}>
      {saveFailedStrings.line}
    </p>
  );
}
