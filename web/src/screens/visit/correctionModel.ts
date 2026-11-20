import { CorrectionError } from "../../db/visitCorrections";
import type { VisitFormRevision } from "../../db/types";
import { formatSlashDate } from "../../domain/slashDate";
import { clockTimeInCairo, todayInCairo } from "../../domain/time";
import { visitCorrectionStrings as T } from "./strings";

// Pure derivations behind corrections after completion
// (docs/design-clinical-corrections.md section 3.3): the history sheet's
// entries, the chip's count and the writer's refusals as Arabic lines. None
// reads the database or the clock on its own.

/** One field a correction changed: its label and its text before and after ("—" for none). */
export interface CorrectionChange {
  label: string;
  before: string;
  after: string;
}

/** One entry of "سجل التعديلات". */
export interface CorrectionHistoryEntry {
  id: string;
  /** "20 / 11 / 2026 · 14:05", Cairo time. */
  when: string;
  /** "عدّلها {name}". */
  by: string;
  /** "السبب: {reason}". */
  reason: string;
  /** Each field that changed, complaint first. */
  changes: CorrectionChange[];
}

const FIELDS = [
  { key: "complaint", label: T.fieldComplaint },
  { key: "diagnosis", label: T.fieldDiagnosis },
] as const;

/** A stored form's field as text: missing or null (the server's pushed "") reads as "". */
function fieldText(data: unknown, key: string): string {
  const value = ((data ?? {}) as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * "سجل التعديلات": every revision of the visit's form, newest first (by
 * revision number, then time), each with when, who and why, and the fields
 * it changed with their text before and after. `names` maps a membership id
 * to the staff member's name.
 */
export function buildCorrectionHistory(
  revisions: readonly VisitFormRevision[],
  names: ReadonlyMap<string, string>,
): CorrectionHistoryEntry[] {
  return [...revisions]
    .sort((a, b) => b.revision_no - a.revision_no || b.corrected_at.localeCompare(a.corrected_at))
    .map((revision) => ({
      id: revision.id,
      when: `${formatSlashDate(todayInCairo(new Date(revision.corrected_at)))} · ${clockTimeInCairo(revision.corrected_at)}`,
      by: `${T.correctedByPrefix} ${names.get(revision.corrected_by) ?? T.unknownStaff}`,
      reason: `${T.reasonPrefix} ${revision.reason}`,
      changes: FIELDS.flatMap(({ key, label }) => {
        const before = fieldText(revision.previous_data, key);
        const after = fieldText(revision.new_data, key);
        return before === after ? [] : [{ label, before: before || T.emptyValue, after: after || T.emptyValue }];
      }),
    }));
}

/** "سجل التعديلات (2)". */
export function correctionHistoryLabel(count: number): string {
  return `${T.historyAction} (${count})`;
}

/** A thrown correctVisitForm error as the visible Arabic line. */
export function correctionErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case CorrectionError.NotAllowed:
      return T.errorNotAllowed;
    case CorrectionError.ReasonRequired:
      return T.errorReasonRequired;
    case CorrectionError.ReasonTooLong:
      return T.errorReasonTooLong;
    case CorrectionError.Unchanged:
      return T.errorUnchanged;
    default:
      return T.errorFailed;
  }
}
