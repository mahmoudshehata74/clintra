import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

const DRAG_DISMISS_THRESHOLD_PX = 80;

interface SheetProps {
  onDismiss: () => void;
  children: ReactNode;
}

/**
 * The bottom-sheet chrome shared by every sheet on the day screen (booking,
 * move, cancel): backdrop tap, drag-down, and Escape all dismiss; background
 * scroll is locked while open; the panel is clipped to top-40 so it can
 * never cover the day header, on both mobile and desktop widths. Content is
 * the caller's responsibility, including its own autofocus.
 */
export default function Sheet({ onDismiss, children }: SheetProps) {
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

  return (
    // bottom-16 below sm: leaves room for AppShell's mobile bottom nav bar
    // (see AppShell.tsx) so the two fixed layers never overlap — at sm: and
    // above the sidebar is a side rail instead, so the sheet reclaims the
    // full height exactly as before AppShell existed.
    <div className="fixed inset-x-0 bottom-16 top-40 z-20 sm:bottom-0">
      <div className="absolute inset-0 bg-ink/40" onClick={onDismiss} aria-hidden="true" />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-t-[--radius-frame] border border-line bg-paper px-4 pb-6 pt-2 shadow-lg"
        style={{
          transform: `translateY(${dragY}px)`,
          transition: isDragging ? "none" : "transform 150ms ease-out",
        }}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="mx-auto mb-2 h-1.5 w-12 shrink-0 touch-none rounded-full bg-line"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        {children}
      </div>
    </div>
  );
}
