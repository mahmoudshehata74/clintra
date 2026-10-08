export type ActivationError =
  /** The code is shorter than a full "CLT-XXXX-XXXX-XXXX-XXXX" — checked before anything is sent. */
  | { kind: "incomplete_code" }
  /** registerDevice's own Arabic message, verbatim (db/registration.ts). */
  | { kind: "server"; message: string };

export interface ActivationErrorPlacement {
  /** Shown as the activation-code Field's own error. */
  code: string | undefined;
  /** Shown as the phone Field's own error. */
  phone: string | undefined;
  /** Shown under both fields, tied to neither. */
  form: string | undefined;
}

export interface ActivationErrorMessages {
  incompleteCode: string;
  /** db/registration.ts's local phone check returns exactly this text before sending anything. */
  invalidPhone: string;
}

/**
 * Where an activation failure is shown. The two checks made on the device
 * itself each belong to their own field — an incomplete code (checked
 * here) and a phone that does not normalize (checked by registerDevice
 * before any request, returning the same "رقم الموبايل غير صالح" text this
 * screen's strings hold). Any other refusal comes from the server (wrong,
 * expired or used code, a rate limit, no connection) and is shown for the
 * form as a whole: db/registration.ts deliberately never guesses which
 * field caused it.
 */
export function placeActivationError(
  error: ActivationError | null,
  messages: ActivationErrorMessages,
): ActivationErrorPlacement {
  const none = { code: undefined, phone: undefined, form: undefined };
  if (!error) {
    return none;
  }
  if (error.kind === "incomplete_code") {
    return { ...none, code: messages.incompleteCode };
  }
  if (error.message === messages.invalidPhone) {
    return { ...none, phone: error.message };
  }
  return { ...none, form: error.message };
}
