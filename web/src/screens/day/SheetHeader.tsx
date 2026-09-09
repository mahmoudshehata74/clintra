import { dayScreenStrings } from "./strings";

interface SheetHeaderProps {
  title: string;
  onDismiss: () => void;
}

/**
 * The reference's compact .fbar header bar: a short title on the leading
 * side, a close affordance on the trailing side. Reused across every sheet
 * redesigned to match the reference (booking, invoice, payment, receipt,
 * audit, day sheet) so they all share one chrome. Sheet.tsx's own
 * backdrop-tap/Escape/drag-down dismissal is unchanged by this — the button
 * here calls the exact same onDismiss, just as an additional, discoverable
 * way to close.
 */
export default function SheetHeader({ title, onDismiss }: SheetHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2">
      <p className="font-display text-sm font-medium">{title}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dayScreenStrings.sheetCloseAriaLabel}
        className="text-lg leading-none text-muted"
      >
        ×
      </button>
    </div>
  );
}
