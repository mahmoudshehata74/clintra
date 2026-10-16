import { useRef } from "react";
import Popover from "../../components/ui/Popover";
import { patientProfileStrings } from "../patient/strings";
import { dayScreenStrings } from "./strings";

export interface VisitMenuActions {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Move/cancel/no-show are only offered on a still-administrable visit (see visitActions.ts). */
  onMove?: () => void;
  onCancel?: () => void;
  onNoShow?: () => void;
  /** Only present once the visit has an invoice (see db/visitCompletion.ts). */
  onInvoice?: () => void;
  /** Queue mode only, on a still-waiting row — see db/visitQueue.ts's sendVisitToEndOfQueue. */
  onSendToEnd?: () => void;
  /** Any visit whose patient exists — opens the send sheet (screens/messages/SendMessageSheet.tsx). */
  onSendMessage?: () => void;
  /** Any visit whose patient exists — opens the patient profile (screens/patient/PatientProfileSheet.tsx). */
  onOpenProfile?: () => void;
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
 *
 * The menu is a Popover (a body-level portal anchored to the ⋯ button), so
 * it always opens fully on screen — flipped above the button near the
 * bottom of the window — and no card's overflow can cut it.
 */
export default function VisitMenu({ actions }: VisitMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const item = "p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset";
  const plainItem = `${item} hover:bg-field focus-visible:ring-green`;
  const dangerItem = `${item} bg-danger-wash text-danger hover:bg-danger-wash/60 focus-visible:ring-danger`;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={actions.isOpen ? actions.onClose : actions.onOpen}
        aria-label={dayScreenStrings.menuOpenAriaLabel}
        aria-haspopup="menu"
        aria-expanded={actions.isOpen}
        className="shrink-0 rounded-full px-2 py-1 text-lg text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green"
      >
        ⋯
      </button>

      {actions.isOpen && (
        <Popover anchorRef={triggerRef} onClose={actions.onClose} role="menu" widthClassName="w-48">
          {actions.onMove && (
            <button type="button" role="menuitem" onClick={actions.onMove} className={plainItem}>
              {dayScreenStrings.moveMenuLabel}
            </button>
          )}
          {actions.onSendToEnd && (
            <button type="button" role="menuitem" onClick={actions.onSendToEnd} className={plainItem}>
              {dayScreenStrings.sendToEndOfQueueMenuLabel}
            </button>
          )}
          {actions.onInvoice && (
            <button type="button" role="menuitem" onClick={actions.onInvoice} className={plainItem}>
              {dayScreenStrings.invoiceMenuLabel}
            </button>
          )}
          {actions.onSendMessage && (
            <button type="button" role="menuitem" onClick={actions.onSendMessage} className={plainItem}>
              {dayScreenStrings.sendMessageMenuLabel}
            </button>
          )}
          {actions.onOpenProfile && (
            <button type="button" role="menuitem" onClick={actions.onOpenProfile} className={plainItem}>
              {patientProfileStrings.menuLabel}
            </button>
          )}
          {(actions.onCancel || actions.onNoShow) &&
            (actions.onMove || actions.onSendToEnd || actions.onInvoice || actions.onSendMessage || actions.onOpenProfile) && (
              <div className="border-t border-danger-line" />
            )}
          {actions.onCancel && (
            <button type="button" role="menuitem" onClick={actions.onCancel} className={dangerItem}>
              {dayScreenStrings.cancelMenuLabel}
            </button>
          )}
          {actions.onNoShow && (
            <button type="button" role="menuitem" onClick={actions.onNoShow} className={dangerItem}>
              {dayScreenStrings.noShowMenuLabel}
            </button>
          )}
        </Popover>
      )}
    </div>
  );
}
