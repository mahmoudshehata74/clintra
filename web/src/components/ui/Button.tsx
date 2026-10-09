import type { ButtonHTMLAttributes } from "react";

export type ButtonSize = "md" | "sm";

// The reference only ever defines a compact form for these four (see the
// doc comment below) — the other three stop at their own single size.
// Exported so the gallery's demo data can be typed against the same split.
export type SmCapableVariant = "primary" | "secondary" | "danger" | "muted" | "onDark";
export type MdOnlyVariant = "onDarkCopper" | "outline" | "dashed";
export type ButtonVariant = SmCapableVariant | MdOnlyVariant;

// A discriminated union, not a plain `size?: ButtonSize` on every variant:
// requesting size="sm" on onDarkCopper/outline/dashed is a compile error,
// not a silent fallback to "md", since the reference never defines what a
// compact version of those three would even look like.
type ButtonVariantSizeProps = { variant: SmCapableVariant; size?: ButtonSize } | { variant: MdOnlyVariant; size?: "md" };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariantSizeProps;

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

// md's own padding/font-size (reproduced exactly from the reference below)
// renders several variants shorter than a 40px touch target. Rather than
// a min-height — which would inflate the visible box past what the
// reference actually draws — an invisible ::after spans the full width and
// at least 40px of height, centered on the button, so the hit area meets
// the target without the box, text, focus ring or hover state changing at
// all. disabled:pointer-events-none on BASE covers this pseudo-element too
// (pointer-events is inherited), so a disabled button's hit area shrinks
// back down with everything else. sm is deliberately excluded: it's the
// reference's own compact-context size (inside a card, next to other
// controls), not a touch target in its own right.
const MD_TOUCH_TARGET = "relative after:absolute after:inset-x-0 after:top-1/2 after:h-10 after:-translate-y-1/2 after:content-['']";

// The focus ring's default white offset reads fine on paper/card/wash
// surfaces; onDark and onDarkCopper sit on the ink slab, so their ring
// needs an ink-colored offset instead to stay visible against it.
const DARK_SURFACE_FOCUS = "focus-visible:ring-offset-ink";

interface SizeClasses {
  md: string;
  /** Present only for the variants SmCapableVariant names. */
  sm?: string;
}

/**
 * Prototype source per variant (docs/reference/clintra-prototype.html):
 * primary = .run, secondary = .pill, danger = .pill.danger,
 * muted = .doc-item.done .go (the colours a finished row's action takes),
 * onDark = .sb (md) / .app-btn (sm), onDarkCopper = .sb.copper,
 * outline = .set-row .edit, dashed = .slot.empty .quick.
 *
 * md reproduces each class's own padding, font-size, gap and font-weight
 * exactly as declared — no rounding to a shared scale. The one exception is
 * border-radius: each class's own literal value (7-10px across the seven)
 * is collapsed to the single rounded-control token in BASE instead, since
 * this is new shared infrastructure, not a reproduction of one existing
 * screen, and the token system wins over each class's incidental pixel
 * value there.
 *
 * sm exists only where the reference itself defines a compact form:
 * .brief-act .run / .brief-act .pill for primary/secondary/danger (danger
 * inherits .pill's own padding/font-size, since .brief-act .pill still
 * matches an element carrying both the pill and danger classes; muted
 * follows danger, carrying .doc-item.done .go's colours), and .app-btn for
 * onDark. onDarkCopper, outline and dashed have no such rule
 * in the reference, so they have no sm — ButtonVariantSizeProps makes
 * requesting one for those three a type error rather than inventing a size
 * the design doesn't define.
 */
const VARIANT_SIZE_CLASSES: Record<ButtonVariant, SizeClasses> = {
  primary: {
    md: "gap-2 px-[22px] py-2.5 text-[13.5px] font-semibold text-white bg-[linear-gradient(135deg,var(--color-green)_0%,var(--color-green-2)_130%)] shadow-[0_2px_6px_color-mix(in_srgb,var(--color-green)_30%,transparent)]",
    sm: "gap-2 px-3.5 py-2 text-[12.5px] font-semibold text-white bg-[linear-gradient(135deg,var(--color-green)_0%,var(--color-green-2)_130%)] shadow-[0_2px_6px_color-mix(in_srgb,var(--color-green)_30%,transparent)]",
  },
  secondary: {
    md: "border-[1.5px] border-green-line bg-green-wash px-3.5 py-2 text-[12.5px] font-semibold text-green",
    sm: "border-[1.5px] border-green-line bg-green-wash px-3 py-2 text-[11.5px] font-semibold text-green",
  },
  danger: {
    md: "border-[1.5px] border-danger-line bg-danger-wash px-3.5 py-2 text-[12.5px] font-semibold text-danger",
    sm: "border-[1.5px] border-danger-line bg-danger-wash px-3 py-2 text-[11.5px] font-semibold text-danger",
  },
  // .doc-item.done .go's field/rule/muted colours on secondary's own
  // metrics in both sizes — the same relationship danger has to secondary.
  muted: {
    md: "border-[1.5px] border-rule bg-field px-3.5 py-2 text-[12.5px] font-semibold text-muted",
    sm: "border-[1.5px] border-rule bg-field px-3 py-2 text-[11.5px] font-semibold text-muted",
  },
  onDark: {
    md: "gap-[7px] border border-white/[0.16] bg-white/[0.09] px-[13px] py-1.5 text-xs font-semibold text-on-dark",
    sm: "border border-white/[0.14] bg-white/[0.08] px-[11px] py-[5px] text-[11.5px] font-medium text-on-dark hover:bg-white/[0.16]",
  },
  onDarkCopper: {
    md: "gap-[7px] border border-copper-line bg-[color-mix(in_srgb,var(--color-copper)_22%,transparent)] px-[13px] py-1.5 text-xs font-semibold text-copper-2",
  },
  outline: {
    md: "border-[1.5px] border-green-line bg-transparent px-2.5 py-[5px] text-[11.5px] font-semibold text-green",
  },
  dashed: {
    md: "gap-[5px] border-[1.5px] border-dashed border-rule bg-transparent px-[11px] py-[5px] text-[11.5px] font-semibold text-muted hover:border-solid hover:border-green hover:bg-green-wash hover:text-green",
  },
};

const DARK_SURFACE_VARIANTS: ReadonlySet<ButtonVariant> = new Set(["onDark", "onDarkCopper"]);

function sizeClassesFor(variant: ButtonVariant, size: ButtonSize): string {
  const entry = VARIANT_SIZE_CLASSES[variant];
  // ButtonVariantSizeProps guarantees size === "sm" only ever reaches a
  // variant whose entry defines sm — the ?? entry.md exists only to satisfy
  // SizeClasses's necessarily-optional sm field, not a real runtime case.
  return (size === "sm" ? entry.sm : entry.md) ?? entry.md;
}

export default function Button({ variant, size = "md", type = "button", className, ...rest }: ButtonProps) {
  const classes = [
    BASE,
    size === "md" ? MD_TOUCH_TARGET : "",
    DARK_SURFACE_VARIANTS.has(variant) ? DARK_SURFACE_FOCUS : "",
    sizeClassesFor(variant, size),
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <button type={type} className={classes} {...rest} />;
}
