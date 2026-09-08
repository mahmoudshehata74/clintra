import { useEffect, useRef } from "react";
import { dayScreenStrings } from "./strings";

export interface VisitMenuActions {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onMove: () => void;
  onCancel: () => void;
  onNoShow: () => void;
}

interface VisitMenuProps {
  actions: VisitMenuActions;
}

/**
 * The overflow menu for an occupied row: move at the top, cancel and
 * mark-no-show grouped at the bottom behind a visual separator, per the
 * specification's rule that destructive actions live in their own group.
 * Every item is a plain focusable button, so Tab/Shift+Tab and Enter/Space
 * reach them with no extra wiring; Escape and an outside click both close it.
 */
export default function VisitMenu({ actions }: VisitMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actions.isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        actions.onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        actions.onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actions is a fresh object every render; only isOpen and onClose matter here.
  }, [actions.isOpen, actions.onClose]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={actions.isOpen ? actions.onClose : actions.onOpen}
        aria-label={dayScreenStrings.menuOpenAriaLabel}
        aria-haspopup="menu"
        aria-expanded={actions.isOpen}
        className="shrink-0 rounded-full px-2 py-1 text-lg text-muted"
      >
        ⋯
      </button>

      {actions.isOpen && (
        <div
          ref={containerRef}
          role="menu"
          className="absolute end-0 top-full z-10 mt-1 flex w-48 flex-col overflow-hidden rounded-[--radius-el] border border-line bg-paper shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={actions.onMove}
            className="p-3 text-start hover:bg-line/30"
          >
            {dayScreenStrings.moveMenuLabel}
          </button>
          <div className="border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={actions.onCancel}
            className="p-3 text-start text-red hover:bg-line/30"
          >
            {dayScreenStrings.cancelMenuLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={actions.onNoShow}
            className="p-3 text-start text-red hover:bg-line/30"
          >
            {dayScreenStrings.noShowMenuLabel}
          </button>
        </div>
      )}
    </div>
  );
}
