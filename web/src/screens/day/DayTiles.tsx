import type { ReactNode } from "react";

export type TileTone = "ok" | "copper" | "warn";

export interface TileData {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  /** `.tile.ok`/`.copper`/`.warn` — omit for the plain rule-coloured stripe. */
  tone?: TileTone;
}

const STRIPE_TONE: Record<TileTone | "default", string> = {
  default: "before:bg-rule",
  ok: "before:bg-eligible",
  copper: "before:bg-copper",
  warn: "before:bg-warning",
};

const VALUE_TONE: Record<TileTone | "default", string> = {
  default: "",
  ok: "text-eligible",
  copper: "text-copper",
  warn: "text-warning",
};

/** The money/consult-length tiles under the slab (prototype `.tiles`/`.tile`, #s2 — slots mode only). */
export default function DayTiles({ tiles }: { tiles: readonly TileData[] }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={
            "relative flex min-w-[170px] flex-1 flex-col gap-[3px] overflow-hidden rounded-card border border-rule bg-card px-4 py-3 shadow-s " +
            `before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:content-[''] ${STRIPE_TONE[tile.tone ?? "default"]}`
          }
        >
          <span className="text-[11px] font-semibold text-muted">{tile.label}</span>
          <span
            className={`text-xl font-bold leading-[1.1] tracking-[-0.01em] tabular-nums ${VALUE_TONE[tile.tone ?? "default"]}`}
          >
            {tile.value}
            {tile.unit && <i className="ms-1 text-[11.5px] font-semibold not-italic text-faint">{tile.unit}</i>}
          </span>
          {tile.sub && <span className="mt-px text-[10.5px] text-faint">{tile.sub}</span>}
        </div>
      ))}
    </div>
  );
}
