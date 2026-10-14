import {
  carePlanExpectedEnd,
  carePlanSessionMessageLabel,
  carePlanTotals,
  CarePlanSessionState,
  deriveCarePlanSessions,
  isCarePlanOngoing,
  type SessionVisit,
} from "../domain/carePlan";
import { id } from "../domain/id";
import { resolveServicePrice } from "../domain/pricing";
import { occupiesSlot } from "../domain/visitStatus";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { runAtomicMutations, type AtomicWriter } from "./mutate";
import {
  AuditAction,
  CarePlanItemStatus,
  CarePlanStatus,
  type AuditLog,
  type CarePlan,
  type CarePlanItem,
  type Membership,
  type Visit,
} from "./types";
import { findGeneralFormDefinition, findGeneralSpecialtyTemplate, findVisitFormData, readVisitFormValues } from "./visitForm";

/**
 * Every refusal the care plan writers below can throw, as the thrown
 * Error's message. Each is raised inside the write's own transaction ahead
 * of its first write, so a refusal leaves no row, no audit_log row and no
 * sync_ops row behind.
 */
export const CarePlanError = {
  VisitNotFound: "visit_not_found",
  PlanNotFound: "care_plan_not_found",
  SessionNotFound: "care_plan_session_not_found",
  ServiceNotFound: "service_not_found",
  /** The acting membership is not the plan's own practitioner (creating, editing, skipping, stopping). */
  NotPlanPractitioner: "not_plan_practitioner",
  GoalRequired: "care_plan_goal_required",
  DiagnosisRequired: "care_plan_diagnosis_required",
  /** A plan needs at least one group of sessions, and adding sessions needs at least one group. */
  SessionsRequired: "care_plan_sessions_required",
  /** A group's count is not a whole number of at least 1. */
  CountInvalid: "care_plan_session_count_invalid",
  /** A group's gap is not a whole number of days of at least 0. */
  GapInvalid: "care_plan_gap_invalid",
  /** Only a session that is neither done nor booked can be skipped. */
  SessionNotSkippable: "care_plan_session_not_skippable",
  /** Only a suggested session (planned, not booked, not done) can be booked. */
  SessionNotBookable: "care_plan_session_not_bookable",
  /** The booking's patient, practitioner or service is not the session's plan's. */
  SessionMismatch: "care_plan_session_mismatch",
  /** A stopped plan's sessions cannot be booked until it is resumed. */
  PlanStopped: "care_plan_stopped",
  /** The patient already has a plan under way (active, not completed) with this practitioner: creating or resuming another is refused. */
  PlanAlreadyActive: "plan_already_active",
} as const;

export type CarePlanError = (typeof CarePlanError)[keyof typeof CarePlanError];

/** One group of sessions as the plan form asks for it: a service, how many, and how many days apart. */
export interface CarePlanSessionGroup {
  serviceId: string;
  count: number;
  gapDays: number;
}

export interface CreateCarePlanInput {
  /** The visit the plan is created from: its practitioner, patient and location become the plan's. */
  visitId: string;
  goal: string;
  diagnosis: string;
  sessions: readonly CarePlanSessionGroup[];
}

export interface CarePlanWithItems {
  plan: CarePlan;
  items: CarePlanItem[];
}

/** Only the plan's own practitioner creates or edits it; enforced here, on the device (the server's gap is the same as prescriptions'). */
function assertPlanPractitioner(actor: Membership, practitionerId: string): void {
  if (actor.practitioner_id === null || actor.practitioner_id !== practitionerId) {
    throw new Error(CarePlanError.NotPlanPractitioner);
  }
}

function requiredText(value: string, error: CarePlanError): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(error);
  }
  return trimmed;
}

function assertGroups(groups: readonly CarePlanSessionGroup[]): void {
  if (groups.length === 0) {
    throw new Error(CarePlanError.SessionsRequired);
  }
  for (const group of groups) {
    if (!Number.isInteger(group.count) || group.count < 1) {
      throw new Error(CarePlanError.CountInvalid);
    }
    if (!Number.isInteger(group.gapDays) || group.gapDays < 0) {
      throw new Error(CarePlanError.GapInvalid);
    }
  }
}

/**
 * The groups expanded into sessions after `afterSequence`: each group's
 * count of sessions of its service, priced at the service's effective
 * price for this practitioner and location (overrides included), each
 * min_gap_days apart — except a plan's very first session, whose gap is 0.
 */
