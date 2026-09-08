import type { ClintraDatabase } from "../../db/database";
import { createPatient, type CreatePatientResult } from "../../db/patientCreate";
import { validateNewPatientForm, type NewPatientFormState } from "./newPatientForm";

export type SubmitNewPatientFormResult =
  | ({ ok: true } & CreatePatientResult)
  | { ok: false; nameError: string | null; phoneError: string | null };

/**
 * Validates the new-patient form and, only if it passes, writes the patient
 * through createPatient(). Composes the pure validation in newPatientForm.ts
 * with the write in db/patientCreate.ts into one step, so a submit that
 * fails validation is guaranteed to never reach the write.
 */
export async function submitNewPatientForm(
  db: ClintraDatabase,
  orgId: string,
  form: NewPatientFormState,
): Promise<SubmitNewPatientFormResult> {
  const validation = validateNewPatientForm(form);
  if (!validation.ok) {
    return validation;
  }

  const result = await createPatient(db, {
    orgId,
    fullName: validation.fullName,
    phone: validation.phone,
  });
  return { ok: true, ...result };
}
