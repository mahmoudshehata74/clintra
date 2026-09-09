import type { ReactNode } from "react";
import Ltr from "../../components/Ltr";
import { VisitStatus } from "../../domain/visitStatus";
import type { Patient, Service, Visit } from "../../db/types";
import { STATUS_LABEL, statusVisual } from "./statusStyle";
import { dayScreenStrings } from "./strings";
import VisitMenu, { type VisitMenuActions } from "./VisitMenu";

interface QueueRowProps {
  visit: Visit;
  patient?: Patient;
  service?: Service;
  /** The single waiting row currently first in line — see screens/day/queueSummary.ts. */
  isNext: boolean;
  /** Null for a non-waiting row, or a waiting row shown before this label is known — see queueSummary.ts's gating. */
  expectedWaitLabel: ReactNode;
  onPrimaryAction?: () => void;
  menu?: VisitMenuActions;
  /** Resolved "recorded by" label for the visit's created_by membership — see actorLabel.ts. */
  actorLabel?: string;
}

// Rescheduled is the one status statusVisual() has no treatment for (a
// rescheduled visit no longer occupies its slot at all) — not reachable
// through any queue-mode action today, since queue rows have no "move"
// entry, but handled the same plain way slots mode would rather than
// leaving a row with no styling at all if that ever changes.
const FALLBACK_VISUAL = { containerClassName: "border border-line bg-paper", nameClassName: "", metaClassName: "text-muted" };

export default function QueueRow({
  visit,
  patient,
  service,
  isNext,
  expectedWaitLabel,
  onPrimaryAction,
  menu,
  actorLabel,
}: QueueRowProps) {
  const isTappable = Boolean(onPrimaryAction);
  const isInRoom = visit.status === VisitStatus.InRoom;
  const visual = statusVisual(visit.status) ?? FALLBACK_VISUAL;
  // "Next in line" is a priority marker layered on top of whatever the
  // row's own status treatment already is — an arrived visit that also
  // happens to be next still keeps its light-green fill, plus this ring in
  // the reference's --pm colour (--color-green-medium), distinct from
  // arrived's own fill so the two meanings never look identical. in_room is
  // never "next" — it is the current turn, not the one waiting for it.
  const nextAccentClassName = isNext && !isInRoom ? "ring-2 ring-inset ring-green-medium" : "";
  const containerClassName =
    `flex w-full items-center gap-3 rounded-[--radius-el] p-3 ${visual.containerClassName} ${nextAccentClassName}`.trim();

  const rowContent = (
    <>
      <span className={`w-8 shrink-0 text-center ${visual.metaClassName}`}>
        <Ltr>{visit.position}</Ltr>
      </span>
      <span className="flex flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span className={visual.nameClassName}>{patient?.full_name}</span>
          <span className={`text-sm ${visual.metaClassName}`}>{STATUS_LABEL[visit.status]}</span>
          {isNext && !isInRoom && (
            <span className="text-sm font-semibold text-green-medium">{dayScreenStrings.queueNextBadge}</span>
          )}
        </span>
        {service && <span className={`text-sm ${visual.metaClassName}`}>{service.name}</span>}
        {expectedWaitLabel && <span className={`text-sm ${visual.metaClassName}`}>{expectedWaitLabel}</span>}
        {actorLabel && (
          <span className={`text-sm ${visual.metaClassName}`}>
            {dayScreenStrings.recordedByPrefix} {actorLabel}
          </span>
        )}
      </span>
    </>
  );

  return (
    <li className={containerClassName}>
      {isTappable ? (
        <button type="button" onClick={onPrimaryAction} className="flex flex-1 items-center gap-3 text-start">
          {rowContent}
        </button>
      ) : (
        <div className="flex flex-1 items-center gap-3 text-start">{rowContent}</div>
      )}
      {menu && <VisitMenu actions={menu} />}
    </li>
  );
}
