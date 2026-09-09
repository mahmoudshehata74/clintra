import type { ReactNode } from "react";
import { dayScreenStrings } from "./strings";

interface SheetHeaderProps {
  title: ReactNode;
  onDismiss: () => void;
  /** Extra content on the trailing side, before the close button — e.g. the invoice's status and record-payment pills. */
  extra?: ReactNode;
}

/**
 * The reference's compact .fbar header bar: a short title on the leading
 * side, a close affordance (and any extra pills) on the trailing side.
 * Reused across every sheet redesigned to match the reference (booking,
 * invoice, payment, receipt, audit, day sheet) so they all share one
 * chrome. Sheet.tsx's own backdrop-tap/Escape/drag-down dismissal is
 * unchanged by this — the button here calls the exact same onDismiss,
 * just as an additional, discoverable way to close.
 */
export default function SheetHeader({ title, onDismiss, extra }: SheetHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
      <p className="font-display text-sm font-medium">{title}</p>
      <div className="flex shrink-0 items-center gap-2">
        {extra}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dayScreenStrings.sheetCloseAriaLabel}
          className="text-lg leading-none text-muted"
        >
          ×
        </button>
      </div>
    </div>
  );
}
