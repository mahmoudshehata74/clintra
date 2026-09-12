import Dexie, { type Table } from "dexie";
import { id } from "../domain/id";
import { resolveActingMembership } from "./actingMembership";
import { getDeviceId } from "./deviceRegistration";
import type { ClintraDatabase } from "./database";
import { AuditAction } from "./types";

/**
 * Dispatched on `window` right after every successful mutate() commit, so
 * the sync engine (sync/engine.ts) can trigger an immediate push without
 * db/mutate.ts importing anything from sync/ — this module stays the
 * foundation every other layer depends on, never the reverse.
 */
export const MUTATION_EVENT_NAME = "clintra:mutation";

export interface MutationInput<T> {
  table: Table<T, string>;
  /** Matches audit_log.entity / sync_ops.entity, normally the table name. */
  entity: string;
  entityId: string;
  action: AuditAction;
  /** The full prior record, or null when action is "create". */
  before: T | null;
  /** The full new record, or null when action is "delete". */
  after: T | null;
  actorMembershipId: string;
  orgId: string;
}

/**
 * The actual write: applies the change to the entity table, writes an
 * audit_log row, and appends a sync_ops row. Does not open its own
 * transaction and does not notify the sync engine — see mutate() (one
 * entity, its own transaction) and runAtomicMutations() (several entities,
 * one shared transaction) for the two ways this gets called.
 */
async function applyEntityWrite<T>(db: ClintraDatabase, input: MutationInput<T>): Promise<string> {
  const now = new Date().toISOString();
  const auditLogId = id();

  if (input.action === AuditAction.Delete) {
    await input.table.delete(input.entityId);
  } else {
    if (input.after === null) {
      throw new Error("mutate_requires_after_unless_deleting");
    }
    await input.table.put(input.after);
  }

  // Reserved inside this same transaction by reading the current max — the
  // exact pattern invoices.number already uses (see db/visitCompletion.ts).
  // IndexedDB serializes overlapping readwrite transactions on the same
  // store, so a second transaction's read of the current max never runs
  // until the first has already committed its own row, which is what makes
  // this safe across two tabs writing at once, not just within one process.
  const lastBySeq = await db.audit_log.orderBy("seq").last();
  const seq = (lastBySeq?.seq ?? 0) + 1;

  await db.audit_log.add({
    id: auditLogId,
    seq,
    org_id: input.orgId,
    actor_membership_id: input.actorMembershipId,
    entity: input.entity,
    entity_id: input.entityId,
    action: input.action,
    before: input.before,
    after: input.after,
    at: now,
  });

  await db.sync_ops.add({
    op_id: id(),
    entity: input.entity,
    entity_id: input.entityId,
    action: input.action,
    payload: input.after,
    device_id: getDeviceId(),
    created_at: now,
    synced_at: null,
    // The prior row's rev, for the server's base_rev check — never sent for
    // a create (there is no prior row), and read generically here rather
    // than restricted to the 14 syncable tables, since a table with no rev
    // field (e.g. users) simply has none to read and this falls through to
    // null, which is exactly as inert for a table the real endpoint never
    // validates base_rev against in the first place.
    base_rev: input.action === AuditAction.Create ? null : ((input.before as { rev?: number } | null)?.rev ?? null),
    failure_count: 0,
    next_retry_at: null,
  });

  return auditLogId;
}

/**
 * Dexie propagates its "current transaction" zone across the microtask chain
 * that resumes after an awaited transaction, even though the transaction has
 * already committed. Dispatching synchronously here would run the sync
 * engine's listener (and its own Dexie queries, e.g. against sync_review, a
 * table the triggering transaction may never have touched) inside that stale
 * zone, and a real IndexedDB backend then throws NotFoundError for any table
 * not in the original transaction's scope — fake-indexeddb (used in tests)
 * is lax enough not to reproduce this, which is why only real-browser
 * testing caught it. ignoreTransaction is Dexie's own escape hatch for
 * exactly this.
 */
function notifyMutationCommitted(): void {
  if (typeof window !== "undefined") {
    Dexie.ignoreTransaction(() => {
      window.dispatchEvent(new Event(MUTATION_EVENT_NAME));
    });
  }
}

