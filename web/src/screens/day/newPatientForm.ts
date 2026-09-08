import { normalizeEgyptianPhone } from "../../domain/phone";
import { dayScreenStrings } from "./strings";

export interface NewPatientFormState {
  fullName: string;
  phone: string;
  /** "من غير رقم": when true the phone field is disabled and ignored. */
  phoneOmitted: boolean;
}

export type NewPatientValidation =
  | { ok: true; fullName: string; phone: string | null }
  | { ok: false; nameError: string | null; phoneError: string | null };

/**
 * Validates the new-patient form: the name is required (after trimming), and
 * the phone — only when "من غير رقم" is not active and something was typed —
 * must normalise cleanly. Each field reports its own problem; nothing here
 * writes anything, it only decides whether the caller may proceed to write.
 */
export function validateNewPatientForm(state: NewPatientFormState): NewPatientValidation {
  const trimmedName = state.fullName.trim();
  const nameError = trimmedName ? null : dayScreenStrings.newPatientNameRequiredError;

  let phone: string | null = null;
  let phoneError: string | null = null;
  if (!state.phoneOmitted && state.phone.trim()) {
    const result = normalizeEgyptianPhone(state.phone);
    if (result.ok) {
      phone = result.value;
    } else {
      phoneError = dayScreenStrings.newPatientPhoneInvalidError;
    }
  }

  if (nameError || phoneError) {
    return { ok: false, nameError, phoneError };
  }

  return { ok: true, fullName: trimmedName, phone };
}

export interface NewPatientFormSeed {
  fullName: string;
  phone: string;
}

/**
 * Seeds the new-patient form from whatever the assistant already typed into
 * search: if it normalises as an Egyptian phone number, it seeds the phone
 * field; otherwise (including when it looks like neither a name nor a phone)
 * it seeds the name field, leaving the phone empty.
 */
export function seedNewPatientFormFromQuery(query: string): NewPatientFormSeed {
  const trimmed = query.trim();
  if (trimmed && normalizeEgyptianPhone(trimmed).ok) {
    return { fullName: "", phone: trimmed };
  }
  return { fullName: trimmed, phone: "" };
}
