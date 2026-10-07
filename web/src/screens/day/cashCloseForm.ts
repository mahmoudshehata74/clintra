import { parsePoundsToPiastres, type Piastres } from "../../domain/money";
import { dayScreenStrings } from "./strings";

export interface CashCloseFormState {
  totalCollectedInput: string;
  note: string;
  /** How many still-booked/confirmed visits are past due — see pastDueVisits.ts. */
  pastDueCount: number;
  /** The "عارف إنهم ما حضروش" checkbox: lets the close proceed with the list non-empty, without changing any visit. */
  acknowledgedPastDue: boolean;
}

export type CashCloseFormValidation =
  | { ok: true; totalCollected: Piastres; difference: Piastres; note: string | null }
  | { ok: false; collectedError: string | null; noteError: string | null; pastDueError: string | null };

/**
 * Validates the cash-close form. Checked in order: the past-due gate first
 * (closing is refused outright while visits are still past due and
 * unacknowledged, before either money field is even considered), then the
 * collected amount must parse as pounds, then the note — required only once
 * the computed difference is non-zero. A zero difference never requires a
 * note, even if one was typed; it is still kept if present.
 */
export function validateCashCloseForm(state: CashCloseFormState, expected: Piastres): CashCloseFormValidation {
  if (state.pastDueCount > 0 && !state.acknowledgedPastDue) {
    return { ok: false, collectedError: null, noteError: null, pastDueError: dayScreenStrings.cashClosePastDueBlockedError };
  }

  const parsed = parsePoundsToPiastres(state.totalCollectedInput);
  if (!parsed.ok) {
    return { ok: false, collectedError: dayScreenStrings.cashCloseCollectedInvalidError, noteError: null, pastDueError: null };
  }

  const difference = (parsed.value - expected) as Piastres;
  const trimmedNote = state.note.trim();
  if (difference !== 0 && !trimmedNote) {
    return { ok: false, collectedError: null, noteError: dayScreenStrings.cashCloseNoteRequiredError, pastDueError: null };
  }

  return { ok: true, totalCollected: parsed.value, difference, note: trimmedNote ? trimmedNote : null };
}
