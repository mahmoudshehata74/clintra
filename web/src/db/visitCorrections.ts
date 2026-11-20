import { id } from "../domain/id";
import { Role } from "../domain/role";
import { VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { getDeviceId } from "./deviceRegistration";
import { runAtomicMutations } from "./mutate";
import { AuditAction, type Membership, type Visit, type VisitFormData, type VisitFormRevision } from "./types";
import { EMPTY_VISIT_FORM_VALUES, findGeneralFormDefinition, findVisitFormData, type VisitFormFieldValues } from "./visitForm";

// Clinical corrections after completion (docs/design-clinical-corrections.md,
// docs/schema.md's v28 additions): once a visit is completed, its form changes
// only through correctVisitForm, with a reason, and the version it replaces is
// kept in visit_form_revisions.

/** Why correctVisitForm refused, before writing anything. */
export const CorrectionError = {
  VisitNotFound: "visit_not_found",
  /** The visit is not completed: the ordinary autosave applies. */
  NotCompleted: "not_completed",
  /** Neither the visit's own doctor nor an owner. */
  NotAllowed: "not_allowed",
  /** The reason is shorter than 3 characters once trimmed. */
  ReasonRequired: "reason_required",
  /** The reason is longer than 500 characters once trimmed. */
  ReasonTooLong: "reason_too_long",
  /** The corrected form is the form as it stands. */
  Unchanged: "unchanged",
} as const;

export type CorrectionError = (typeof CorrectionError)[keyof typeof CorrectionError];

export const CORRECTION_REASON_MIN_LENGTH = 3;
export const CORRECTION_REASON_MAX_LENGTH = 500;

/**
 * Who may correct a completed visit's form: its own doctor (a membership
 * tied to the visit's practitioner) and an owner — never another doctor, an
 * assistant or a manager. The server holds the same rule
 * (SyncOpApplier's correction rule, visit_form_revision_check()).
 */
export function canCorrectVisit(
  membership: Pick<Membership, "role" | "practitioner_id"> | undefined,
  visit: Pick<Visit, "status" | "practitioner_id">,
): boolean {
  if (!membership || visit.status !== VisitStatus.Completed) {
    return false;
  }
  return membership.role === Role.Owner || membership.practitioner_id === visit.practitioner_id;
}

/** The general form's two fields as they are compared and stored: trimmed, "" for none. */
function trimmedValues(values: VisitFormFieldValues): VisitFormFieldValues {
  return { complaint: values.complaint.trim(), diagnosis: values.diagnosis.trim() };
}

/** A stored form's two fields as compared: a missing or null value reads as "" (the server stores a pushed "" as null). */
function comparableValues(data: unknown): VisitFormFieldValues {
  const record = (data ?? {}) as Partial<Record<keyof VisitFormFieldValues, string | null>>;
  return { complaint: (record.complaint ?? "").trim(), diagnosis: (record.diagnosis ?? "").trim() };
}

/**
 * Corrects a completed visit's form, with a reason. In one transaction, as
 * one sync group the server applies whole or not at all: the form row's
 * empty create when the visit has none yet, the visit_form_revisions row
 * (the form as it stands, `previous_data` at `replaced_rev`, and the
 * corrected `new_data`, the trimmed reason, the next revision number, the
 * acting membership, this device), then the form row's update to the
 * corrected values. Nothing else is written: no invoice, payment or visit
 * status. Offline it waits in the queue like any other write.
 *
 * Refuses before writing anything (CorrectionError): a visit that is not
 * completed, an actor who is neither its doctor nor an owner, a reason
 * shorter than 3 or longer than 500 characters once trimmed, and a
 * correction that changes nothing (compared trimmed, as the server stores
 * them).
 */
export async function correctVisitForm(
  db: ClintraDatabase,
  visitId: string,
  values: VisitFormFieldValues,
  reason: string,
): Promise<VisitFormRevision> {
  const actor = await resolveActingMembership(db);
  const visit = await db.visits.get(visitId);
  if (!visit) {
    throw new Error(CorrectionError.VisitNotFound);
  }
  if (visit.status !== VisitStatus.Completed) {
    throw new Error(CorrectionError.NotCompleted);
  }
  if (!canCorrectVisit(actor, visit)) {
    throw new Error(CorrectionError.NotAllowed);
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length < CORRECTION_REASON_MIN_LENGTH) {
    throw new Error(CorrectionError.ReasonRequired);
  }
  if (trimmedReason.length > CORRECTION_REASON_MAX_LENGTH) {
    throw new Error(CorrectionError.ReasonTooLong);
  }
  const corrected = trimmedValues(values);

  return runAtomicMutations(
    db,
    [db.visits, db.visit_form_data, db.visit_form_revisions, db.specialty_templates, db.form_definitions],
    async (write) => {
      const formDefinition = await findGeneralFormDefinition(db);
      const existing = await findVisitFormData(db, visitId, formDefinition.id);
      const previousData = existing?.data ?? EMPTY_VISIT_FORM_VALUES;
      const previous = comparableValues(previousData);
      if (previous.complaint === corrected.complaint && previous.diagnosis === corrected.diagnosis) {
        throw new Error(CorrectionError.Unchanged);
      }

      const groupId = id();
      let form: VisitFormData;
      if (existing) {
        form = existing;
      } else {
        form = { id: id(), visit_id: visitId, form_definition_id: formDefinition.id, data: { ...EMPTY_VISIT_FORM_VALUES }, rev: 1 };
        await write({
          table: db.visit_form_data,
          entity: "visit_form_data",
          entityId: form.id,
          action: AuditAction.Create,
          before: null,
          after: form,
          actorMembershipId: actor.id,
          orgId: visit.org_id,
          groupId,
        });
      }

      const earlier = await db.visit_form_revisions.where("visit_form_data_id").equals(form.id).toArray();
      const revision: VisitFormRevision = {
        id: id(),
        org_id: visit.org_id,
        visit_id: visitId,
        visit_form_data_id: form.id,
        revision_no: earlier.reduce((last, row) => Math.max(last, row.revision_no), 0) + 1,
        // The rev the server will hold when this arrives: sync/baseRevChain.ts
        // re-derives it at push time from the update below, whose base_rev
        // follows this device's own unsent writes of the row.
        replaced_rev: form.rev,
        previous_data: previousData,
        new_data: corrected,
        reason: trimmedReason,
        corrected_by: actor.id,
        corrected_at: new Date().toISOString(),
        device_id: getDeviceId(),
        rev: 1,
      };
      await write({
        table: db.visit_form_revisions,
        entity: "visit_form_revisions",
        entityId: revision.id,
        action: AuditAction.Create,
        before: null,
        after: revision,
        actorMembershipId: actor.id,
        orgId: visit.org_id,
        groupId,
      });

      await write({
        table: db.visit_form_data,
        entity: "visit_form_data",
        entityId: form.id,
        action: AuditAction.Update,
        before: form,
        after: { ...form, data: corrected },
        actorMembershipId: actor.id,
        orgId: visit.org_id,
        groupId,
      });
      return revision;
    },
  );
}
