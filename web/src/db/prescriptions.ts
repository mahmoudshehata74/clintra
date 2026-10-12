import { id } from "../domain/id";
import { cairoYear } from "../domain/time";
import { VisitStatus } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { getMintingSeries } from "./deviceRegistration";
import { runAtomicMutations } from "./mutate";
import { AuditAction, type Membership, type Prescription, type PrescriptionItem, type Visit } from "./types";
import { findGeneralFormDefinition, findVisitFormData, readVisitFormValues } from "./visitForm";

/**
 * Every refusal the prescription writers below can throw, as the thrown
 * Error's message. Each one is raised before anything is written: the
 * checks run inside the write's own transaction, ahead of its first write,
 * so a refusal leaves no row, no audit_log row and no sync_ops row behind.
 * getMintingSeries' device_series_unknown (db/deviceRegistration.ts) is the
 * one refusal raised outside it, before the transaction even opens.
 */
export const PrescriptionError = {
  VisitNotFound: "visit_not_found",
  /** The visit is not in_room or completed, so it cannot get a new prescription. */
  VisitNotPrescribable: "visit_not_prescribable",
  /** The acting membership is not the visit's own practitioner. */
  NotPrescriber: "not_prescriber",
  /** The prescription has been printed: it and its items are locked. */
  Printed: "prescription_printed",
  /** A prescription with no items cannot be printed. */
  Empty: "prescription_empty",
  PrescriptionNotFound: "prescription_not_found",
  ItemNotFound: "prescription_item_not_found",
  NameRequired: "prescription_item_name_required",
  InstructionsRequired: "prescription_item_instructions_required",
} as const;

export type PrescriptionError = (typeof PrescriptionError)[keyof typeof PrescriptionError];

/** What the doctor types for one drug line. The optional fields read as null when left out or blank. */
export interface PrescriptionItemFields {
  name: string;
  form?: string | null;
  instructions: string;
  duration?: string | null;
  note?: string | null;
}

type ItemValues = Pick<PrescriptionItem, "name" | "form" | "instructions" | "duration" | "note">;

/**
 * The visit statuses a new prescription may be written for: during the
 * consultation (in_room) or after it (completed). Every other status —
 * not yet seen (booked, confirmed, arrived) or never seen (cancelled,
 * no_show, rescheduled) — refuses. An existing prescription keeps taking
 * items whatever its visit's status, until it is printed.
 */
const PRESCRIBABLE_STATUSES: ReadonlySet<VisitStatus> = new Set([VisitStatus.InRoom, VisitStatus.Completed]);

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Trims every field; refuses an empty name or instructions, and stores any other blank field as null. */
function normaliseItemFields(fields: PrescriptionItemFields): ItemValues {
  const name = fields.name.trim();
  if (name === "") {
    throw new Error(PrescriptionError.NameRequired);
  }
  const instructions = fields.instructions.trim();
  if (instructions === "") {
    throw new Error(PrescriptionError.InstructionsRequired);
  }
  return {
    name,
    form: optionalText(fields.form),
    instructions,
    duration: optionalText(fields.duration),
    note: optionalText(fields.note),
  };
}

/**
 * Only the visit's own practitioner writes its prescription. Enforced here,
 * on the device, for every writer below; the server's RLS admits anyone in
 * scope of the visit, a known v1 gap (docs/schema.md's v17 additions).
 */
function assertPrescriber(actor: Membership, visit: Visit): void {
  if (actor.practitioner_id === null || actor.practitioner_id !== visit.practitioner_id) {
    throw new Error(PrescriptionError.NotPrescriber);
  }
}

function assertNotPrinted(prescription: Prescription): void {
  if (prescription.printed_at !== null) {
    throw new Error(PrescriptionError.Printed);
  }
}

/** Reads a prescription and its visit for a write, refusing a missing one or a writer who is not its prescriber. */
async function loadForWrite(
  db: ClintraDatabase,
  prescriptionId: string,
  actor: Membership,
): Promise<{ prescription: Prescription; visit: Visit }> {
  const prescription = await db.prescriptions.get(prescriptionId);
  if (!prescription) {
    throw new Error(PrescriptionError.PrescriptionNotFound);
  }
  const visit = await db.visits.get(prescription.visit_id);
  if (!visit) {
    throw new Error(PrescriptionError.VisitNotFound);
  }
  assertPrescriber(actor, visit);
  return { prescription, visit };
}

