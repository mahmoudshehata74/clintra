import Ltr from "../../components/Ltr";
import type { DayCounters } from "./dayCounters";
import { dayScreenStrings } from "./strings";

export default function Counters({ counters }: { counters: DayCounters }) {
  const items: readonly (readonly [string, number])[] = [
    [dayScreenStrings.countersTotalBooked, counters.total],
    [dayScreenStrings.countersArrived, counters.arrived],
    [dayScreenStrings.countersCompleted, counters.completed],
    [dayScreenStrings.countersRemaining, counters.remaining],
  ];

  return (
    <ul className="grid grid-cols-4 gap-3">
      {items.map(([label, value]) => (
        <li key={label} className="rounded-[--radius-el] border border-line p-3 text-center">
          <span className="block text-2xl font-semibold">
            <Ltr>{value}</Ltr>
          </span>
          <span className="text-sm text-muted">{label}</span>
        </li>
      ))}
    </ul>
  );
}
