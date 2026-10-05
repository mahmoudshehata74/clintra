import type { ButtonHTMLAttributes } from "react";

export type ToggleChipVariant = "service" | "filter" | "tab" | "patientTab" | "channel";

export interface ToggleChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant: ToggleChipVariant;
  pressed: boolean;
  /** `.pt-tab .b` — only rendered for variant="patientTab"; ignored otherwise. */
  counter?: string | number;
}

const BASE =
  "appearance-none cursor-pointer whitespace-nowrap font-[inherit] transition-colors duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Prototype sources (docs/reference/clintra-prototype.html): `.svc-row
 * .svc` (service), `.filt` (filter), `.set-tab` (tab), `.pt-tab` +
 * `.pt-tab .b` (patientTab), `.msg-ch-toggle button` (channel) — all real
 * buttons with aria-pressed, which this component sets from `pressed`
 * rather than taking it as a raw prop. Each variant's own padding/
 * font-size/weight is reproduced exactly; border-radius is collapsed to
 * the token scale per docs/design-rule.md (service/filter's 9px stays
 * control; tab's 8px and patientTab's 7px round to the nearest token —
 * control and chip respectively; channel's 6px is already chip).
 */
const VARIANT_LOOK: Record<ToggleChipVariant, { base: string; unpressed: string; pressed: string }> = {
  service: {
    base: "rounded-control border-[1.5px] px-[14px] py-[7px] text-[12.5px] font-semibold",
    unpressed: "border-rule bg-field text-muted",
    pressed: "border-green bg-green-wash text-green",
  },
  filter: {
    base: "rounded-control border-[1.5px] px-3 py-[5px] text-[11.5px] font-semibold",
    unpressed: "border-rule bg-card text-muted",
    pressed: "border-green bg-green-wash text-green",
  },
  tab: {
    base: "rounded-control border-0 px-4 py-2 text-[12.5px] font-semibold",
    unpressed: "bg-transparent text-muted",
    pressed: "bg-green-wash text-green shadow-[inset_0_0_0_1.5px_var(--color-green-line)]",
  },
  patientTab: {
    base: "rounded-chip border-0 px-[14px] py-[7px] text-xs font-semibold",
    unpressed: "bg-transparent text-muted",
    pressed: "bg-copper-wash text-copper",
  },
  channel: {
    base: "rounded-chip border-0 px-3 py-[6px] text-[11.5px] font-semibold",
    unpressed: "bg-transparent text-muted",
    pressed: "bg-card text-text shadow-s",
  },
};

const COUNTER_BASE = "ms-1 rounded-chip border px-[6px] py-px text-[10px] font-bold tabular-nums";
const COUNTER_LOOK = {
  unpressed: "border-rule bg-card text-muted",
  pressed: "border-copper-line bg-card text-copper",
};

export default function ToggleChip({ variant, pressed, counter, className, children, ...rest }: ToggleChipProps) {
  const look = VARIANT_LOOK[variant];
  const classes = [BASE, look.base, pressed ? look.pressed : look.unpressed, className ?? ""].filter(Boolean).join(" ");
  const counterClasses = [COUNTER_BASE, pressed ? COUNTER_LOOK.pressed : COUNTER_LOOK.unpressed].join(" ");

  return (
    <button type="button" aria-pressed={pressed} className={classes} {...rest}>
      {children}
      {variant === "patientTab" && counter !== undefined ? <span className={counterClasses}>{counter}</span> : null}
    </button>
  );
}