/**
 * The single entry point every write in this application must use. In one
 * Dexie transaction it (a) applies the change to the entity table, (b) writes
 * an audit_log row, and (c) appends a sync_ops row for the future sync
 * transport. If any part fails, all three roll back together — a change that
 * is applied but unlogged, or logged but unqueued, is a defect.
 *
 * Returns the id of the audit_log row it wrote, so a caller that may need to
 * undo this exact mutation later (and no other) has something to identify it
 * by, rather than a snapshot that cannot be checked against later history.
 */
export async function mutate<T>(db: ClintraDatabase, input: MutationInput<T>): Promise<string> {
  const auditLogId = await db.transaction("rw", input.table, db.audit_log, db.sync_ops, () =>
    applyEntityWrite(db, input),
  );
  notifyMutationCommitted();
  return auditLogId;
}

/** A write function scoped to one already-open atomic transaction; see runAtomicMutations(). */
export type AtomicWriter = <T>(input: MutationInput<T>) => Promise<string>;

/**
 * Runs several entity writes as one atomic unit — one shared Dexie
 * transaction, so every write commits together or none do, and exactly one
 * mutation event fires once it commits. Use this instead of calling mutate()
 * more than once for a single logical operation: completing a visit also
 * creates its invoice (db/visitCompletion.ts), and recording a payment also
 * updates the invoice it pays (db/payments.ts) — both need "all writes
 * together or none," which two separate mutate() calls cannot give, since
 * each opens and commits its own transaction independently.
 *
 * `tables` must list every table any write the callback makes touches, plus
 * any table the callback only reads from — exactly what a plain
 * db.transaction() call requires; audit_log and sync_ops are included
 * automatically. The callback receives a `write` function with the same
 * shape as mutate()'s own input, minus the transaction and notification
 * mutate() would otherwise add itself.
 */
export async function runAtomicMutations<R>(
  db: ClintraDatabase,
  tables: readonly Table<unknown, string>[],
  callback: (write: AtomicWriter) => Promise<R>,
): Promise<R> {
  const write: AtomicWriter = (input) => applyEntityWrite(db, input);
  const result = await db.transaction("rw", [...tables, db.audit_log, db.sync_ops], () => callback(write));
  notifyMutationCommitted();
  return result;
}

export type UndoRefusalReason =
  /** auditLogId does not identify a recorded visits mutation. */
  | "not_found"
  /** More than five minutes have passed since that mutation. */
  | "expired"
  /** A later mutation has since touched the same visit; this is no longer the one to reverse. */
  | "stale";

export type UndoOutcome = { ok: true } | { ok: false; reason: UndoRefusalReason };

/** An undo is only honoured within this long after the original mutation. */
const UNDO_WINDOW_MS = 5 * 60 * 1000;

/**
 * Reverses the exact mutation recorded under auditLogId, and only that
 * mutation — the constrained undo mechanism shared by every write flow that
 * offers one (one-tap attendance, the booking sheet, and any future one), so
 * there is exactly one place that decides whether an undo is legitimate
 * rather than each flow inventing its own rule. Works against any entity
 * table (visits, patients, ...); see undoMostRecentVisitMutation and
 * undoMostRecentPatientMutation for the concrete wrappers call sites use.
 *
 * This is not a general status setter: it takes no target status and no
 * caller-supplied snapshot, and for visits it never calls
 * canTransitionVisitStatus, since an undo moves backward against the
 * workflow direction that machine governs. Every forward change must go
 * through a validated path such as markVisitArrived or
 * bookExistingPatientVisit instead.
 *
 * Everything this function needs to decide whether the undo is legitimate is
 * re-read from the audit_log row itself, not from anything the caller
 * remembers about the record. It refuses, and writes nothing, when:
 * - auditLogId does not identify a mutation of the given entity still on record;
 * - the undo window (five minutes) has elapsed since that mutation;
 * - that mutation is no longer the most recent one recorded for this record,
 *   meaning something else changed it afterward and this undo is stale.
 *
 * Reversing a create deletes the row entirely rather than "updating" it back
 * to the null it had before — there is no prior record to restore.
 */
