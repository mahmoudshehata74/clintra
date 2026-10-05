import type { ReactNode } from "react";
import Ltr from "../../components/Ltr";
import type { Patient, Service, Visit } from "../../db/types";
import { dayScreenStrings } from "./strings";
import VisitMenu, { type VisitMenuActions } from "./VisitMenu";

export type QueueRowKind = "current" | "next" | "done" | "waiting";

interface QueueRowProps {
  visit: Visit;
  patient?: Patient;
  service?: Service;
  kind: QueueRowKind;
  /** The `.qwait` column's content — composed by the caller (QueueColumn), since it varies by kind: a duration, a plain dash, or the existing expected-wait label. */
  waitNode: ReactNode;
  onPrimaryAction?: () => void;
  /** True while this visit is in its post-tap cooldown — see advanceCooldown.ts. */
  disablePrimaryAction?: boolean;
  menu?: VisitMenuActions;
  /** Resolved "recorded by" label for the visit's created_by membership — see actorLabel.ts. */
  actorLabel?: string;
  /** Present only when this row's visit is in_room or completed — opens the visit form sheet (see VisitFormSheet.tsx). */
  onOpenVisitForm?: () => void;
  /** True for a completed visit with no visit_form_data row at all — a passive note, never a warning. */
  showEmptyFormHint?: boolean;
}

const QNUM_LOOK: Record<QueueRowKind, string> = {
  current:
    "border-transparent bg-[linear-gradient(135deg,var(--color-copper)_0%,var(--color-copper-2)_100%)] text-white shadow-[0_3px_10px_color-mix(in_srgb,var(--color-copper)_40%,transparent)]",
  next: "border-green-line bg-green-wash text-green",
  done: "border-rule bg-field text-faint",
  waiting: "border-rule bg-field text-muted",
};

/**
 * One row of the queue list (prototype `.qrow`, #s3): position | patient |
 * wait column, with the position badge (`.qnum`) coloured by whether this
 * visit is the one being seen now, next in line, already done, or still
 * waiting. Everything a row can do today — advance, the overflow menu, the
 * visit-form pill — still works exactly as before this task.
 */
export default function QueueRow({
  visit,
  patient,
  service,
  kind,
  waitNode,
  onPrimaryAction,
  disablePrimaryAction = false,
  menu,
  actorLabel,
  onOpenVisitForm,
  showEmptyFormHint = false,
}: QueueRowProps) {
  const isTappable = Boolean(onPrimaryAction);

  const rowContent = (
    <>
      <span
        className={`flex h-[38px] w-[38px] flex-none items-center justify-center rounded-control border-[1.5px] text-[15px] font-bold leading-none tracking-[-0.02em] tabular-nums ${QNUM_LOOK[kind]}`}
      >
        <Ltr>{visit.position}</Ltr>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-sm font-semibold ${kind === "done" ? "text-muted" : "text-text"}`}>
          {patient?.full_name}
        </span>
        {service && <span className="mt-px text-[11.5px] text-muted">{service.name}</span>}
        {actorLabel && <span className="mt-0.5 text-[10px] text-faint">{dayScreenStrings.recordedByPrefix} {actorLabel}</span>}
        {showEmptyFormHint && <span className="text-[10px] text-muted">{dayScreenStrings.visitFormEmptyHint}</span>}
      </span>
      <span className={`flex flex-none flex-col items-end gap-0.5 text-end text-[11px] tabular-nums text-muted [&>b]:text-[13.5px] [&>b]:font-bold [&>b]:tracking-[-0.01em] [&>b]:text-text ${kind === "current" ? "[&>b]:text-copper" : ""}`}>
        {waitNode}
      </span>
    </>
  );

  return (
    <li
      data-visit-row-id={visit.id}
      // A plain, non-visual hook (same precedent as SlotRow.tsx's own
      // data-slot-time): the redesigned row no longer shows a status word for
      // every state (booked and arrived now read identically — see
      // queueSummary.ts and this file's own doc comment), so e2e specs
      // asserting a specific transition need a way to read the real status.
      data-visit-status={visit.status}
      // Another non-visual hook, for the same reason: the prototype's own
      // `.qrow.next` carries no text badge at all (only the qnum's colour
      // changes), so "is this the next-in-line row" is otherwise unreadable
      // from the rendered page.
      data-queue-row-kind={kind}
      className="flex items-center gap-3.5 border-b border-hair px-[18px] py-[13px] last:border-b-0"
    >
      {isTappable ? (
        <button
          type="button"
          onClick={onPrimaryAction}
          disabled={disablePrimaryAction}
          className="flex flex-1 items-center gap-3.5 text-start"
        >
          {rowContent}
        </button>
      ) : (
        <div className="flex flex-1 items-center gap-3.5 text-start">{rowContent}</div>
      )}
      {onOpenVisitForm && (
        <button
          type="button"
          onClick={onOpenVisitForm}
          className="shrink-0 rounded-chip bg-field px-2 py-0.5 text-xs text-muted hover:bg-green-wash hover:text-green"
        >
          {dayScreenStrings.visitFormPillLabel}
        </button>
      )}
      {menu && <VisitMenu actions={menu} />}
    </li>
  );
}
