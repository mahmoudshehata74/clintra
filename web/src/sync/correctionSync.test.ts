import { beforeEach, describe, expect, it } from "vitest";
import { setActiveMembershipId } from "../auth/session";
import { id } from "../domain/id";
import { Role } from "../domain/role";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "../db/database";
import { findSeededSlotsPractitioner, seedDatabase } from "../db/seed";
import { AuditAction, type Membership, type SyncOp, type Visit } from "../db/types";
import { correctVisitForm } from "../db/visitCorrections";
import { findGeneralFormDefinition, findVisitFormData, saveVisitFormField } from "../db/visitForm";
import { chainBaseRevs } from "./baseRevChain";
import { runSyncCycle } from "./engine";
import { acknowledgeReview } from "./reviewActions";
import { CORRECTION_STALE_LABEL, describeSyncReview, lostCorrectionOf } from "./reviewSummary";
import { GROUP_REJECTED_REASON, isRefusedGroupReview } from "./syncGroups";
import type { PullSinceResult, PushOpResult, SyncTransport } from "./transport";

let db: ClintraDatabase;
let owner: Membership;

const STORED = { complaint: "ألم في الركبة", diagnosis: "التهاب وتر" };
const CORRECTED = { complaint: "ألم في الركبة", diagnosis: "التهاب وتر الرضفة" };
const REASON = "خطأ في كتابة التشخيص";

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-correction-sync-test-${crypto.randomUUID()}`);
  await seedDatabase(db);
  owner = (await db.memberships.toArray()).find((membership) => membership.role === Role.Owner)!;
  setActiveMembershipId(owner.id);
});

/** A transport answering each push with `answer(op, index)`, counting its pushes, with nothing to pull. */
class ScriptedTransport implements SyncTransport {
  pushes = 0;
  private readonly answer: (op: SyncOp, index: number) => PushOpResult;
  constructor(answer: (op: SyncOp, index: number) => PushOpResult) {
    this.answer = answer;
  }
  async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    this.pushes += 1;
    return ops.map((op, index) => this.answer(op, index));
  }
  async pullSince(): Promise<PullSinceResult> {
    return { cursor: "0", hasMore: false, changes: [] };
  }
  async pullBootstrap(): Promise<PullSinceResult> {
    return { cursor: "0:", hasMore: false, changes: [] };
  }
}

/** A group refused on its first op with `reason`, every other op group_rejected. */
const refusingGroup = (reason: string) =>
  new ScriptedTransport((op, index) =>
    index === 0 ? { op_id: op.op_id, status: "rejected", reason } : { op_id: op.op_id, status: "rejected", reason: GROUP_REJECTED_REASON },
  );

async function makeVisit(status: VisitStatus): Promise<Visit> {
  const practitioner = await findSeededSlotsPractitioner(db);
  const [location] = await db.locations.toArray();
  const [patient] = await db.patients.toArray();
  const visit: Visit = {
    id: id(),
    org_id: owner.org_id,
    location_id: location.id,
    practitioner_id: practitioner.id,
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

/**
 * Every op so far as the server accepted it: synced, and the visit's form at
 * the rev the server gave it (a create starts at 1, each update adds one),
 * written back as runSyncCycle writes an accepted rev.
 */
async function serverAccepted(visitId: string): Promise<void> {
  const formOps = (await db.sync_ops.toArray()).filter((candidate) => candidate.entity === "visit_form_data");
  await db.sync_ops.toCollection().modify({ synced_at: new Date().toISOString() });
  const form = await storedForm(visitId);
  await db.visit_form_data.update(form!.id, { rev: formOps.length });
}

/** A visit filled in the room, its form on the server at rev 1, then completed. */
async function completedVisitWithSyncedForm(): Promise<Visit> {
  const visit = await makeVisit(VisitStatus.InRoom);
  await saveVisitFormField(db, visit.id, "complaint", STORED.complaint);
  await saveVisitFormField(db, visit.id, "diagnosis", STORED.diagnosis);
  await serverAccepted(visit.id);
  await db.visits.update(visit.id, { status: VisitStatus.Completed });
  return visit;
}

async function storedForm(visitId: string) {
  const definition = await findGeneralFormDefinition(db);
  return findVisitFormData(db, visitId, definition.id);
}

function op(overrides: Partial<SyncOp>): SyncOp {
  return {
    op_id: id(),
    entity: "visit_form_data",
    entity_id: "form-1",
    action: AuditAction.Update,
    payload: {},
    device_id: "device-1",
    created_at: "2026-09-08T10:00:00.000Z",
    synced_at: null,
    base_rev: 2,
    failure_count: 0,
    next_retry_at: null,
    ...overrides,
  };
}

describe("chainBaseRevs and a correction's replaced_rev", () => {
  it("names the rev the form will have once this device's earlier unsent writes of it land", () => {
    const autosave = op({ created_at: "2026-09-08T10:00:00.001Z" });
    const revision = op({
      entity: "visit_form_revisions",
      entity_id: "revision-1",
      action: AuditAction.Create,
      base_rev: null,
      group_id: "group-1",
      payload: { visit_form_data_id: "form-1", replaced_rev: 2 },
      created_at: "2026-09-08T10:00:00.002Z",
    });
    const update = op({ group_id: "group-1", created_at: "2026-09-08T10:00:00.003Z" });

    const sent = chainBaseRevs([autosave, revision, update]);

    expect(sent.map((candidate) => candidate.base_rev)).toEqual([2, null, 3]);
    expect((sent[1].payload as { replaced_rev: number }).replaced_rev).toBe(3);
    expect((revision.payload as { replaced_rev: number }).replaced_rev).toBe(2);
  });

  it("leaves a correction with nothing before it as written", () => {
    const revision = op({
      entity: "visit_form_revisions",
      entity_id: "revision-1",
      action: AuditAction.Create,
      base_rev: null,
      group_id: "group-1",
      payload: { visit_form_data_id: "form-1", replaced_rev: 2 },
    });
    const update = op({ group_id: "group-1", created_at: "2026-09-08T10:00:00.001Z" });

    expect(chainBaseRevs([revision, update])[0]).toBe(revision);
  });
});

describe("a correction another device's correction beat to the server", () => {
  it("is put back whole: the revision gone, the form as the server holds it, one review keeping its text", async () => {
    const visit = await completedVisitWithSyncedForm();
    await correctVisitForm(db, visit.id, CORRECTED, REASON);

    await runSyncCycle(db, refusingGroup("conflict_stale_rev"));

    expect(await db.visit_form_revisions.count()).toBe(0);
    expect((await storedForm(visit.id))?.data).toEqual(STORED);
    expect((await db.sync_ops.toArray()).filter((candidate) => candidate.synced_at === null)).toEqual([]);
    const reviews = await db.sync_review.toArray();
    expect(reviews).toHaveLength(1);
    expect(isRefusedGroupReview(reviews[0])).toBe(true);
    expect(describeSyncReview(reviews[0])).toBe(`تعديل نموذج زيارة — ${CORRECTION_STALE_LABEL}`);
    expect(lostCorrectionOf(reviews[0])).toEqual({ visitId: visit.id, ...CORRECTED, reason: REASON });
  });

  it("removes the empty form it started on a visit with none", async () => {
    const visit = await makeVisit(VisitStatus.Completed);
    await correctVisitForm(db, visit.id, CORRECTED, REASON);

    await runSyncCycle(db, refusingGroup("conflict_stale_rev"));

    expect(await storedForm(visit.id)).toBeUndefined();
    expect(await db.visit_form_revisions.count()).toBe(0);
  });

  it.each([
    ["correction_not_allowed", "تعديل نموذج زيارة — تعديل الزيارة بعد ما تتقفل لدكتور الزيارة أو صاحب العيادة بس"],
    ["correction_invalid", "تعديل نموذج زيارة — التعديل ده مش مطابق لآخر نسخة من نموذج الزيارة، أو معاه تغييرات تانية، فماتحفظش"],
  ])("reads %s as its own line", async (reason, line) => {
    const visit = await completedVisitWithSyncedForm();
    await correctVisitForm(db, visit.id, CORRECTED, REASON);

    await runSyncCycle(db, refusingGroup(reason));

    expect(describeSyncReview((await db.sync_review.toArray())[0])).toBe(line);
  });
});

describe("a late autosave of a form whose visit another device completed", () => {
  it("is refused once: the form goes back to the server's, the later edits leave the queue, the review keeps the latest text", async () => {
    const visit = await makeVisit(VisitStatus.InRoom);
    await saveVisitFormField(db, visit.id, "complaint", STORED.complaint);
    await saveVisitFormField(db, visit.id, "diagnosis", STORED.diagnosis);
    await serverAccepted(visit.id);
    await saveVisitFormField(db, visit.id, "diagnosis", "التهاب");
    await saveVisitFormField(db, visit.id, "diagnosis", "التهاب وتر الرضفة");
    const transport = new ScriptedTransport((candidate, index) =>
      index === 0 ? { op_id: candidate.op_id, status: "rejected", reason: "correction_required" } : { op_id: candidate.op_id, status: "blocked" },
    );

    await runSyncCycle(db, transport);

    expect(await storedForm(visit.id)).toMatchObject({ data: STORED, rev: 2 });
    expect((await db.sync_ops.toArray()).filter((candidate) => candidate.synced_at === null)).toEqual([]);
    const [review] = await db.sync_review.toArray();
    expect(describeSyncReview(review)).toBe(
      "نموذج الزيارة — الزيارة دي اتقفلت قبل ما التعديل ده يوصل، والتعديل بعد القفل محتاج سبب. افتح الزيارة واعمل «تعديل»",
    );
    expect(lostCorrectionOf(review)).toEqual({ visitId: visit.id, ...CORRECTED, reason: null });

    // "تمام" closes it, and nothing of it goes up again.
    await acknowledgeReview(db, review.id);
    await runSyncCycle(db, transport);
    expect(transport.pushes).toBe(1);
  });

  it("removes a form this device created that the server refused", async () => {
    const visit = await makeVisit(VisitStatus.InRoom);
    await saveVisitFormField(db, visit.id, "complaint", "صداع");
    const transport = new ScriptedTransport((candidate) => ({ op_id: candidate.op_id, status: "rejected", reason: "correction_required" }));

    await runSyncCycle(db, transport);

    expect(await storedForm(visit.id)).toBeUndefined();
    expect(lostCorrectionOf((await db.sync_review.toArray())[0])).toEqual({ visitId: visit.id, complaint: "صداع", diagnosis: "", reason: null });
  });
});
