import { beforeEach, describe, expect, it } from "vitest";
import { setActiveMembershipId } from "../auth/session";
import { describeAuditVerb } from "../domain/auditVerb";
import { id } from "../domain/id";
import { LocationScope, PractitionerScope } from "../domain/scope";
import { Role } from "../domain/role";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { getDeviceId } from "./deviceRegistration";
import { findSeededQueuePractitioner, findSeededSlotsPractitioner, seedDatabase } from "./seed";
import { AuditAction, type Membership, type Visit } from "./types";
import { canCorrectVisit, CorrectionError, correctVisitForm } from "./visitCorrections";
import { findGeneralFormDefinition, findVisitFormData, saveVisitFormField } from "./visitForm";

let db: ClintraDatabase;
let owner: Membership;
let assistant: Membership;

const STORED = { complaint: "ألم في الركبة", diagnosis: "التهاب وتر" };
const CORRECTED = { complaint: "ألم في الركبة", diagnosis: "التهاب وتر الرضفة" };
const REASON = "خطأ في كتابة التشخيص";

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-visit-corrections-test-${crypto.randomUUID()}`);
  // With the queue demo: a second doctor whose visits are not the owner's own.
  await seedDatabase(db, { includeQueueDemo: true });
  const memberships = await db.memberships.toArray();
  owner = memberships.find((membership) => membership.role === Role.Owner)!;
  assistant = memberships.find((membership) => membership.role === Role.Assistant)!;
  setActiveMembershipId(owner.id);
});

/** A visit of `practitionerId` (the slots doctor by default), written directly in `status`. */
async function makeVisit(status: VisitStatus, practitionerId?: string): Promise<Visit> {
  const practitioner = practitionerId ?? (await findSeededSlotsPractitioner(db)).id;
  const [location] = await db.locations.toArray();
  const [patient] = await db.patients.toArray();
  const visit: Visit = {
    id: id(),
    org_id: owner.org_id,
    location_id: location.id,
    practitioner_id: practitioner,
    patient_id: patient.id,
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-08",
    position: 1 + (await db.visits.count()),
    scheduled_at: null,
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: owner.id,
    created_at: "2026-09-08T06:00:00.000Z",
    note: null,
    rev: 1,
  };
  await db.visits.add(visit);
  return visit;
}

/** A completed visit whose form was filled while it was in the room. */
async function completedVisitWithForm(): Promise<Visit> {
  const visit = await makeVisit(VisitStatus.InRoom);
  await saveVisitFormField(db, visit.id, "complaint", STORED.complaint);
  await saveVisitFormField(db, visit.id, "diagnosis", STORED.diagnosis);
  await db.visits.update(visit.id, { status: VisitStatus.Completed });
  return { ...visit, status: VisitStatus.Completed };
}

/** A doctor's own membership, for `practitionerId`. */
async function doctorOf(practitionerId: string): Promise<Membership> {
  const doctor: Membership = {
    ...owner,
    id: id(),
    user_id: id(),
    role: Role.Practitioner,
    practitioner_id: practitionerId,
    location_scope: LocationScope.All,
    practitioner_scope: PractitionerScope.All,
  };
  await db.memberships.add(doctor);
  return doctor;
}

async function writeCounts() {
  return {
    audit: await db.audit_log.count(),
    ops: await db.sync_ops.count(),
    revisions: await db.visit_form_revisions.count(),
    forms: await db.visit_form_data.count(),
  };
}

/** The ops written after `since` ops existed, in write order. */
async function opsAfter(since: number) {
  return (await db.sync_ops.toArray()).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(since);
}

describe("correctVisitForm", () => {
  it("writes the revision then the form update, one group in that order, and the form holds the corrected text", async () => {
    const visit = await completedVisitWithForm();
    const definition = await findGeneralFormDefinition(db);
    const before = (await findVisitFormData(db, visit.id, definition.id))!;
    const opsBefore = await db.sync_ops.count();

    const revision = await correctVisitForm(db, visit.id, { complaint: ` ${CORRECTED.complaint}`, diagnosis: `${CORRECTED.diagnosis}  ` }, `  ${REASON} `);

    expect(revision).toEqual({
      id: revision.id,
      org_id: visit.org_id,
      visit_id: visit.id,
      visit_form_data_id: before.id,
      revision_no: 1,
      replaced_rev: before.rev,
      previous_data: before.data,
      new_data: CORRECTED,
      reason: REASON,
      corrected_by: owner.id,
      corrected_at: revision.corrected_at,
      device_id: getDeviceId(),
      rev: 1,
    });
    expect(await db.visit_form_revisions.get(revision.id)).toEqual(revision);
    expect((await findVisitFormData(db, visit.id, definition.id))!.data).toEqual(CORRECTED);

    const ops = await opsAfter(opsBefore);
    expect(ops.map((op) => [op.entity, op.action, op.base_rev])).toEqual([
      ["visit_form_revisions", AuditAction.Create, null],
      ["visit_form_data", AuditAction.Update, before.rev],
    ]);
    expect(ops[0].group_id).toBeDefined();
    expect(ops[1].group_id).toBe(ops[0].group_id);
    expect(ops[1].payload).toEqual({ ...before, data: CORRECTED });

    const revisionAudit = (await db.audit_log.toArray()).find((row) => row.entity === "visit_form_revisions")!;
    expect(describeAuditVerb(revisionAudit)).toBe("عدّل نموذج زيارة مكتملة");
  });

  it("starts the form with its empty values when the completed visit has none: three ops in one group", async () => {
    const visit = await makeVisit(VisitStatus.Completed);
    const opsBefore = await db.sync_ops.count();

    const revision = await correctVisitForm(db, visit.id, { complaint: "صداع", diagnosis: "" }, REASON);

    const ops = await opsAfter(opsBefore);
    expect(ops.map((op) => [op.entity, op.action, op.base_rev])).toEqual([
      ["visit_form_data", AuditAction.Create, null],
      ["visit_form_revisions", AuditAction.Create, null],
      ["visit_form_data", AuditAction.Update, 1],
    ]);
    expect(new Set(ops.map((op) => op.group_id)).size).toBe(1);
    expect((ops[0].payload as { data: unknown }).data).toEqual({ complaint: "", diagnosis: "" });
    expect(revision).toMatchObject({ revision_no: 1, replaced_rev: 1, previous_data: { complaint: "", diagnosis: "" }, new_data: { complaint: "صداع", diagnosis: "" } });
  });

  it("numbers a later correction next, describing the form as the first one left it", async () => {
    const visit = await completedVisitWithForm();
    await correctVisitForm(db, visit.id, CORRECTED, REASON);

    const second = await correctVisitForm(db, visit.id, { ...CORRECTED, complaint: "ألم شديد في الركبة" }, "الشكوى ناقصة");

    expect(second).toMatchObject({ revision_no: 2, previous_data: CORRECTED });
  });

  it("lets the visit's own doctor correct, and the owner correct another doctor's visit", async () => {
    const queuePractitioner = await findSeededQueuePractitioner(db);
    const visit = await makeVisit(VisitStatus.Completed, queuePractitioner.id);
    await correctVisitForm(db, visit.id, CORRECTED, REASON);

    setActiveMembershipId((await doctorOf(queuePractitioner.id)).id);
    await expect(correctVisitForm(db, visit.id, STORED, REASON)).resolves.toMatchObject({ revision_no: 2 });
  });

  it.each<[string, () => Promise<{ visit: Visit; as?: string; values?: typeof STORED; reason?: string }>, CorrectionError]>([
    ["a visit still in the room", async () => ({ visit: await makeVisit(VisitStatus.InRoom) }), CorrectionError.NotCompleted],
    ["the assistant", async () => ({ visit: await completedVisitWithForm(), as: assistant.id }), CorrectionError.NotAllowed],
    [
      "another doctor",
      async () => ({ visit: await completedVisitWithForm(), as: (await doctorOf((await findSeededQueuePractitioner(db)).id)).id }),
      CorrectionError.NotAllowed,
    ],
    ["a reason under 3 characters", async () => ({ visit: await completedVisitWithForm(), reason: "  لا  " }), CorrectionError.ReasonRequired],
    ["a reason over 500 characters", async () => ({ visit: await completedVisitWithForm(), reason: "س".repeat(501) }), CorrectionError.ReasonTooLong],
    ["the text as it stands", async () => ({ visit: await completedVisitWithForm(), values: STORED }), CorrectionError.Unchanged],
    [
      "a change of spaces only",
      async () => ({ visit: await completedVisitWithForm(), values: { complaint: ` ${STORED.complaint} `, diagnosis: STORED.diagnosis } }),
      CorrectionError.Unchanged,
    ],
  ])("refuses %s, writing nothing", async (_label, setup, error) => {
    const { visit, as, values, reason } = await setup();
    if (as) {
      setActiveMembershipId(as);
    }
    const before = await writeCounts();

    await expect(correctVisitForm(db, visit.id, values ?? CORRECTED, reason ?? REASON)).rejects.toThrow(error);

    expect(await writeCounts()).toEqual(before);
  });

  it("accepts a reason of exactly 3 and of exactly 500 characters", async () => {
    const visit = await completedVisitWithForm();
    await expect(correctVisitForm(db, visit.id, CORRECTED, "سبب")).resolves.toMatchObject({ reason: "سبب" });
    await expect(correctVisitForm(db, visit.id, STORED, "ب".repeat(500))).resolves.toMatchObject({ revision_no: 2 });
  });
});

describe("canCorrectVisit", () => {
  const visit = { status: VisitStatus.Completed, practitioner_id: "practitioner-1" };

  it("is the visit's own doctor or an owner, on a completed visit only", () => {
    expect(canCorrectVisit({ role: Role.Owner, practitioner_id: null }, visit)).toBe(true);
    expect(canCorrectVisit({ role: Role.Practitioner, practitioner_id: "practitioner-1" }, visit)).toBe(true);
    expect(canCorrectVisit({ role: Role.Practitioner, practitioner_id: "practitioner-2" }, visit)).toBe(false);
    expect(canCorrectVisit({ role: Role.Assistant, practitioner_id: null }, visit)).toBe(false);
    expect(canCorrectVisit({ role: Role.Manager, practitioner_id: null }, visit)).toBe(false);
    expect(canCorrectVisit({ role: Role.Owner, practitioner_id: null }, { ...visit, status: VisitStatus.InRoom })).toBe(false);
    expect(canCorrectVisit(undefined, visit)).toBe(false);
  });
});
