import type { ReactNode } from "react";

export type SlabCellTone = "arrived" | "miss" | "copper";

export interface SlabCell {
  label: string;
  value: ReactNode;
  /** `.cell.arrived`/`.miss`/`.copper` — omit for the plain on-dark value colour. */
  tone?: SlabCellTone;
}

export interface DaySlabProps {
  heroLabel: string;
  heroValue: ReactNode;
  /** `.hero .v i` — a short unit word after the number, e.g. "مريض" or "من 8". */
  heroUnit?: ReactNode;
  heroCaption: ReactNode;
  cells: readonly SlabCell[];
  /** 0-100 — the split bar's filled share. */
  splitSharePercent: number;
  splitCompletedText: ReactNode;
  splitRemainingText: ReactNode;
  /** `.slab-act` — the action row's own children (next-up button, delay trigger, cash-close, kbd…), rendered as-is. */
  actions?: ReactNode;
}

const CELL_VALUE_TONE: Record<SlabCellTone | "default", string> = {
  default: "",
  arrived: "text-green-2",
  miss: "text-danger",
  copper: "text-copper-2",
};

/**
 * The day's summary slab (prototype `.slab`, `.slab-in`, `.hero`, `.side`,
 * `.cell`, `.split`, `.split-bar`, `.split-leg`, `.sw`, `.slab-act`):
 * generic over slots vs. queue mode — both only ever differ in which
 * numbers and actions they pass in, never in this shape. The prototype's
 * `.slab` background blends `--ink-3` into a literal one-off hex
 * (`#0D2621`) via a radial accent over a base gradient; the base gradient
 * here reuses the exact ink→ink-2 gradient already established everywhere
 * else in this component set (Card.tsx's head, Button.tsx's onDark
 * variants) instead of introducing that one hex value, per docs/design-
 * rule.md's token-only rule — visually indistinguishable at this size.
 */
export default function DaySlab({
  heroLabel,
  heroValue,
  heroUnit,
  heroCaption,
  cells,
  splitSharePercent,
  splitCompletedText,
  splitRemainingText,
  actions,
}: DaySlabProps) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-panel text-on-dark shadow-l " +
        "before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:content-[''] " +
        "before:bg-[linear-gradient(to_left,var(--color-copper)_0%,var(--color-green-2)_45%,transparent_85%)] " +
        "bg-[radial-gradient(130%_150%_at_90%_-10%,var(--color-ink-3)_0%,transparent_60%),linear-gradient(115deg,var(--color-ink)_0%,var(--color-ink-2)_130%)]"
      }
    >
      <div className="relative flex flex-wrap items-stretch">
        <div className="min-w-[200px] flex-none px-6 py-[22px]">
          <span className="mb-[7px] block text-[10.5px] font-bold uppercase tracking-[0.1em] text-on-dark-dim">
            {heroLabel}
          </span>
          <span className="flex items-baseline gap-2 text-[46px] font-bold leading-none tracking-[-0.03em] tabular-nums">
            {heroValue}
            {heroUnit && <i className="text-[13px] font-semibold not-italic text-copper-2">{heroUnit}</i>}
          </span>
          <div className="mt-2 text-[11.5px] text-on-dark-dim">{heroCaption}</div>
        </div>
        <div className="flex flex-1 flex-wrap border-s border-white/[0.10]">
          {cells.map((cell) => (
            <div
              key={cell.label}
              className="flex min-w-[110px] flex-1 flex-col justify-center gap-1 border-s border-white/[0.07] px-5 py-[22px] first:border-s-0"
            >
              <span className="text-[10.5px] font-semibold tracking-[0.05em] text-on-dark-dim">{cell.label}</span>
              <span className={`text-2xl font-semibold leading-none tabular-nums ${CELL_VALUE_TONE[cell.tone ?? "default"]}`}>
                {cell.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative px-6 pb-5">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.10]">
          <span
            className="block bg-[linear-gradient(90deg,var(--color-green)_0%,var(--color-green-2)_100%)]"
            style={{ width: `${splitSharePercent}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-on-dark-dim">
          <span className="flex items-center gap-1.5">
            <i className="block h-2 w-2 flex-none rounded-[2.5px] bg-[linear-gradient(90deg,var(--color-green)_0%,var(--color-green-2)_100%)]" />
            {splitCompletedText}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="block h-2 w-2 flex-none rounded-[2.5px] bg-white/[0.24]" />
            {splitRemainingText}
          </span>
        </div>
      </div>

      {actions && <div className="relative flex flex-wrap items-center gap-2 px-6 pb-[18px]">{actions}</div>}
    </div>
  );
}