export async function undoMostRecentMutation<T>(
  db: ClintraDatabase,
  auditLogId: string,
  entity: string,
  table: Table<T, string>,
): Promise<UndoOutcome> {
  const auditRow = await db.audit_log.get(auditLogId);
  if (!auditRow || auditRow.entity !== entity) {
    return { ok: false, reason: "not_found" };
  }

  const elapsedMs = Date.now() - new Date(auditRow.at).getTime();
  if (elapsedMs > UNDO_WINDOW_MS) {
    return { ok: false, reason: "expired" };
  }

  const rowsForEntity = (await db.audit_log.toArray()).filter(
    (row) => row.entity === entity && row.entity_id === auditRow.entity_id,
  );
  // Compared by seq, never by `at`: two mutations of the same entity written
  // back to back can land in the same millisecond, at which point `at`
  // strings tie and can no longer tell which one actually happened last —
  // seq is a strictly monotonic counter that never ties (see its own doc
  // comment on AuditLog and applyEntityWrite's assignment of it above).
  const mostRecent = rowsForEntity.reduce((latest, row) => (row.seq > latest.seq ? row : latest));
  if (mostRecent.id !== auditRow.id) {
    return { ok: false, reason: "stale" };
  }

  const currentRecord = await table.get(auditRow.entity_id);
  if (!currentRecord) {
    return { ok: false, reason: "not_found" };
  }

  const actor = await resolveActingMembership(db);
  // Reuse the org the original mutation was scoped to, from the audit row
  // itself, rather than requiring every possible entity (e.g. day_state,
  // which has no org_id of its own) to carry an org_id field just so undo
  // can stamp its own audit_log row.
  const orgId = auditRow.org_id;

  if (auditRow.action === AuditAction.Create) {
    await mutate(db, {
      table,
      entity,
      entityId: auditRow.entity_id,
      action: AuditAction.Delete,
      before: currentRecord,
      after: null,
      actorMembershipId: actor.id,
      orgId,
    });
  } else {
    await mutate(db, {
      table,
      entity,
      entityId: auditRow.entity_id,
      action: AuditAction.Update,
      before: currentRecord,
      // Written by mutate() itself under this same audit row; trusted as a T.
      after: auditRow.before as T,
      actorMembershipId: actor.id,
      orgId,
    });
  }

  return { ok: true };
}

/** The constrained undo mechanism, scoped to the visits table. */
export function undoMostRecentVisitMutation(db: ClintraDatabase, auditLogId: string): Promise<UndoOutcome> {
  return undoMostRecentMutation(db, auditLogId, "visits", db.visits);
}

/** The constrained undo mechanism, scoped to the patients table. */
export function undoMostRecentPatientMutation(db: ClintraDatabase, auditLogId: string): Promise<UndoOutcome> {
  return undoMostRecentMutation(db, auditLogId, "patients", db.patients);
}

/** The constrained undo mechanism, scoped to the day_state table. */
export function undoMostRecentDayStateMutation(db: ClintraDatabase, auditLogId: string): Promise<UndoOutcome> {
  return undoMostRecentMutation(db, auditLogId, "day_state", db.day_state);
}

/** The constrained undo mechanism, scoped to the invoices table. */
export function undoMostRecentInvoiceMutation(db: ClintraDatabase, auditLogId: string): Promise<UndoOutcome> {
  return undoMostRecentMutation(db, auditLogId, "invoices", db.invoices);
}

/** The constrained undo mechanism, scoped to the invoice_items table. */
export function undoMostRecentInvoiceItemMutation(db: ClintraDatabase, auditLogId: string): Promise<UndoOutcome> {
  return undoMostRecentMutation(db, auditLogId, "invoice_items", db.invoice_items);
}

/** The constrained undo mechanism, scoped to the payments table. */
export function undoMostRecentPaymentMutation(db: ClintraDatabase, auditLogId: string): Promise<UndoOutcome> {
  return undoMostRecentMutation(db, auditLogId, "payments", db.payments);
}