export interface AddPrescriptionItemResult {
  prescription: Prescription;
  item: PrescriptionItem;
  /** The prescription's own create, when this call created it; null when it already existed. */
  prescriptionAuditLogId: string | null;
  itemAuditLogId: string;
}

/**
 * Adds one drug to a visit's prescription, creating the prescription itself
 * on the first one. Both writes share one transaction, so a prescription
 * never exists without the item it was created for.
 *
 * The prescription's number is minted exactly as an invoice's
 * (db/visitCompletion.ts): inside this device's own number series, as the
 * max number for (location_id, issued_year, series) + 1, read inside the
 * write's own transaction. The series is read before the transaction opens,
 * and only when the visit has no prescription yet — a device that does not
 * know its series (device_series_unknown) can still add to a prescription
 * that already exists, and refuses a new one with nothing written.
 *
 * The item goes after the last one: position is the highest position so far
 * + 1, so removing an item never renumbers the rest and a new item never
 * reuses a removed one's position.
 */
export async function addPrescriptionItem(
  db: ClintraDatabase,
  visitId: string,
  fields: PrescriptionItemFields,
): Promise<AddPrescriptionItemResult> {
  const values = normaliseItemFields(fields);
  const actor = await resolveActingMembership(db);
  const existing = await db.prescriptions.where("visit_id").equals(visitId).first();
  const series = existing ? null : await getMintingSeries(db);

  return runAtomicMutations(db, [db.visits, db.prescriptions, db.prescription_items], async (write) => {
    const visit = await db.visits.get(visitId);
    if (!visit) {
      throw new Error(PrescriptionError.VisitNotFound);
    }
    assertPrescriber(actor, visit);

    const now = new Date().toISOString();
    let prescription = await db.prescriptions.where("visit_id").equals(visitId).first();
    let prescriptionAuditLogId: string | null = null;

    if (prescription) {
      assertNotPrinted(prescription);
    } else {
      if (!PRESCRIBABLE_STATUSES.has(visit.status)) {
        throw new Error(PrescriptionError.VisitNotPrescribable);
      }
      if (series === null) {
        // It existed when the series was skipped and is gone now (a pulled
        // delete landed in between): refuse rather than mint without a series.
        throw new Error(PrescriptionError.PrescriptionNotFound);
      }

      const issuedYear = cairoYear(now);
      const atLocation = await db.prescriptions.where("location_id").equals(visit.location_id).toArray();
      const number =
        atLocation
          .filter((candidate) => candidate.issued_year === issuedYear && candidate.series === series)
          .reduce((max, candidate) => Math.max(max, candidate.number), 0) + 1;

      prescription = {
        id: id(),
        org_id: visit.org_id,
        location_id: visit.location_id,
        visit_id: visit.id,
        patient_id: visit.patient_id,
        practitioner_id: visit.practitioner_id,
        series,
        issued_year: issuedYear,
        number,
        diagnosis: null,
        printed_at: null,
        created_by: actor.id,
        created_at: now,
        rev: 1,
      };
      prescriptionAuditLogId = await write({
        table: db.prescriptions,
        entity: "prescriptions",
        entityId: prescription.id,
        action: AuditAction.Create,
        before: null,
        after: prescription,
        actorMembershipId: actor.id,
        orgId: visit.org_id,
      });
    }

    const items = await db.prescription_items.where("prescription_id").equals(prescription.id).toArray();
    const item: PrescriptionItem = {
      id: id(),
      prescription_id: prescription.id,
      ...values,
      position: items.reduce((max, candidate) => Math.max(max, candidate.position), 0) + 1,
      rev: 1,
    };
    const itemAuditLogId = await write({
      table: db.prescription_items,
      entity: "prescription_items",
      entityId: item.id,
      action: AuditAction.Create,
      before: null,
      after: item,
      actorMembershipId: actor.id,
      orgId: visit.org_id,
    });

    return { prescription, item, prescriptionAuditLogId, itemAuditLogId };
  });
}

