import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "green" | "copper" | "warning" | "danger" | "eligible";
export type BadgeShape = "chip" | "pill";

// Discriminated by `appearance`, not a free {tone, appearance, shape}
// triple: each tone only has the tokens a given appearance needs for some
// combinations (no wash/line pair for `eligible`; no dashed-worthy border
// for `neutral`/`eligible`), so those combinations are a compile error
// instead of silently falling back to something the prototype never shows.
type SoftBadgeVariant = { appearance: "soft"; tone: Exclude<BadgeTone, "eligible">; shape?: BadgeShape };
type SolidBadgeVariant = { appearance: "solid"; tone: BadgeTone; shape?: BadgeShape };
type DashedBadgeVariant = { appearance: "dashed"; tone: "green" | "copper" | "warning" | "danger"; shape?: BadgeShape };
type OnDarkBadgeVariant = { appearance: "onDark" };
type TintedBadgeVariant = { appearance: "tinted"; tone: "warning" | "eligible" | "danger" };

type BadgeVariant = SoftBadgeVariant | SolidBadgeVariant | DashedBadgeVariant | OnDarkBadgeVariant | TintedBadgeVariant;

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "color"> & BadgeVariant;

const SHAPE_RADIUS: Record<BadgeShape, string> = {
  chip: "rounded-chip",
  pill: "rounded-full",
};

// `.c-head .badge` without its 8% glass fill — the only onDark source. On
// that fill on-dark-dim read under AA in both themes; on the bare ink head
// it does not (docs/design-tokens.md's "Contrast").
const ONDARK_CLASSES =
  "rounded-chip border border-glass/[0.14] px-[9px] py-[3px] text-[10.5px] font-semibold tracking-[0.05em] text-on-dark-dim";

// `.inv-status` / `.inv-status.paid` reproduced exactly: a 22% tint of the
// tone with the full tone as text and border, on the dark invoice head. Void
// has no reference class; it takes the same look in danger.
const TINTED_CLASSES = "rounded-chip border px-2.5 py-[3px] text-[11px] font-bold tracking-[0.05em]";
const TINTED_LOOK: Record<"warning" | "eligible" | "danger", string> = {
  warning: "border-warning bg-[color-mix(in_srgb,var(--color-warning)_22%,transparent)] text-warning",
  eligible: "border-eligible bg-[color-mix(in_srgb,var(--color-eligible)_22%,transparent)] text-eligible",
  danger: "border-danger bg-[color-mix(in_srgb,var(--color-danger)_22%,transparent)] text-danger",
};

// Soft chip sizing is shared across its four sources (`.brief-h .tag` /
// `.tag.warn`, `.rx-head .c`, `.set-row .mode`, `.inv-status`) rather than
// reproduced per class — their own metrics cluster within a point or two of
// each other (10.5–11px / 600–700 weight / 2-3px×8-10px padding).
// `.inv-status`'s own border is the full, saturated tone color rather than
// the lighter "-line"/color-mix tint the other three use; SOFT_LOOK below
// folds it into that same lighter border, for the same reason Button's
// secondary/danger variants use a "-line" border rather than the full tone.
const SOFT_CHIP_SIZE = "px-2 py-0.5 text-[10.5px] font-semibold";

// `.msg-tpl .badge` (+ `.auto`/`.manual`) reproduced exactly — the only
// solid chip source.
const SOLID_CHIP_SIZE = "px-[6px] py-0.5 text-[9.5px] font-bold tracking-[0.03em]";

// `.slot .state` reproduced exactly — the only pill source; soft, solid and
// dashed pills (done/arrived+in-room+no-show/cancelled) all share it.
const PILL_SIZE = "px-[11px] py-1 text-[11px] font-bold tracking-[0.02em]";

function sizeClasses(appearance: "soft" | "solid" | "dashed", shape: BadgeShape): string {
  if (shape === "pill") {
    return PILL_SIZE;
  }
  return appearance === "solid" ? SOLID_CHIP_SIZE : SOFT_CHIP_SIZE;
}

const SOFT_LOOK: Record<Exclude<BadgeTone, "eligible">, string> = {
  neutral: "border border-rule bg-field text-muted",
  green: "border border-green-line bg-green-wash text-green",
  copper: "border border-copper-line bg-copper-wash text-copper-ink",
  warning: "border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-warning-wash text-warning",
  danger: "border border-danger-line bg-danger-wash text-danger",
};

