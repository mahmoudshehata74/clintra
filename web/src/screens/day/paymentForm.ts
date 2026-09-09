import { parsePoundsToPiastres, type Piastres } from "../../domain/money";
import { dayScreenStrings } from "./strings";

export interface PaymentFormState {
  amountInput: string;
}

export type PaymentFormValidation = { ok: true; amount: Piastres } | { ok: false; amountError: string };

/**
 * Validates the payment amount field: must parse as pounds, must be
 * strictly positive, and must not exceed the invoice's current remaining
 * balance — checked here for immediate in-field feedback, and re-checked
 * again inside recordPayment() itself against the invoice's live state,
 * since remaining can change between when this form last rendered and when
 * its submit actually runs.
 */
export function validatePaymentForm(state: PaymentFormState, remaining: Piastres): PaymentFormValidation {
  const parsed = parsePoundsToPiastres(state.amountInput);
  if (!parsed.ok) {
    return { ok: false, amountError: dayScreenStrings.paymentAmountInvalidError };
  }
  if (parsed.value <= 0) {
    return { ok: false, amountError: dayScreenStrings.paymentAmountNotPositiveError };
  }
  if (parsed.value > remaining) {
    return { ok: false, amountError: dayScreenStrings.paymentAmountExceedsRemainingError };
  }
  return { ok: true, amount: parsed.value };
}
