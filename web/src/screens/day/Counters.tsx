import Ltr from "../../components/Ltr";
import type { DayCounters } from "./dayCounters";
import { dayScreenStrings } from "./strings";

/**
 * The day header's compact metadata-row counters (matching the design
 * reference's .fs stats bar: short "count label" text separated by "·",
 * not a card grid) — see docs/design-audit.md's screen-3 comparison. Digits
 * stay Western per settled Decision B; only the container changed.
 */
export default function Counters({ counters }: { counters: DayCounters }) {
  const items: readonly (readonly [string, number])[] = [
    [dayScreenStrings.countersTotalBooked, counters.total],
    [dayScreenStrings.countersArrived, counters.arrived],
    [dayScreenStrings.countersCompleted, counters.completed],
    [dayScreenStrings.countersRemaining, counters.remaining],
  ];

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      {items.map(([label, value], index) => (
        <span key={label} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true">·</span>}
          <span>
            <Ltr>{value}</Ltr> {label}
          </span>
        </span>
      ))}
    </p>
  );
}
