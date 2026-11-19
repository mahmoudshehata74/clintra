import referenceData from "../../../contract/reference-data.json";
import type { ClintraDatabase } from "./database";
import type { FormDefinition, SpecialtyTemplate } from "./types";

/** contract/reference-data.json's rows, as this device stores them. */
export const CONTRACT_SPECIALTY_TEMPLATES = referenceData.specialty_templates as SpecialtyTemplate[];
export const CONTRACT_FORM_DEFINITIONS = referenceData.form_definitions as FormDefinition[];

/**
 * Puts contract/reference-data.json's rows — the "general" specialty
 * template and its current form definition — on this device when they are
 * missing. Neither table syncs (sync/syncableTables.ts): the rows are
 * server-owned, system-wide and fixed, seeded by the API's own migration
 * under these exact ids. The demo seed writes them; a registered device
 * otherwise never held them, so every reader of the general form
 * (db/visitForm.ts's findGeneralFormDefinition — the patient profile, the
 * doctor's day, care plans, prescriptions) threw
 * "general_specialty_template_not_found". Raw writes: no sync op and no
 * audit row, as for any reference data. A row already present is left as
 * it is.
 */
export async function ensureContractReferenceData(db: ClintraDatabase): Promise<void> {
  await db.transaction("rw", [db.specialty_templates, db.form_definitions], async () => {
    for (const template of CONTRACT_SPECIALTY_TEMPLATES) {
      if ((await db.specialty_templates.get(template.id)) === undefined) {
        await db.specialty_templates.put(template);
      }
    }
    for (const definition of CONTRACT_FORM_DEFINITIONS) {
      if ((await db.form_definitions.get(definition.id)) === undefined) {
        await db.form_definitions.put(definition);
      }
    }
  });
}
