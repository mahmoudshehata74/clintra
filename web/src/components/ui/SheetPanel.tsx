import type { ReactNode } from "react";

export interface SheetPanelProps {
  children: ReactNode;
  className?: string;
}

/**
 * Prototype source: `.book`, `.book-head`, `.book-head h3`, `.book-head
 * .x`, `.book-body`, `.book-foot` (docs/reference/clintra-prototype.html).
 *
 * Presentational only — no overlay, no portal, no focus trap, no Escape
 * handling. web/src/screens/day/Sheet.tsx now carries this same look
 * (token radius on its top corners, bg-card, shadow-l) on its own sliding
 * panel directly, so a day-screen sheet renders SheetPanelHead/Body/Foot
 * straight inside `<Sheet>` rather than this default export — Sheet.tsx
 * already is the card. This default SheetPanel component stays for
 * standalone, non-dialog uses (e.g. the gallery's static demo).
 */
export default function SheetPanel({ children, className }: SheetPanelProps) {
  const classes = [
    "mx-auto w-full max-w-[520px] overflow-hidden rounded-panel border border-rule bg-card shadow-l",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}

export interface SheetPanelCloseButtonProps {
  onClose: () => void;
  closeLabel: string;
}

/**
 * `.book-head .x` — the round close button (its own 8px radius collapses to
 * the control token). Shared by SheetPanelHead and any sheet whose head
 * isn't built from SheetPanelHead (e.g. InvoiceSheet.tsx's bespoke
 * `.inv-head`, which still needs the same accessible dismissal every other
 * sheet offers).
 */
export function SheetPanelCloseButton({ onClose, closeLabel }: SheetPanelCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={closeLabel}
      className={
        "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-white/[0.14] bg-white/[0.08] p-0 font-[inherit] text-base leading-none text-on-dark " +
        // A square icon button, unlike Button.tsx's MD_TOUCH_TARGET —
        // extend the invisible hit area in both axes, not just height.
        "after:absolute after:left-1/2 after:top-1/2 after:h-10 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      }
    >
      ×
    </button>
  );
}

export interface SheetPanelHeadProps {
  title: ReactNode;
  onClose: () => void;
  closeLabel: string;
}

/**
 * `.book-head` — dark gradient bar, a flex-1 title and a round close button.
 * Sticky to the top of Sheet.tsx's own scrolling dialog element, so it stays
 * pinned while SheetPanelBody scrolls underneath it.
 */
export function SheetPanelHead({ title, onClose, closeLabel }: SheetPanelHeadProps) {
  return (
    <div className="sticky top-0 z-10 flex items-center bg-[linear-gradient(135deg,var(--color-ink)_0%,var(--color-ink-2)_100%)] px-5 py-[14px] text-on-dark">
      <h3 className="m-0 flex-1 text-[15px] font-semibold tracking-[-0.005em]">{title}</h3>
      <SheetPanelCloseButton onClose={onClose} closeLabel={closeLabel} />
    </div>
  );
}

export interface SheetPanelBodyProps {
  children: ReactNode;
}

/** `.book-body` — padded, vertically stacked content. */
export function SheetPanelBody({ children }: SheetPanelBodyProps) {
  return <div className="flex flex-col gap-[14px] px-5 py-[18px]">{children}</div>;
}

export interface SheetPanelFootProps {
  children: ReactNode;
}

/**
 * `.book-foot` — the action row. Give the primary action `className="flex-1"`
 * to match `.book-foot .run`'s own flex:1. Sticky to the bottom of
 * Sheet.tsx's own scrolling dialog element, so it stays pinned while
 * SheetPanelBody scrolls underneath it.
 */
export function SheetPanelFoot({ children }: SheetPanelFootProps) {
  return <div className="sticky bottom-0 z-10 flex gap-2 border-t border-hair bg-field px-5 py-[14px]">{children}</div>;
}