async function expandGroups(
  db: ClintraDatabase,
  plan: Pick<CarePlan, "id" | "practitioner_id" | "location_id">,
  groups: readonly CarePlanSessionGroup[],
  afterSequence: number,
): Promise<CarePlanItem[]> {
  const overrides = await db.service_price_overrides.toArray();
  const items: CarePlanItem[] = [];
  for (const group of groups) {
    const service = await db.services.get(group.serviceId);
    if (!service) {
      throw new Error(CarePlanError.ServiceNotFound);
    }
    const price = resolveServicePrice(service, overrides, {
      practitionerId: plan.practitioner_id,
      locationId: plan.location_id,
    });
    for (let index = 0; index < group.count; index += 1) {
      const sequence = afterSequence + items.length + 1;
      items.push({
        id: id(),
        care_plan_id: plan.id,
        service_id: service.id,
        sequence,
        visit_id: null,
        min_gap_days: sequence === 1 ? 0 : group.gapDays,
        depends_on_item_id: null,
        price,
        status: CarePlanItemStatus.Planned,
        rev: 1,
      });
    }
  }
  return items;
}

function linkedVisitIds(items: readonly CarePlanItem[]): string[] {
  return [...new Set(items.map((item) => item.visit_id).filter((visitId): visitId is string => visitId !== null))];
}

function visitsById(visits: readonly (Visit | undefined)[]): Map<string, SessionVisit> {
  return new Map(visits.filter((visit): visit is Visit => visit !== undefined).map((visit) => [visit.id, visit]));
}

/** The plan with planned_count, total_price and expected_end derived from `items` (every session of the plan) and the visits they link to. */
function withDerivedFields(plan: CarePlan, items: readonly CarePlanItem[], visits: readonly (Visit | undefined)[]): CarePlan {
  const sessions = deriveCarePlanSessions(items, visitsById(visits), new Map());
  return { ...plan, ...carePlanTotals(items), expected_end: carePlanExpectedEnd(plan.started_at, sessions) };
}

function samePlanFields(a: CarePlan, b: CarePlan): boolean {
  return (
    a.goal === b.goal &&
    a.diagnosis === b.diagnosis &&
    a.status === b.status &&
    a.planned_count === b.planned_count &&
    a.total_price === b.total_price &&
    a.expected_end === b.expected_end
  );
}

/** Writes the plan's update. Callers skip it when samePlanFields says it would change nothing. */
function writePlanUpdate(write: AtomicWriter, db: ClintraDatabase, before: CarePlan, after: CarePlan, actorId: string): Promise<string> {
  return write({
    table: db.care_plans,
    entity: "care_plans",
    entityId: before.id,
    action: AuditAction.Update,
    before,
    after,
    actorMembershipId: actorId,
    orgId: before.org_id,
  });
}

// Inside a Dexie transaction, only a Dexie operation carries the
// transaction across an await. An async helper that resolved without one
// (an empty bulkGet, a no-op early return) would hand its caller back
// outside the transaction, and the next write would commit it early. So
// the helpers below either touch IndexedDB on every path or are plain
// functions, and no-op checks are made synchronously by the caller.

function loadPlanItems(db: ClintraDatabase, planId: string): Promise<CarePlanItem[]> {
  return db.care_plan_items.where("care_plan_id").equals(planId).toArray();
}

/**
 * Rewrites a plan's planned_count, total_price and expected_end from its
 * sessions as they stand inside the current transaction (after the
 * caller's own session writes); writes nothing when none of them changed.
 */
async function refreshPlan(write: AtomicWriter, db: ClintraDatabase, planId: string, actorId: string): Promise<void> {
  const before = await db.care_plans.get(planId);
  if (!before) {
    return;
  }
  const items = await loadPlanItems(db, planId);
  const visitIds = linkedVisitIds(items);
  const visits = visitIds.length === 0 ? [] : await db.visits.bulkGet(visitIds);
  const after = withDerivedFields(before, items, visits);
  if (!samePlanFields(before, after)) {
    await writePlanUpdate(write, db, before, after, actorId);
  }
}

/**
 * Refuses (plan_already_active) when the patient has a plan under way —
 * active and not completed — with the practitioner, other than `exceptPlanId`.
 * Reads the patient's plans on every path, so it keeps the transaction.
 */
