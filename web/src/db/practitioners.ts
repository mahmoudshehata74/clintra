import { Role } from "../domain/role";
import {
  storedPractitionerTitle,
  storedSyndicateNumber,
  SYNDICATE_NUMBER_MAX_LENGTH,
} from "../domain/practitionerProfile";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type Practitioner } from "./types";

export const PractitionerProfileError = {
  /** The acting membership is not an owner. */
  NotOwner: "not_owner",
  NotFound: "practitioner_not_found",
  /** The name is empty once trimmed. */
  NameRequired: "practitioner_name_required",
  /** The syndicate number is longer than practitioners.syndicate_number holds. */
  SyndicateNumberTooLong: "practitioner_syndicate_number_too_long",
} as const;

export type PractitionerProfileError = (typeof PractitionerProfileError)[keyof typeof PractitionerProfileError];

/** What the owner types for one practitioner in settings. */
export interface PractitionerProfileFields {
  full_name: string;
  title: string;
  syndicate_number: string;
}

/**
 * Edits a practitioner's name, title and syndicate number (docs/schema.md's
 * v18 additions) through mutate() — audited ("عدّل بيانات الطبيب", never a
 * field value) and queued for sync, where the server accepts an update to
 * these three columns only.
 *
 * Every value is trimmed; a blank title is stored as "" (the column is NOT
 * NULL) and a blank syndicate number as null (domain/practitionerProfile.ts).
 * Refuses, writing nothing, when the acting membership is not an owner
 * (`not_owner` — the server does not check this, as for every other settings
 * write: api/docs/rls.md's "Practitioners"), when the practitioner does not
 * exist, when the name is blank, or when the syndicate number is longer than
 * 50 characters. When nothing changes, writes nothing at all — no audit row,
 * no sync op — and returns null; otherwise returns the audit_log id of the
 * write. The read and the write share one transaction, so the no-op check is
 * never made against a value another write has since replaced.
 */
export async function updatePractitionerProfile(
  db: ClintraDatabase,
  practitionerId: string,
  fields: PractitionerProfileFields,
): Promise<string | null> {
  const fullName = fields.full_name.trim();
  const title = storedPractitionerTitle(fields.title);
  const syndicateNumber = storedSyndicateNumber(fields.syndicate_number);
  if (fullName === "") {
    throw new Error(PractitionerProfileError.NameRequired);
  }
  if (syndicateNumber !== null && syndicateNumber.length > SYNDICATE_NUMBER_MAX_LENGTH) {
    throw new Error(PractitionerProfileError.SyndicateNumberTooLong);
  }

  const actor = await resolveActingMembership(db);
  if (actor.role !== Role.Owner) {
    throw new Error(PractitionerProfileError.NotOwner);
  }

  return db.transaction("rw", db.practitioners, db.audit_log, db.sync_ops, async () => {
    const before = await db.practitioners.get(practitionerId);
    if (!before) {
      throw new Error(PractitionerProfileError.NotFound);
    }
    if (before.full_name === fullName && before.title === title && before.syndicate_number === syndicateNumber) {
      return null;
    }

    const after: Practitioner = { ...before, full_name: fullName, title, syndicate_number: syndicateNumber };
    return mutate(db, {
      table: db.practitioners,
      entity: "practitioners",
      entityId: practitionerId,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: actor.id,
      orgId: before.org_id,
    });
  });
}
