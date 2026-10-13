import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const DRAG_DISMISS_THRESHOLD_PX = 80;

// Every mounted sheet, in mount order. A sheet can open over another (the
// printed prescription over the visit sheet); Escape then dismisses only the
// topmost one, the one the user is looking at, and every sheet under it sits
// under the topmost one's backdrop (see the layers below). Replaced, never
// mutated, so a subscribed sheet re-renders when the stack changes.
let openSheets: readonly object[] = [];
const stackListeners = new Set<() => void>();

function setOpenSheets(next: readonly object[]) {
  openSheets = next;
  stackListeners.forEach((listener) => listener());
}

function subscribeToStack(listener: () => void) {
  stackListeners.add(listener);
  return () => {
    stackListeners.delete(listener);
  };
}

function readStack() {
  return openSheets;
}

// Escape presses a sheet has already dismissed for. Every open sheet listens
// for Escape, in whatever order their listeners happen to be registered; once
// the topmost one dismisses, React may unmount it before the next listener
// runs, and the sheet under it would then find itself topmost and dismiss on
// the same press. One press dismisses one sheet.
const handledEscapes = new WeakSet<KeyboardEvent>();

// Stacked layers, by a sheet's depth in the stack (0 = the first one open):
// its backdrop, and its handle+panel while another sheet covers it. Each
// covered panel sits above its own backdrop and below the next sheet's, so
// only the topmost sheet's handle and panel are undimmed; all of them stay
// below the app bar and rail (z-40), as the first backdrop always did. The
// topmost panel is z-45 at any depth. Deeper stacks than this share the last
// pair.
const BACKDROP_LAYER = ["z-30", "z-32", "z-34", "z-36"] as const;
const COVERED_PANEL_LAYER = ["z-31", "z-33", "z-35", "z-37"] as const;

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
 * tap, drag-down, and Escape (the topmost sheet's only) all dismiss; background scroll is locked while
 * open. The panel itself carries the shared SheetPanel look (.book: token
 * radius on its top corners only, since it's bottom-anchored; bg-card;
 * shadow-l) so every sheet gets the same frame whether or not its content
 * has been restyled onto SheetPanelHead/Body/Foot yet — a sheet that hasn't
 * just renders plain content inside that same card.
 *
 * Overlay geometry — two separately stacked layers, not one:
 * - The backdrop is `inset-0` at z-30, covering the whole viewport (app bar
 *   and side rail/mobile bottom bar included, so no page content is ever
 *   left undimmed). The app bar and rail sit above it at z-40 (see
 *   AppShell.tsx), so both stay genuinely interactive wherever they are
 *   visible while a sheet is open (the rail switches away from settings
 *   without an extra dismiss tap; the lock action stays reachable
 *   mid-booking).
 * - The panel sits ABOVE that chrome, at z-45, and below App.tsx's
 *   re-activation banner (z-47) and LockScreen's z-50.
 *   On a narrow viewport the app bar wraps to two rows (~104px), so a tall
 *   sheet that only cleared a single-row bar used to slide under it, its
 *   title clipped and its close button half hidden. Painting the panel
 *   above the bar means a sheet's own head and close button can never be
 *   covered, whatever height the bar wraps to.
 * The panel is bottom-anchored on every width and capped to the viewport
 * height minus a top gap (top-6, 24px — enough for the drag handle and a
 * visible strip of dimmed page above the card); its content scrolls
 * internally (overflow-y-auto on the dialog element) while a restyled
 * sheet's SheetPanelHead/Foot stay pinned via their own sticky positioning.
 * UndoToast stays at its own z-10, i.e. below a sheet, as before.
 * A sheet opened over another one stacks above it: the lower sheet, its
 * drag handle included, drops under the upper sheet's backdrop (see
 * BACKDROP_LAYER and COVERED_PANEL_LAYER above).
 */
export default function Sheet({ onDismiss, size = "md", children }: SheetProps) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);
  const [stackToken] = useState(() => ({}));
  const stack = useSyncExternalStore(subscribeToStack, readStack);
  const depth = stack.indexOf(stackToken);
  const layer = Math.min(Math.max(depth, 0), BACKDROP_LAYER.length - 1);
  const isCovered = depth !== -1 && depth < stack.length - 1;

  useEffect(() => {
    setOpenSheets([...openSheets, stackToken]);
    return () => {
      setOpenSheets(openSheets.filter((token) => token !== stackToken));
    };
  }, [stackToken]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !handledEscapes.has(event) && openSheets[openSheets.length - 1] === stackToken) {
        handledEscapes.add(event);
        onDismiss();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss, stackToken]);

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
    <>
      <div className={`fixed inset-0 ${BACKDROP_LAYER[layer]} bg-ink/40`} onClick={onDismiss} aria-hidden="true" />
      {/* pointer-events-none: this box spans the viewport from the top gap
          (top-6 — see this component's doc comment) down to the bottom,
          mobile bottom-bar height excluded, so the dialog panel inside it
          has a definite height to cap itself against; its own empty flex
          space (above and beside the centered panel) must NOT steal clicks
          meant for the backdrop or the chrome behind it — only the two
          children below re-enable pointer-events on themselves. bottom-16
          below sm keeps the panel off AppShell's mobile bottom nav bar, so
          that bar stays visible and clickable; at sm: and above the rail is
          a side column instead, so this reclaims the full height. */}
      <div
        className={`pointer-events-none fixed inset-x-0 top-6 bottom-16 ${isCovered ? COVERED_PANEL_LAYER[layer] : "z-45"} flex flex-col items-center justify-end sm:bottom-0`}
      >
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
    </>
  );
}