async function assertNoOngoingPlan(
  db: ClintraDatabase,
  patientId: string,
  practitionerId: string,
  exceptPlanId: string | null,
): Promise<void> {
  const plans = await db.care_plans.where("patient_id").equals(patientId).toArray();
  const candidates = plans.filter(
    (plan) => plan.practitioner_id === practitionerId && plan.id !== exceptPlanId && plan.status === CarePlanStatus.Active,
  );
  for (const plan of candidates) {
    const items = await loadPlanItems(db, plan.id);
    const visitIds = linkedVisitIds(items);
    const visits = visitIds.length === 0 ? [] : await db.visits.bulkGet(visitIds);
    if (isCarePlanOngoing(plan, deriveCarePlanSessions(items, visitsById(visits), new Map()))) {
      throw new Error(CarePlanError.PlanAlreadyActive);
    }
  }
}

const PLAN_TABLES = (db: ClintraDatabase) => [
  db.care_plans,
  db.care_plan_items,
  db.visits,
  db.services,
  db.service_price_overrides,
  db.specialty_templates,
];

/** What the plan form starts from for a visit: the diagnosis as the visit's general form holds it now ("" when none). */
export async function carePlanDraftForVisit(db: ClintraDatabase, visitId: string): Promise<{ diagnosis: string }> {
  const formDefinition = await findGeneralFormDefinition(db);
  const { diagnosis } = readVisitFormValues(await findVisitFormData(db, visitId, formDefinition.id));
  return { diagnosis: diagnosis.trim() };
}

/**
 * Creates a care plan from a visit: the visit's practitioner, patient and
 * location; the goal and diagnosis as given (both required, trimmed); one
 * or more groups of sessions expanded into items with sequence 1..n, each
 * priced at its service's effective price now and min_gap_days after the
 * previous one (the first session's gap is 0); the template the visit form
 * resolves (the general one). planned_count, total_price and expected_end
 * are derived from the sessions; paid is 0 and stays 0. One transaction:
 * the plan and every session together, or nothing. Refused
 * (plan_already_active) while the patient has a plan under way — active
 * and not completed — with the visit's practitioner.
 */
export async function createCarePlan(db: ClintraDatabase, input: CreateCarePlanInput): Promise<CarePlanWithItems> {
  const goal = requiredText(input.goal, CarePlanError.GoalRequired);
  const diagnosis = requiredText(input.diagnosis, CarePlanError.DiagnosisRequired);
  assertGroups(input.sessions);
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, PLAN_TABLES(db), async (write) => {
    const visit = await db.visits.get(input.visitId);
    if (!visit) {
      throw new Error(CarePlanError.VisitNotFound);
    }
    assertPlanPractitioner(actor, visit.practitioner_id);
    await assertNoOngoingPlan(db, visit.patient_id, visit.practitioner_id, null);
    const template = await findGeneralSpecialtyTemplate(db);

    const now = new Date().toISOString();
    const draft: CarePlan = {
      id: id(),
      org_id: visit.org_id,
      location_id: visit.location_id,
      template_id: template.id,
      patient_id: visit.patient_id,
      practitioner_id: visit.practitioner_id,
      goal,
      diagnosis,
      planned_count: 0,
      total_price: 0 as CarePlan["total_price"],
      paid: 0 as CarePlan["paid"],
      status: CarePlanStatus.Active,
      started_at: now,
      expected_end: now,
      rev: 1,
    };
    const items = await expandGroups(db, draft, input.sessions, 0);
    // New sessions link to no visit yet.
    const plan = withDerivedFields(draft, items, []);

    await write({
      table: db.care_plans,
      entity: "care_plans",
      entityId: plan.id,
      action: AuditAction.Create,
      before: null,
      after: plan,
      actorMembershipId: actor.id,
      orgId: plan.org_id,
    });
    for (const item of items) {
      await write({
        table: db.care_plan_items,
        entity: "care_plan_items",
        entityId: item.id,
        action: AuditAction.Create,
        before: null,
        after: item,
        actorMembershipId: actor.id,
        orgId: plan.org_id,
      });
    }
    return { plan, items };
  });
}

/** Reads a plan for an edit by its own practitioner. */
async function loadPlanForEdit(db: ClintraDatabase, planId: string, actor: Membership): Promise<CarePlan> {
  const plan = await db.care_plans.get(planId);
  if (!plan) {
    throw new Error(CarePlanError.PlanNotFound);
  }
  assertPlanPractitioner(actor, plan.practitioner_id);
  return plan;
}

