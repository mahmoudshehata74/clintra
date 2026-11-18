import { parsePoundsToPiastres, type Piastres } from "../../domain/money";
import { dayScreenStrings } from "./strings";

export interface CashCloseFormState {
  /** "رصيد أول اليوم": the drawer's opening float, in pounds; starts at "0". */
  openingInput: string;
  totalCollectedInput: string;
  note: string;
  /** How many still-booked/confirmed visits are past due — see pastDueVisits.ts. */
  pastDueCount: number;
  /** The "عارف إنهم ما حضروش" checkbox: lets the close proceed with the list non-empty, without changing any visit. */
  acknowledgedPastDue: boolean;
}

export type CashCloseFormValidation =
  | { ok: true; openingAmount: Piastres; totalCollected: Piastres; difference: Piastres; note: string | null }
  | { ok: false; openingError: string | null; collectedError: string | null; noteError: string | null; pastDueError: string | null };

/** The opening float as typed: blank reads as 0; otherwise pounds, or null when it does not parse. */
export function parseOpeningAmount(input: string): Piastres | null {
  if (input.trim() === "") {
    return 0 as Piastres;
  }
  const parsed = parsePoundsToPiastres(input);
  return parsed.ok ? parsed.value : null;
}

/** Expected cash in the drawer: the opening float plus the cash the day collected. */
export function expectedCash(opening: Piastres, collected: Piastres): Piastres {
  return (opening + collected) as Piastres;
}

/**
 * Validates the cash-close form against the cash the day collected (the
 * paid sum of its invoices, db/cashClose.ts). Checked in order: the past-due
 * gate first (closing is refused outright while visits are still past due
 * and unacknowledged, before any money field is even considered), then the
 * opening float must parse as pounds (blank is 0), then the counted amount,
 * then the note — required only once the difference (counted minus opening
 * plus collected) is non-zero. A zero difference never requires a note,
 * even if one was typed; it is still kept if present.
 */
export function validateCashCloseForm(state: CashCloseFormState, collected: Piastres): CashCloseFormValidation {
  const refused = { ok: false, openingError: null, collectedError: null, noteError: null, pastDueError: null } as const;
  if (state.pastDueCount > 0 && !state.acknowledgedPastDue) {
    return { ...refused, pastDueError: dayScreenStrings.cashClosePastDueBlockedError };
  }

  const opening = parseOpeningAmount(state.openingInput);
  if (opening === null) {
    return { ...refused, openingError: dayScreenStrings.cashCloseOpeningInvalidError };
  }

  const parsed = parsePoundsToPiastres(state.totalCollectedInput);
  if (!parsed.ok) {
    return { ...refused, collectedError: dayScreenStrings.cashCloseCollectedInvalidError };
  }

  const difference = (parsed.value - expectedCash(opening, collected)) as Piastres;
  const trimmedNote = state.note.trim();
  if (difference !== 0 && !trimmedNote) {
    return { ...refused, noteError: dayScreenStrings.cashCloseNoteRequiredError };
  }

  return { ok: true, openingAmount: opening, totalCollected: parsed.value, difference, note: trimmedNote ? trimmedNote : null };
}
