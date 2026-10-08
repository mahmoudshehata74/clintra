import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "role" | "onChange" | "children" | "aria-checked" | "aria-label"> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Required: a switch is only a pill shape on screen, so its accessible name has to come from here. */
  label: string;
}

// The switch's own box is `.set-row .toggle` reproduced exactly (36×20,
// fully rounded). Disabled/focus follow Button.tsx's treatment for this
// component family. The 40px touch target is Button.tsx's MD_TOUCH_TARGET
// technique in both axes (as SheetPanelCloseButton does for its square
// icon button): an invisible ::after, centred on the box, 40×40 — so the
// visible switch keeps the prototype's size. disabled:pointer-events-none
// shrinks that hit area away with everything else.
const BASE =
  "relative inline-flex h-5 w-9 flex-none cursor-pointer appearance-none rounded-full border-0 p-0 transition-colors duration-150 " +
  "after:absolute after:left-1/2 after:top-1/2 after:h-10 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50";

// `.toggle` (on: eligible) / `.toggle.off` (rule) — one background class per render.
const TRACK = { on: "bg-eligible", off: "bg-rule" } as const;

// `.toggle::after` — the 16px white knob, 2px in from the inline-end edge
// when on and from the inline-start edge when off (`.toggle.off::after`).
// Each state sets only its own inset side, so no two classes ever compete
// for one property.
const KNOB_BASE = "pointer-events-none absolute top-0.5 h-4 w-4 rounded-full bg-card";
const KNOB_POSITION = { on: "end-0.5", off: "start-0.5" } as const;

/**
 * Prototype source: `.set-row .toggle`, `.toggle.off`
 * (docs/reference/clintra-prototype.html #s13/#s14). A real button with
 * role="switch" and aria-checked rather than the prototype's bare span, so
 * it is focusable, operable from the keyboard (Space/Enter, as any button)
 * and announced as on/off.
 */
export default function Switch({ checked, onCheckedChange, label, className, onClick, ...rest }: SwitchProps) {
  const state = checked ? "on" : "off";
  const classes = [BASE, TRACK[state], className ?? ""].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={classes}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onCheckedChange(!checked);
        }
      }}
      {...rest}
    >
      <span className={`${KNOB_BASE} ${KNOB_POSITION[state]}`} aria-hidden="true" />
    </button>
  );
}