/** Replaces the goal and the diagnosis (both required, trimmed). Returns null, writing nothing, when both are unchanged. */
export async function updateCarePlanDetails(
  db: ClintraDatabase,
  planId: string,
  fields: { goal: string; diagnosis: string },
): Promise<string | null> {
  const goal = requiredText(fields.goal, CarePlanError.GoalRequired);
  const diagnosis = requiredText(fields.diagnosis, CarePlanError.DiagnosisRequired);
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, PLAN_TABLES(db), async (write) => {
    const before = await loadPlanForEdit(db, planId, actor);
    const after = { ...before, goal, diagnosis };
    return samePlanFields(before, after) ? null : writePlanUpdate(write, db, before, after, actor.id);
  });
}

/**
 * Appends sessions: each group expanded as at creation, after the plan's
 * last sequence, each group's first session min_gap_days after the one
 * before it. The plan's derived fields are rewritten in the same
 * transaction.
 */
export async function addCarePlanSessions(
  db: ClintraDatabase,
  planId: string,
  groups: readonly CarePlanSessionGroup[],
): Promise<CarePlanItem[]> {
  assertGroups(groups);
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, PLAN_TABLES(db), async (write) => {
    const before = await loadPlanForEdit(db, planId, actor);
    const existing = await loadPlanItems(db, planId);
    const lastSequence = existing.reduce((max, item) => Math.max(max, item.sequence), 0);
    const added = await expandGroups(db, before, groups, lastSequence);

    for (const item of added) {
      await write({
        table: db.care_plan_items,
        entity: "care_plan_items",
        entityId: item.id,
        action: AuditAction.Create,
        before: null,
        after: item,
        actorMembershipId: actor.id,
        orgId: before.org_id,
      });
    }
    await refreshPlan(write, db, before.id, actor.id);
    return added;
  });
}

/** Writes one session's new status and the plan's recomputed fields; null, writing nothing, when the status is already that. */
async function setSessionStatus(db: ClintraDatabase, itemId: string, status: CarePlanItemStatus): Promise<string | null> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, PLAN_TABLES(db), async (write) => {
    const before = await db.care_plan_items.get(itemId);
    if (!before) {
      throw new Error(CarePlanError.SessionNotFound);
    }
    const plan = await loadPlanForEdit(db, before.care_plan_id, actor);
    if (before.status === status) {
      return null;
    }

    if (status === CarePlanItemStatus.Skipped) {
      const linked = before.visit_id === null ? undefined : await db.visits.get(before.visit_id);
      const [session] = deriveCarePlanSessions([before], visitsById([linked]), new Map());
      if (session.state !== CarePlanSessionState.Suggested) {
        throw new Error(CarePlanError.SessionNotSkippable);
      }
    }
    // A link that no longer books the session (its visit gone or freed) is
    // cleared with the skip, so a skipped session never points at a visit.
    const after: CarePlanItem = { ...before, status, visit_id: status === CarePlanItemStatus.Skipped ? null : before.visit_id };

    const auditLogId = await write({
      table: db.care_plan_items,
      entity: "care_plan_items",
      entityId: itemId,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: actor.id,
      orgId: plan.org_id,
    });
    await refreshPlan(write, db, plan.id, actor.id);
    return auditLogId;
  });
}

/** "أجّل جلسة": skips a session that is neither done nor booked (care_plan_session_not_skippable otherwise). */
export function skipCarePlanSession(db: ClintraDatabase, itemId: string): Promise<string | null> {
  return setSessionStatus(db, itemId, CarePlanItemStatus.Skipped);
}

/** "رجّع جلسة": brings a skipped session back as planned. */
export function unskipCarePlanSession(db: ClintraDatabase, itemId: string): Promise<string | null> {
  return setSessionStatus(db, itemId, CarePlanItemStatus.Planned);
}

async function setPlanStatus(db: ClintraDatabase, planId: string, status: CarePlanStatus): Promise<string | null> {
  const actor = await resolveActingMembership(db);

  return runAtomicMutations(db, PLAN_TABLES(db), async (write) => {
    const before = await loadPlanForEdit(db, planId, actor);
    const after = { ...before, status };
    if (samePlanFields(before, after)) {
      return null;
    }
    if (status === CarePlanStatus.Active) {
      await assertNoOngoingPlan(db, before.patient_id, before.practitioner_id, before.id);
    }
    return writePlanUpdate(write, db, before, after, actor.id);
  });
}

