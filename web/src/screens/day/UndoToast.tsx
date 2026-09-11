import { dayScreenStrings } from "./strings";

interface UndoToastProps {
  message: string;
  /** Present only when an undo is being offered for this message. */
  onUndo?: () => void;
}

// Fixed to the viewport's bottom edge, above the content, small and non-modal:
// it must never overlap a row, steal focus, or block scrolling. The outer
// wrapper stays pointer-events-none so only the toast box itself, not the
// full-width strip it sits in, can intercept a tap. bottom-20 below sm:
// clears AppShell's mobile bottom nav bar (see AppShell.tsx); at sm: and
// above the sidebar is a side rail instead, so this reclaims its original
// bottom-4 position exactly as before AppShell existed.
export default function UndoToast({ message, onUndo }: UndoToastProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-10 flex justify-center px-4 sm:bottom-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-[--radius-el] border border-line bg-paper px-4 py-2 shadow-lg">
        <span className="text-sm">{message}</span>
        {onUndo && (
          <button type="button" onClick={onUndo} className="text-sm font-semibold text-green">
            {dayScreenStrings.undoAction}
          </button>
        )}
      </div>
    </div>
  );
}
