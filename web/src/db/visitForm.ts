import { GENERAL_SPECIALTY_KEY } from "../domain/specialtyTemplate";
import { id } from "../domain/id";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type FormDefinition, type VisitFormData } from "./types";

/** The general form's two v1 fields — see docs/schema.md's form_definitions/visit_form_data section. */
export type VisitFormFieldKey = "complaint" | "diagnosis";

export interface VisitFormFieldValues {
  complaint: string;
  diagnosis: string;
}

export const EMPTY_VISIT_FORM_VALUES: VisitFormFieldValues = { complaint: "", diagnosis: "" };

export interface VisitFormSchemaField {
  key: VisitFormFieldKey;
  label: string;
}

/** The shape written into form_definitions.schema — declarative field metadata, not consumed by the UI, which hardcodes the two fields per v1 scope. */
export interface VisitFormSchema {
  fields: readonly VisitFormSchemaField[];
}

/**
 * The one current form_definition for the "general" specialty template. Both
 * stub tables are tiny (a handful of rows at most in v1 — no specialty
 * templates screen exists to grow them), so this reads each whole table and
 * filters in memory rather than adding an index for a query that never scans
 * more than a few rows.
 */
export async function findGeneralFormDefinition(db: ClintraDatabase): Promise<FormDefinition> {
  const templates = await db.specialty_templates.toArray();
  const generalTemplate = templates.find((template) => template.key === GENERAL_SPECIALTY_KEY);
  if (!generalTemplate) {
    throw new Error("general_specialty_template_not_found");
  }

  const definitions = await db.form_definitions.toArray();
  const current = definitions.find(
    (definition) => definition.template_id === generalTemplate.id && definition.is_current,
  );
  if (!current) {
    throw new Error("general_form_definition_not_found");
  }
  return current;
}

/** The visit's row against the current general form definition, if any field has ever been saved. */
export async function findVisitFormData(
  db: ClintraDatabase,
  visitId: string,
  formDefinitionId: string,
): Promise<VisitFormData | undefined> {
  return db.visit_form_data.where("[visit_id+form_definition_id]").equals([visitId, formDefinitionId]).first();
}

/**
 * The autosave write behind every field's onBlur: creates the visit's
 * visit_form_data row on the first field ever saved, updates the same row on
 * every save after that — never a second row for the same visit, since the
 * natural key (visit_id + form_definition_id) is looked up before deciding
 * create vs update, exactly like every other write in db/. Writing does not
 * require the visit to be in any particular status — a late edit after
 * completion is deliberately allowed; completing a visit never reads or
 * requires this table (see db/visitCompletion.ts), and this never touches
 * visits, so the two stay fully decoupled in both directions.
 */
export async function saveVisitFormField(
  db: ClintraDatabase,
  visitId: string,
  field: VisitFormFieldKey,
  value: string,
): Promise<string> {
  const visit = await db.visits.get(visitId);
  if (!visit) {
    throw new Error("visit_not_found");
  }

  const formDefinition = await findGeneralFormDefinition(db);
  const existing = await findVisitFormData(db, visitId, formDefinition.id);
  const actor = await resolveActingMembership(db);

  const beforeValues = (existing?.data as VisitFormFieldValues | undefined) ?? EMPTY_VISIT_FORM_VALUES;
  const after: VisitFormData = {
    id: existing?.id ?? id(),
    visit_id: visitId,
    form_definition_id: formDefinition.id,
    data: { ...beforeValues, [field]: value } satisfies VisitFormFieldValues,
    // Unlike every other create-vs-update write in db/, this rebuilds the
    // full row from scratch either way rather than spreading `existing` —
    // so rev must be carried forward explicitly on an update (existing.rev)
    // rather than reset to 1, which would wrongly erase a row's real,
    // already-confirmed server rev the next time this same field autosaves.
    rev: existing?.rev ?? 1,
  };

  return mutate(db, {
    table: db.visit_form_data,
    entity: "visit_form_data",
    entityId: after.id,
    action: existing ? AuditAction.Update : AuditAction.Create,
    before: existing ?? null,
    after,
    actorMembershipId: actor.id,
    orgId: visit.org_id,
  });
}