/** "وقّف الخطة". Null, writing nothing, when it is already stopped. */
export function stopCarePlan(db: ClintraDatabase, planId: string): Promise<string | null> {
  return setPlanStatus(db, planId, CarePlanStatus.Stopped);
}

/** "رجّع الخطة". Null, writing nothing, when it is already active; refused (plan_already_active) while another plan of the patient's with this practitioner is under way. */
export function resumeCarePlan(db: ClintraDatabase, planId: string): Promise<string | null> {
  return setPlanStatus(db, planId, CarePlanStatus.Active);
}

// --- Links kept by the visit writers (decision 3) ---------------------------
//
// care_plan_items.visit_id is the only link between a session and the visit
// that books it. The visit writers keep it current inside their own
// transactions: booking a session sets it (db/visitBooking.ts), moving the
// visit carries it to the new visit (db/visitMove.ts), and cancelling or
// marking a no-show clears it (db/visitCancel.ts). Each also rewrites the
// plan's derived fields, since the sessions' dates moved with the link.
// Anyone who may write the visit may do these — they are part of the
// visit's write, not an edit of the plan. Each caller's transaction must
// include care_plans and care_plan_items (and visits), and must have
// written the visit itself first, so the dates are read as they now stand.

/** The tables a visit write that keeps session links must add to its transaction. */
export function sessionLinkTables(db: ClintraDatabase) {
  return [db.care_plans, db.care_plan_items];
}

/**
 * Checks that a booking may book this session, before anything is
 * written: the plan is active; the booking is for the plan's patient and
 * practitioner and the session's service; and the session is suggested
 * (planned, and not already booked or done).
 */
export async function assertSessionBookable(
  db: ClintraDatabase,
  itemId: string,
  booking: { patientId: string; practitionerId: string; serviceId: string },
): Promise<CarePlanItem> {
  const item = await db.care_plan_items.get(itemId);
  if (!item) {
    throw new Error(CarePlanError.SessionNotFound);
  }
  const plan = await db.care_plans.get(item.care_plan_id);
  if (!plan) {
    throw new Error(CarePlanError.PlanNotFound);
  }
  if (plan.status !== CarePlanStatus.Active) {
    throw new Error(CarePlanError.PlanStopped);
  }
  if (
    booking.patientId !== plan.patient_id ||
    booking.practitionerId !== plan.practitioner_id ||
    booking.serviceId !== item.service_id
  ) {
    throw new Error(CarePlanError.SessionMismatch);
  }
  if (item.status !== CarePlanItemStatus.Planned) {
    throw new Error(CarePlanError.SessionNotBookable);
  }
  const linked = item.visit_id === null ? undefined : await db.visits.get(item.visit_id);
  if (linked && occupiesSlot(linked.status)) {
    throw new Error(CarePlanError.SessionNotBookable);
  }
  return item;
}

async function relinkSessions(
  write: AtomicWriter,
  db: ClintraDatabase,
  fromVisitId: string,
  toVisitId: string | null,
  actorId: string,
  orgId: string,
): Promise<void> {
  const linked = await db.care_plan_items.where("visit_id").equals(fromVisitId).toArray();
  for (const before of linked) {
    await write({
      table: db.care_plan_items,
      entity: "care_plan_items",
      entityId: before.id,
      action: AuditAction.Update,
      before,
      after: { ...before, visit_id: toVisitId },
      actorMembershipId: actorId,
      orgId,
    });
  }
  for (const planId of new Set(linked.map((item) => item.care_plan_id))) {
    await refreshPlan(write, db, planId, actorId);
  }
}

/** Links a session to the visit that books it (after assertSessionBookable, and after the visit's own write). */
export async function linkSessionToVisit(
  write: AtomicWriter,
  db: ClintraDatabase,
  item: CarePlanItem,
  visit: Pick<Visit, "id" | "org_id">,
  actorId: string,
): Promise<string> {
  const auditLogId = await write({
    table: db.care_plan_items,
    entity: "care_plan_items",
    entityId: item.id,
    action: AuditAction.Update,
    before: item,
    after: { ...item, visit_id: visit.id },
    actorMembershipId: actorId,
    orgId: visit.org_id,
  });
  await refreshPlan(write, db, item.care_plan_id, actorId);
  return auditLogId;
}

/** Carries every session linked to a moved visit over to the visit that replaces it. */
export function moveSessionLinks(
  write: AtomicWriter,
  db: ClintraDatabase,
  fromVisit: Pick<Visit, "id" | "org_id">,
  toVisitId: string,
  actorId: string,
): Promise<void> {
  return relinkSessions(write, db, fromVisit.id, toVisitId, actorId, fromVisit.org_id);
}

