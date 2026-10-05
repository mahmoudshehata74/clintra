import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "onDark" | "onDarkCopper" | "outline" | "dashed";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant;
  size?: ButtonSize;
}

// Shared across every variant: appearance reset, centered content, the
// token radius design-tokens.md assigns to "buttons, inputs, toggles", and
// the disabled/focus treatment the shared component is responsible for
// (the prototype's own button classes don't define either). No font-weight
// here — it differs per variant/size below, and Tailwind's cascade is by
// generated-sheet order, not by position in the class string, so a
// font-weight in both places would make the winner unpredictable.
const BASE =
  "appearance-none inline-flex items-center justify-center whitespace-nowrap cursor-pointer rounded-control transition-colors duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50";

// The focus ring's default white offset reads fine on paper/card/wash
// surfaces; onDark and onDarkCopper sit on the ink slab, so their ring
// needs an ink-colored offset instead to stay visible against it.
const DARK_SURFACE_FOCUS = "focus-visible:ring-offset-ink";

/**
 * Prototype source per variant (docs/reference/clintra-prototype.html):
 * primary = .run, secondary = .pill, danger = .pill.danger,
 * onDark = .app-btn (sm) / .sb (md), onDarkCopper = .sb.copper,
 * outline = .set-row .edit, dashed = .slot.empty .quick.
 *
 * Each class's own literal border-radius (7-10px across the seven) is
 * collapsed to the single rounded-control token in BASE instead — this is
 * new shared infrastructure, not a reproduction of one existing screen, so
 * the token system wins over each class's incidental pixel value.
 *
 * "sm" reproduces the compact context the reference itself defines
 * (.brief-act .run / .brief-act .pill) for primary/secondary/danger. The
 * other four variants have no such compact rule in the reference, so their
 * sm is a consistent scaled-down padding/font-size, matching the same kind
 * of reduction .brief-act applies to .run and .pill.
 */
const VARIANT_SIZE_CLASSES: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: {
    md: "min-h-10 gap-2 px-[22px] py-2.5 text-[13.5px] font-semibold text-white bg-[linear-gradient(135deg,var(--color-green)_0%,var(--color-green-2)_130%)] shadow-[0_2px_6px_color-mix(in_srgb,var(--color-green)_30%,transparent)]",
    sm: "gap-2 px-3.5 py-2 text-[12.5px] font-semibold text-white bg-[linear-gradient(135deg,var(--color-green)_0%,var(--color-green-2)_130%)] shadow-[0_2px_6px_color-mix(in_srgb,var(--color-green)_30%,transparent)]",
  },
  secondary: {
    md: "min-h-10 border-[1.5px] border-green-line bg-green-wash px-3.5 py-2 text-[12.5px] font-semibold text-green",
    sm: "border-[1.5px] border-green-line bg-green-wash px-3 py-2 text-[11.5px] font-semibold text-green",
  },
  danger: {
    md: "min-h-10 border-[1.5px] border-danger-line bg-danger-wash px-3.5 py-2 text-[12.5px] font-semibold text-danger",
    sm: "border-[1.5px] border-danger-line bg-danger-wash px-3 py-2 text-[11.5px] font-semibold text-danger",
  },
  onDark: {
    md: "min-h-10 gap-[7px] border border-white/[0.16] bg-white/[0.09] px-[13px] py-1.5 text-xs font-semibold text-on-dark",
    sm: "gap-[7px] border border-white/[0.14] bg-white/[0.08] px-[11px] py-[5px] text-[11.5px] font-medium text-on-dark hover:bg-white/[0.16]",
  },
  onDarkCopper: {
    md: "min-h-10 gap-[7px] border border-copper-line bg-[color-mix(in_srgb,var(--color-copper)_22%,transparent)] px-[13px] py-1.5 text-xs font-semibold text-copper-2",
    sm: "gap-[7px] border border-copper-line bg-[color-mix(in_srgb,var(--color-copper)_22%,transparent)] px-[10px] py-[5px] text-[11px] font-semibold text-copper-2",
  },
  outline: {
    md: "min-h-10 border-[1.5px] border-green-line bg-transparent px-2.5 py-[5px] text-[11.5px] font-semibold text-green",
    sm: "border-[1.5px] border-green-line bg-transparent px-2 py-1 text-[10.5px] font-semibold text-green",
  },
  dashed: {
    md: "min-h-10 gap-[5px] border-[1.5px] border-dashed border-rule bg-transparent px-[11px] py-[5px] text-[11.5px] font-semibold text-muted hover:border-solid hover:border-green hover:bg-green-wash hover:text-green",
    sm: "gap-[5px] border-[1.5px] border-dashed border-rule bg-transparent px-2 py-1 text-[10.5px] font-semibold text-muted hover:border-solid hover:border-green hover:bg-green-wash hover:text-green",
  },
};

const DARK_SURFACE_VARIANTS: ReadonlySet<ButtonVariant> = new Set(["onDark", "onDarkCopper"]);

export default function Button({ variant, size = "md", type = "button", className, ...rest }: ButtonProps) {
  const classes = [
    BASE,
    DARK_SURFACE_VARIANTS.has(variant) ? DARK_SURFACE_FOCUS : "",
    VARIANT_SIZE_CLASSES[variant][size],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <button type={type} className={classes} {...rest} />;
}
