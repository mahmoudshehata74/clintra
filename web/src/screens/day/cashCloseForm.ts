import { parsePoundsToPiastres, type Piastres } from "../../domain/money";
import { dayScreenStrings } from "./strings";

export interface CashCloseFormState {
  totalCollectedInput: string;
  note: string;
}

export type CashCloseFormValidation =
  | { ok: true; totalCollected: Piastres; difference: Piastres; note: string | null }
  | { ok: false; collectedError: string | null; noteError: string | null };

/**
 * Validates the cash-close form: the collected amount must parse as pounds,
 * and the note is required — but only once the computed difference is
 * non-zero, per the specification. A zero difference never requires a note,
 * even if one was typed; it is still kept if present.
 */
export function validateCashCloseForm(state: CashCloseFormState, expected: Piastres): CashCloseFormValidation {
  const parsed = parsePoundsToPiastres(state.totalCollectedInput);
  if (!parsed.ok) {
    return { ok: false, collectedError: dayScreenStrings.cashCloseCollectedInvalidError, noteError: null };
  }

  const difference = (parsed.value - expected) as Piastres;
  const trimmedNote = state.note.trim();
  if (difference !== 0 && !trimmedNote) {
    return { ok: false, collectedError: null, noteError: dayScreenStrings.cashCloseNoteRequiredError };
  }

  return { ok: true, totalCollected: parsed.value, difference, note: trimmedNote ? trimmedNote : null };
}