/** Clears the link of every session a cancelled or missed visit booked: each becomes suggested again. */
export function clearSessionLinks(
  write: AtomicWriter,
  db: ClintraDatabase,
  visit: Pick<Visit, "id" | "org_id">,
  actorId: string,
): Promise<void> {
  return relinkSessions(write, db, visit.id, null, actorId, visit.org_id);
}

/** A session link a visit's undo puts back: the session as it stands, and as it was before the visit's write moved its link. */
export interface SessionLinkRestore {
  before: CarePlanItem;
  after: CarePlanItem;
}

/**
 * The session links a visit write changed along with it, to put back when
 * that write is undone (db/visitUndo.ts). The visit writers above change a
 * link in the visit's own transaction, right after the visit, so those
 * links are the care_plan_items rows that directly follow the visit's audit
 * row — with the plan's refreshed fields between them — before any row of
 * another entity. A link is put back only while that row is still the
 * session's latest write and the session still points where the row left
 * it; a session changed since keeps its later link.
 *
 * Null when the undo deletes the visit (it reverses a create) and a session
 * would still link to it: the server refuses that delete on the foreign
 * key, so the caller refuses the undo instead of queueing it.
 */
export async function sessionLinksToRestore(db: ClintraDatabase, visitAuditRow: AuditLog): Promise<SessionLinkRestore[] | null> {
  const later = await db.audit_log.where("seq").above(visitAuditRow.seq).toArray();
  const carried: AuditLog[] = [];
  for (const row of later) {
    if (row.entity !== "care_plan_items" && row.entity !== "care_plans") {
      break;
    }
    if (row.entity === "care_plan_items" && row.action === AuditAction.Update) {
      carried.push(row);
    }
  }

  const restores: SessionLinkRestore[] = [];
  for (const row of carried) {
    const latest = later.filter((candidate) => candidate.entity === row.entity && candidate.entity_id === row.entity_id).at(-1);
    const linkBefore = (row.before as CarePlanItem).visit_id;
    const linkAfter = (row.after as CarePlanItem).visit_id;
    const current = await db.care_plan_items.get(row.entity_id);
    if (latest?.id === row.id && current && linkBefore !== linkAfter && current.visit_id === linkAfter) {
      restores.push({ before: current, after: { ...current, visit_id: linkBefore } });
    }
  }

  const stillLinked = await db.care_plan_items.where("visit_id").equals(visitAuditRow.entity_id).toArray();
  const deletesVisit = visitAuditRow.action === AuditAction.Create;
  if (deletesVisit && stillLinked.some((item) => !restores.some((restore) => restore.before.id === item.id))) {
    return null;
  }
  return restores;
}

/**
 * After a visit's undo (and its link restores) are written: rewrites the
 * derived fields of every plan a restored session belongs to and of every
 * plan with a session linked to the visit, since the visit's status or day
 * may have changed under it.
 */
export async function refreshPlansAfterVisitUndo(
  write: AtomicWriter,
  db: ClintraDatabase,
  visitId: string,
  restores: readonly SessionLinkRestore[],
  actorId: string,
): Promise<void> {
  const linked = await db.care_plan_items.where("visit_id").equals(visitId).toArray();
  const planIds = new Set([...restores.map((restore) => restore.before.care_plan_id), ...linked.map((item) => item.care_plan_id)]);
  for (const planId of planIds) {
    await refreshPlan(write, db, planId, actorId);
  }
}

/**
 * The {{session_label}} for a message about this visit — "جلسة {n} من
 * {count} · {service}" — when a session of a care plan is linked to it;
 * null otherwise.
 */
export async function carePlanSessionLabelForVisit(db: ClintraDatabase, visitId: string): Promise<string | null> {
  const item = await db.care_plan_items.where("visit_id").equals(visitId).first();
  if (!item) {
    return null;
  }
  const items = await loadPlanItems(db, item.care_plan_id);
  const services = await db.services.bulkGet([...new Set(items.map((candidate) => candidate.service_id))]);
  const serviceNames = new Map(
    services.filter((service) => service !== undefined).map((service) => [service.id, service.name] as const),
  );
  const sessions = deriveCarePlanSessions(items, visitsById(await db.visits.bulkGet(linkedVisitIds(items))), serviceNames);
  return carePlanSessionMessageLabel(sessions, item.id);
}