/**
 * Replaces one drug line's fields (position and prescription stay). Returns
 * the audit_log id of the write, or null when the normalised fields equal
 * the stored ones — then nothing is written at all.
 */
export async function updatePrescriptionItem(
  db: ClintraDatabase,
  itemId: string,
  fields: PrescriptionItemFields,
): Promise<string | null> {
  const values = normaliseItemFields(fields);
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.visits, db.prescriptions, db.prescription_items], async (write) => {
    const before = await db.prescription_items.get(itemId);
    if (!before) {
      throw new Error(PrescriptionError.ItemNotFound);
    }
    const { prescription, visit } = await loadForWrite(db, before.prescription_id, actor);
    assertNotPrinted(prescription);

    const after: PrescriptionItem = { ...before, ...values };
    if ((Object.keys(values) as (keyof ItemValues)[]).every((field) => before[field] === after[field])) {
      return null;
    }

    return write({
      table: db.prescription_items,
      entity: "prescription_items",
      entityId: itemId,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: actor.id,
      orgId: visit.org_id,
    });
  });
}

/**
 * Removes one drug line — a real delete, queued for sync as one. The other
 * items keep their positions. Removing the last item leaves the numbered
 * prescription in place (its number stays used); it just cannot be printed
 * while it is empty.
 */
export async function removePrescriptionItem(db: ClintraDatabase, itemId: string): Promise<string> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, [db.visits, db.prescriptions, db.prescription_items], async (write) => {
    const before = await db.prescription_items.get(itemId);
    if (!before) {
      throw new Error(PrescriptionError.ItemNotFound);
    }
    const { prescription, visit } = await loadForWrite(db, before.prescription_id, actor);
    assertNotPrinted(prescription);

    return write({
      table: db.prescription_items,
      entity: "prescription_items",
      entityId: itemId,
      action: AuditAction.Delete,
      before,
      after: null,
      actorMembershipId: actor.id,
      orgId: visit.org_id,
    });
  });
}

export interface MarkPrescriptionPrintedResult {
  prescription: Prescription;
  /** The print's audit_log id on the first print; null on every later one, which writes nothing. */
  auditLogId: string | null;
}

/**
 * Records a print. The first one sets printed_at and snapshots the visit's
 * diagnosis, as the general visit form holds it right now
 * (readVisitFormValues; a blank diagnosis is stored as null), into the
 * prescription — from then on the prescription and its items are locked
 * (prescription_printed), here and on the server. Every later print changes
 * nothing: no write, no audit_log row, no sync op; it returns the
 * prescription as it was printed. An empty prescription cannot be printed
 * (prescription_empty).
 */
export async function markPrescriptionPrinted(
  db: ClintraDatabase,
  prescriptionId: string,
): Promise<MarkPrescriptionPrintedResult> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(
    db,
    [db.visits, db.prescriptions, db.prescription_items, db.specialty_templates, db.form_definitions, db.visit_form_data],
    async (write) => {
      const { prescription, visit } = await loadForWrite(db, prescriptionId, actor);
      if (prescription.printed_at !== null) {
        return { prescription, auditLogId: null };
      }

      if ((await db.prescription_items.where("prescription_id").equals(prescriptionId).count()) === 0) {
        throw new Error(PrescriptionError.Empty);
      }

      const formDefinition = await findGeneralFormDefinition(db);
      const { diagnosis } = readVisitFormValues(await findVisitFormData(db, visit.id, formDefinition.id));
      const after: Prescription = {
        ...prescription,
        printed_at: new Date().toISOString(),
        diagnosis: optionalText(diagnosis),
      };

      const auditLogId = await write({
        table: db.prescriptions,
        entity: "prescriptions",
        entityId: prescriptionId,
        action: AuditAction.Update,
        before: prescription,
        after,
        actorMembershipId: actor.id,
        orgId: visit.org_id,
      });
      return { prescription: after, auditLogId };
    },
  );
}
