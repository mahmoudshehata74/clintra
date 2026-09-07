import { dayScreenStrings } from "./strings";

interface AttendanceToastProps {
  onUndo: () => void;
}

// Fixed, non-modal and small: it must never block the rest of the screen or
// steal focus, per the specification.
export default function AttendanceToast({ onUndo }: AttendanceToastProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-[--radius-el] border border-line bg-paper px-4 py-2">
        <span className="text-sm">{dayScreenStrings.attendanceMarked}</span>
        <button type="button" onClick={onUndo} className="text-sm font-semibold text-green">
          {dayScreenStrings.undoAction}
        </button>
      </div>
    </div>
  );
}
