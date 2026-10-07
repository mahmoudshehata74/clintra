import type { ReactNode } from "react";
import { SheetPanelHead } from "../../components/ui/SheetPanel";
import { dayScreenStrings } from "./strings";

interface SheetHeaderProps {
  title: ReactNode;
  onDismiss: () => void;
  /** Extra content on the trailing side, before the close button — e.g. the invoice's status and record-payment pills. */
  extra?: ReactNode;
}

/**
 * Thin wrapper over SheetPanelHead (`.book-head`) so every sheet that uses
 * it gets the new dark gradient head at once. `extra` has no slot of its own
 * on SheetPanelHead, so it renders just before the close button, inside the
 * same trailing area SheetPanelHead already reserves for it via its
 * title's `flex-1`. The close button keeps calling the same onDismiss
 * Sheet.tsx's backdrop-tap/Escape/drag-down also use, and the same
 * accessible name (dayScreenStrings.sheetCloseAriaLabel) existing specs
 * rely on.
 */
export default function SheetHeader({ title, onDismiss, extra }: SheetHeaderProps) {
  return (
    <SheetPanelHead
      title={
        extra ? (
          <span className="flex items-center justify-between gap-2">
            {title}
            <span className="flex shrink-0 items-center gap-2 text-xs font-normal">{extra}</span>
          </span>
        ) : (
          title
        )
      }
      onClose={onDismiss}
      closeLabel={dayScreenStrings.sheetCloseAriaLabel}
    />
  );
}
