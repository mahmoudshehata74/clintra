import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

const DRAG_DISMISS_THRESHOLD_PX = 80;

export type SheetSize = "md" | "lg";

// .book's own max-width (520px) for "md"; "lg" is this task's own addition
// for the invoice table, which needs more room than any prototype sheet
// shows — there is no reference class for it.
const SIZE_MAX_WIDTH: Record<SheetSize, string> = {
  md: "max-w-[520px]",
  lg: "max-w-[720px]",
};

interface SheetProps {
  onDismiss: () => void;
  /** .book's own max-width class; "md" (520px) is the prototype's own sheet, "lg" (720px) is this task's addition for the invoice table. */
  size?: SheetSize;
  children: ReactNode;
}

/**
 * The bottom-sheet chrome shared by every sheet on the day screen: backdrop
 * tap, drag-down, and Escape all dismiss; background scroll is locked while
 * open. The panel itself carries the shared SheetPanel look (.book: token
 * radius on its top corners only, since it's bottom-anchored; bg-card;
 * shadow-l) so every sheet gets the same frame whether or not its content
 * has been restyled onto SheetPanelHead/Body/Foot yet — a sheet that hasn't
 * just renders plain content inside that same card.
 *
 * Overlay geometry: the backdrop is `inset-0`, covering the whole viewport —
 * app bar and side rail/mobile bottom bar included, so no page content is
 * ever left undimmed above it — at z-30. The app bar and rail sit above it
 * at z-40 (see AppShell.tsx) rather than below: both stay genuinely
 * interactive while a sheet is open (the sidebar switches away from settings
 * without an extra dismiss tap; the lock action stays reachable mid-booking),
 * which a backdrop dimming them while still eating their clicks would break.
 * Sheet itself sits below LockScreen's z-50. UndoToast stays at its own
 * z-10, i.e. below a sheet: that's the relationship already in place before
 * this change (Sheet was z-20 to UndoToast's z-10), so a toast raised while
 * a sheet is open is not expected to stay usable over it here.
 * The panel is bottom-anchored on every width and capped to the viewport
 * height minus a top gap (top-6) so the dimmed backdrop is always visible
 * above it; its own content scrolls internally (overflow-y-auto on the
 * dialog element) while a restyled sheet's SheetPanelHead/Foot stay pinned
 * via their own sticky positioning.
 */
export default function Sheet({ onDismiss, size = "md", children }: SheetProps) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDismiss();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    setIsDragging(true);
    dragStartYRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isDragging || dragStartYRef.current === null) {
      return;
    }
    setDragY(Math.max(0, event.clientY - dragStartYRef.current));
  }

  function handlePointerUp() {
    if (!isDragging) {
      return;
    }
    setIsDragging(false);
    dragStartYRef.current = null;
    if (dragY > DRAG_DISMISS_THRESHOLD_PX) {
      onDismiss();
    } else {
      setDragY(0);
    }
  }

  // Applied to both the handle and the dialog panel below: they must be
  // direct children of the one flex container that actually has a definite
  // height (top-6/bottom-0 on a fixed, inset-0 ancestor), for the dialog's
  // own max-h-full to resolve against anything — a percentage max-height
  // does not cascade through an intermediate auto-height wrapper. Giving the
  // handle the same transform keeps it visually attached to the panel while
  // dragging, without that extra wrapper.
  const dragTransform = {
    transform: `translateY(${dragY}px)`,
    transition: isDragging ? "none" : "transform 150ms ease-out",
  };

  return (
    <div className="fixed inset-0 z-30">
      <div className="absolute inset-0 bg-ink/40" onClick={onDismiss} aria-hidden="true" />
      {/* pointer-events-none: this box spans the full remaining viewport
          (top-6 down to the bottom, mobile bottom-bar height excluded) so
          the dialog panel inside it has a definite height to cap itself
          against, but its own empty flex space (above and beside the
          centered panel) must NOT steal clicks meant for the backdrop
          behind it — only the two children below re-enable pointer-events
          on themselves. bottom-16 below sm: keeps the panel itself from
          ever sitting under AppShell's mobile bottom nav bar (z-40, above
          this backdrop so it stays genuinely clickable) — at sm: and above
          the rail is a side column instead, so this reclaims the full
          height. */}
      <div className="pointer-events-none absolute inset-x-0 top-6 bottom-16 flex flex-col items-center justify-end sm:bottom-0">
        {/* Drag-to-dismiss handle: sits in the dimmed gap above the card
            itself rather than inside it, since the card's own top is now
            either the dark SheetPanelHead or (for a not-yet-restyled sheet)
            its plain content, neither of which has room reserved for it.
            Not in the prototype — it's this app's own affordance for the
            drag-down gesture below. */}
        <div
          className="pointer-events-auto mb-1.5 h-1.5 w-12 shrink-0 touch-none rounded-full bg-card/70"
          style={dragTransform}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div
          className={`pointer-events-auto flex w-full max-h-full flex-col overflow-y-auto rounded-t-panel border border-rule bg-card shadow-l ${SIZE_MAX_WIDTH[size]}`}
          style={dragTransform}
          role="dialog"
          aria-modal="true"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