// `.slot.arrived .state` and `.slot.in-room .state` are gradients
// (eligible→green-2, copper→copper-2); every other solid tone/shape is a
// flat fill, matching `.msg-tpl .badge`/`.badge.auto`/`.badge.manual` and
// `.slot.no-show .state`, none of which use a gradient. Text is on-fill,
// except on-copper on the copper tone (docs/design-tokens.md's "Contrast").
const SOLID_LOOK: Record<BadgeTone, { chip: string; pill: string }> = {
  neutral: { chip: "bg-muted text-on-fill", pill: "bg-muted text-on-fill" },
  green: { chip: "bg-green text-on-fill", pill: "bg-green text-on-fill" },
  copper: {
    chip: "bg-copper text-on-copper",
    pill: "bg-[linear-gradient(135deg,var(--color-copper)_0%,var(--color-copper-2)_100%)] text-on-copper",
  },
  warning: { chip: "bg-warning text-on-fill", pill: "bg-warning text-on-fill" },
  danger: { chip: "bg-danger text-on-fill", pill: "bg-danger text-on-fill" },
  eligible: {
    chip: "bg-eligible text-on-fill",
    pill: "bg-[linear-gradient(135deg,var(--color-eligible)_0%,var(--color-green-2)_100%)] text-on-fill",
  },
};

// `.slot.cancelled .state` reproduced exactly (dashed danger-line border,
// transparent fill); green/copper/warning have no dashed source in the
// prototype but follow the same pattern for a consistent, typed set.
const DASHED_LOOK: Record<"green" | "copper" | "warning" | "danger", string> = {
  green: "border border-dashed border-green-line bg-transparent text-green",
  copper: "border border-dashed border-copper-line bg-transparent text-copper-ink",
  warning: "border border-dashed border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-transparent text-warning",
  danger: "border border-dashed border-danger-line bg-transparent text-danger",
};

/**
 * Prototype sources (docs/reference/clintra-prototype.html): `.c-head
 * .badge` (onDark), `.brief-h .tag` / `.tag.warn`, `.inv-status` /
 * `.inv-status.paid`, `.rx-head .c`, `.set-row .mode`, `.msg-tpl .badge`
 * (+ `.auto`/`.manual` — `.auto`'s own "تلقائي" text is shown as "مقترح"
 * per the settled deviation), `.slot .state` on `.arrived`/`.in-room`/
 * `.done`/`.no-show`/`.cancelled`.
 *
 * One component typed by tone/appearance/shape rather than by source class
 * — see the type union above for which combinations are even possible.
 * Does not map visit status to these props on its own; that mapping
 * belongs to the day screen, not this shared component — the gallery's
 * five `.slot .state` demos just pass the matching props directly.
 */
export default function Badge(props: BadgeProps) {
  if (props.appearance === "onDark") {
    const { className, children, ...rest } = props;
    const classes = [ONDARK_CLASSES, className ?? ""].filter(Boolean).join(" ");
    return (
      <span className={classes} {...omitVariantProps(rest)}>
        {children}
      </span>
    );
  }

  if (props.appearance === "tinted") {
    const { tone, className, children, ...rest } = props;
    const classes = [TINTED_CLASSES, TINTED_LOOK[tone], className ?? ""].filter(Boolean).join(" ");
    return (
      <span className={classes} {...omitVariantProps(rest)}>
        {children}
      </span>
    );
  }

  const { appearance, tone, shape = appearance === "dashed" ? "pill" : "chip", className, children, ...rest } = props;

  const look =
    appearance === "soft"
      ? SOFT_LOOK[tone as Exclude<BadgeTone, "eligible">]
      : appearance === "dashed"
        ? DASHED_LOOK[tone as "green" | "copper" | "warning" | "danger"]
        : SOLID_LOOK[tone][shape];

  const classes = [SHAPE_RADIUS[shape], sizeClasses(appearance, shape), look, className ?? ""].filter(Boolean).join(" ");

  return (
    <span className={classes} {...omitVariantProps(rest)}>
      {children}
    </span>
  );
}

// `...rest` above still carries no variant fields (they were all
// destructured out above it), but TypeScript can't see that through the
// union — this no-op cast just satisfies <span>'s prop types.
function omitVariantProps(rest: object): HTMLAttributes<HTMLSpanElement> {
  return rest as HTMLAttributes<HTMLSpanElement>;
}
