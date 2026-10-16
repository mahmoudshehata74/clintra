import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "./popoverPlacement";

export interface PopoverProps {
  /** The trigger the panel opens from; focus goes back to it on Escape. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  role: "menu" | "dialog";
  "aria-label"?: string;
  /** The panel's width class (e.g. "w-60"). */
  widthClassName: string;
  children: ReactNode;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]";

/**
 * A floating panel anchored to a trigger: the look of the day screen's
 * menus (VisitMenu's card — rounded-panel, rule border, card fill, shadow-l),
 * rendered in a body-level portal with fixed positioning, so no ancestor's
 * overflow (the summary slab's rounded, overflow-hidden frame) can clip it.
 * Placement comes from placePopover: under the trigger, flipped above when
 * only that fits, and always inside the viewport. It follows the trigger
 * when the page scrolls or resizes, and when its own content changes size.
 *
 * It takes focus when it opens (its first control), since in the portal it
 * sits at the end of the document, far from its trigger in tab order;
 * Escape and a pointer down outside both it and its trigger close it, and
 * Escape hands focus back to the trigger. Above the sheets' panels (z-45),
 * below the re-activation banner (z-47) and the lock screen (z-50).
 */
export default function Popover({ anchorRef, onClose, role, "aria-label": ariaLabel, widthClassName, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) {
      return;
    }
    function place() {
      if (!panel || !anchor) {
        return;
      }
      // Measured at its natural height, before any cap from an earlier pass.
      panel.style.maxHeight = "";
      const placement = placePopover(
        anchor.getBoundingClientRect(),
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        getComputedStyle(anchor).direction === "ltr" ? "ltr" : "rtl",
      );
      panel.style.top = `${placement.top}px`;
      panel.style.left = `${placement.left}px`;
      panel.style.maxHeight = placement.maxHeight === null ? "" : `${placement.maxHeight}px`;
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        anchorRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      className={`fixed top-0 left-0 z-46 flex flex-col overflow-y-auto rounded-panel border border-rule bg-card text-text shadow-l ${widthClassName}`}
    >
      {children}
    </div>,
    document.body,
  );
}
