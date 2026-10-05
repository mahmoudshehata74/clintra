import type { ReactNode } from "react";
import ToggleChip, { type ToggleChipVariant } from "./ToggleChip";

export interface ToggleGroupOption<T extends string> {
  value: T;
  label: ReactNode;
  /** `.pt-tab .b` — only meaningful when the group's variant is "patientTab". */
  counter?: string | number;
}

export interface ToggleGroupProps<T extends string> {
  variant: ToggleChipVariant;
  value: T;
  onChange: (value: T) => void;
  options: readonly ToggleGroupOption<T>[];
  className?: string;
}

// Prototype sources (docs/reference/clintra-prototype.html): `.svc-row`,
// `.filts`, `.set-tabs`, `.pt-tabs`, `.msg-ch-toggle`. Only each one's own
// gap and scroll behavior is reproduced here — the bar padding, background
// and border-bottom `.filts`/`.set-tabs`/`.pt-tabs` have as a sticky
// toolbar is screen chrome, owned by whichever screen places the group, not
// by this shared component. `.msg-ch-toggle`'s own background/border IS
// kept, since that's the segmented control's own track, intrinsic to how a
// two-way toggle reads, not page layout.
const GROUP_LAYOUT: Record<ToggleChipVariant, string> = {
  service: "flex flex-wrap gap-[6px]",
  filter: "flex flex-wrap gap-[6px]",
  tab: "flex gap-1",
  patientTab: "flex gap-0.5 overflow-x-auto",
  channel: "flex gap-1 rounded-control border border-rule bg-field p-[3px]",
};

/** Single-selection over a row of ToggleChip — controlled (value/onChange). Arrow-key navigation is not implemented. */
export default function ToggleGroup<T extends string>({ variant, value, onChange, options, className }: ToggleGroupProps<T>) {
  const classes = [GROUP_LAYOUT[variant], className ?? ""].filter(Boolean).join(" ");

  return (
    <div role="group" className={classes}>
      {options.map((option) => (
        <ToggleChip
          key={option.value}
          variant={variant}
          pressed={option.value === value}
          counter={option.counter}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </ToggleChip>
      ))}
    </div>
  );
}
