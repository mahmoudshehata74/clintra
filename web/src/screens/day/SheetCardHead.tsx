import type { ReactNode } from "react";
import { CardHead } from "../../components/ui/Card";
import { SheetPanelCloseButton } from "../../components/ui/SheetPanel";
import { dayScreenStrings } from "./strings";

interface SheetCardHeadProps {
  /** `.c-head .badge` — e.g. "اليوم", "الإعدادات". */
  badge?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  onDismiss: () => void;
}

/**
 * A sheet whose head in the prototype is a card's `.c-head` (badge, `h3`,
 * `.sub`) rather than a `.book-head` — the audit log (#s11) and settings
 * (#s12–14). The shared CardHead, pinned to the top of Sheet.tsx's own
 * scrolling dialog the same way SheetPanelHead is, with the same close
 * button (and accessible name) every other sheet uses as its trailing
 * action.
 */
export default function SheetCardHead({ badge, title, subtitle, onDismiss }: SheetCardHeadProps) {
  return (
    <div className="sticky top-0 z-10">
      <CardHead
        badge={badge}
        title={title}
        subtitle={subtitle}
        action={<SheetPanelCloseButton onClose={onDismiss} closeLabel={dayScreenStrings.sheetCloseAriaLabel} />}
      />
    </div>
  );
}
