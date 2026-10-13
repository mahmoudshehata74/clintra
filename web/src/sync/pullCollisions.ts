import type { IndexableType, Table } from "dexie";
import { id } from "../domain/id";
import type { ClintraDatabase } from "../db/database";
import { AuditAction, type SyncOp, type SyncReview } from "../db/types";

/**
 * The sync_review reason applyPulledRow leaves when a pulled row took the
 * place of a local row the server never accepted (docs/sync-plan.md's
 * "Local unique collisions on pull"). Acknowledge-only: the server's
 * version already won, so there is nothing left to choose.
 */
export const DISPLACED_BY_SERVER_REASON = "displaced_by_server";

/**
 * The sync_review reason applyPulledRow leaves when a pulled row collides
 * with a local row the server *did* accept — the server enforces the same
 * keys, so this should not happen. Both rows are left as they are and the
 * pulled one is skipped; the row needs support, not a choice.
 */
export const SERVER_UNIQUE_CONFLICT_REASON = "server_unique_conflict";

interface ChildLink {
  entity: string;
  /** The child's column naming its parent's id. */
  column: string;
}

/**
 * parent table => the syncable tables whose rows point at it through a
 * foreign key the server enforces and never cascades (api/database/migrations).
 * A child of a row the server never accepted can never be accepted either:
 * its create fails on that foreign key (a `failed` result, retried with
 * backoff indefinitely — sync/engine.ts's runSyncCycle). So a displaced row
 * takes its children with it, and a rejected create takes its children's
 * queued ops. visits.rescheduled_from is deliberately not a link: the visit
 * it names is another booking with a life of its own.
 */
const CHILD_LINKS: Readonly<Record<string, readonly ChildLink[]>> = {
  visits: [
    { entity: "prescriptions", column: "visit_id" },
    { entity: "visit_form_data", column: "visit_id" },
    { entity: "invoices", column: "visit_id" },
    { entity: "messages", column: "visit_id" },
  ],
  prescriptions: [{ entity: "prescription_items", column: "prescription_id" }],
  invoices: [
    { entity: "invoice_items", column: "invoice_id" },
    { entity: "payments", column: "invoice_id" },
  ],
};

/** Every table that can hold a descendant of a row of `entity`, children first. */
function descendantEntities(entity: string): string[] {
  const found: string[] = [];
  for (const link of CHILD_LINKS[entity] ?? []) {
    if (!found.includes(link.entity)) {
      found.push(link.entity);
    }
    for (const nested of descendantEntities(link.entity)) {
      if (!found.includes(nested)) {
        found.push(nested);
      }
    }
  }
  return found;
}

/** The tables a transaction over `entity`'s rows and their descendants must cover. */
export function familyTables(db: ClintraDatabase, entity: string): Table<unknown, string>[] {
  return [entity, ...descendantEntities(entity)].map((name) => db.table(name) as Table<unknown, string>);
}

type Row = Record<string, unknown> & { id: string };

/** One row a review row carries alongside its main row: which table it came from, and the row itself. */
export interface ReviewedRow {
  entity: string;
  row: Record<string, unknown>;
}

/** A displaced_by_server review's payload: the local row that was removed, and its children. */
export interface DisplacedPayload {
  row: Record<string, unknown>;
  children: ReviewedRow[];
}

/** One queued child op folded into a rejected create's review instead of being retried. */
export interface FoldedChildOp {
  op_id: string;
  entity: string;
  entity_id: string;
  action: AuditAction;
  payload: unknown;
}

/**
 * A rejected create's payload once child ops were folded into it. A rejected
 * create with no queued child ops keeps the plain row as its payload, as
 * before.
 */
export interface RejectedCreatePayload {
  row: unknown;
  child_ops: FoldedChildOp[];
}

/** A server_unique_conflict review's payload: the pulled row that was skipped, and the accepted local rows in its way. */
export interface ServerUniqueConflictPayload {
  pulled: Record<string, unknown>;
  local: Record<string, unknown>[];
}

interface Descendants {
  rows: ReviewedRow[];
  ids: Set<string>;
}

/**
 * Every descendant of one row, by CHILD_LINKS: the rows still in their
 * stores, and the ids of every descendant — including one only a queued
 * create op still names (a child created and then removed locally, whose
 * ops have not gone out yet).
 */
async function collectDescendants(
  db: ClintraDatabase,
  entity: string,
  parentId: string,
  unsentOps: readonly SyncOp[],
  into: Descendants = { rows: [], ids: new Set() },
): Promise<Descendants> {
  for (const link of CHILD_LINKS[entity] ?? []) {
    const table = db.table(link.entity) as Table<Row, string>;
    const stored = await table.filter((row) => row[link.column] === parentId).toArray();
    const childIds = new Set(stored.map((row) => row.id));
    for (const op of unsentOps) {
      const payload = op.payload as Record<string, unknown> | null;
      if (op.entity === link.entity && payload?.[link.column] === parentId) {
        childIds.add(op.entity_id);
      }
    }

    for (const row of stored) {
      if (!into.ids.has(row.id)) {
        into.rows.push({ entity: link.entity, row });
      }
    }
    for (const childId of childIds) {
      if (into.ids.has(childId)) {
        continue;
      }
      into.ids.add(childId);
      await collectDescendants(db, link.entity, childId, unsentOps, into);
    }
  }
  return into;
}

function unsentOpsOf(ops: readonly SyncOp[], ids: ReadonlySet<string>): SyncOp[] {
  return ops.filter((op) => op.synced_at === null && ids.has(op.entity_id));
}

/**
 * Folds a just-rejected create's queued child ops into its review row (the
 * caller's open transaction must cover sync_ops and familyTables(op.entity)):
 * each child's create would only ever come back `failed` on its foreign key,
 * and a failed op is retried indefinitely, so they are removed from the queue
 * and kept in the review instead. Returns the payload the review row should
 * carry — the plain row when there was nothing to fold.
 */
export async function foldChildOpsOfRejectedCreate(db: ClintraDatabase, op: SyncOp): Promise<unknown> {
  const unsent = (await db.sync_ops.toArray()).filter((candidate) => candidate.synced_at === null);
  const { ids } = await collectDescendants(db, op.entity, op.entity_id, unsent);
  const childOps = unsentOpsOf(unsent, ids).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (childOps.length === 0) {
    return op.payload;
  }

  await db.sync_ops.bulkDelete(childOps.map((childOp) => childOp.op_id));
  const payload: RejectedCreatePayload = {
    row: op.payload,
    child_ops: childOps.map((childOp) => ({
      op_id: childOp.op_id,
      entity: childOp.entity,
      entity_id: childOp.entity_id,
      action: childOp.action,
      payload: childOp.payload,
    })),
  };
  return payload;
}

/** A valid IndexedDB key component; a row whose key path has any other value is not in that index at all. */
function isKeyPart(value: unknown): value is string | number | Date {
  return typeof value === "string" || (typeof value === "number" && !Number.isNaN(value)) || value instanceof Date;
}

function uniqueKeyOf(payload: Record<string, unknown>, keyPath: string | string[]): IndexableType | null {
  if (Array.isArray(keyPath)) {
    const parts = keyPath.map((path) => payload[path]);
    return parts.every(isKeyPart) ? (parts as IndexableType) : null;
  }
  const value = payload[keyPath];
  return isKeyPart(value) ? value : null;
}

/** Every local row, other than the pulled row's own id, already holding one of its unique keys. */
async function findBlockers(table: Table<Row, string>, payload: Row): Promise<Row[]> {
  const blockers = new Map<string, Row>();
  for (const index of table.schema.indexes) {
    if (!index.unique || index.keyPath === null || index.keyPath === undefined) {
      continue;
    }
    const key = uniqueKeyOf(payload, index.keyPath);
    if (key === null) {
      continue;
    }
    const holders = await table.where(index.name).equals(key).toArray();
    for (const holder of holders) {
      if (holder.id !== payload.id) {
        blockers.set(holder.id, holder);
      }
    }
  }
  return [...blockers.values()];
}

/**
 * True when the server has never accepted this row: its create is still
 * queued, or was rejected (a review row records that, even after its op is
 * gone). A row with an accepted create, or with no create op at all (pulled,
 * or seeded), counts as accepted.
 */
function isNeverAccepted(entityId: string, ops: readonly SyncOp[], reviews: readonly SyncReview[]): boolean {
  const creates = ops.filter((op) => op.entity_id === entityId && op.action === AuditAction.Create);
  if (creates.some((op) => op.synced_at !== null)) {
    return false;
  }
  if (creates.length > 0) {
    return true;
  }
  return reviews.some(
    (review) =>
      review.entity_id === entityId &&
      review.action === AuditAction.Create &&
      review.reason !== SERVER_UNIQUE_CONFLICT_REASON &&
      review.reason !== DISPLACED_BY_SERVER_REASON,
  );
}

/**
 * Removes one never-accepted local row and everything that only exists
 * because of it: its descendants (CHILD_LINKS), every queued op for any of
 * them, and any review still open for any of them (superseded — this is now
 * the one thing to review). Leaves one displaced_by_server review row with
 * the removed rows in its payload.
 */
async function displace(db: ClintraDatabase, entity: string, row: Row, now: string): Promise<void> {
  const ops = await db.sync_ops.toArray();
  const unsent = ops.filter((op) => op.synced_at === null);
  const descendants = await collectDescendants(db, entity, row.id, unsent);
  const ids = new Set([row.id, ...descendants.ids]);

  const ownCreate = unsent.find((op) => op.entity_id === row.id && op.action === AuditAction.Create);
  await db.sync_ops.bulkDelete(unsentOpsOf(ops, ids).map((op) => op.op_id));

  await (db.table(entity) as Table<Row, string>).delete(row.id);
  for (const child of descendants.rows) {
    await (db.table(child.entity) as Table<Row, string>).delete(child.row.id as string);
  }

  const superseded = (await db.sync_review.toArray()).filter((review) => review.needs_review && ids.has(review.entity_id));
  for (const review of superseded) {
    await db.sync_review.update(review.id, { needs_review: false });
  }

  const payload: DisplacedPayload = { row, children: descendants.rows };
  await db.sync_review.add({
    id: id(),
    op_id: ownCreate?.op_id ?? id(),
    entity,
    entity_id: row.id,
    reason: DISPLACED_BY_SERVER_REASON,
    payload,
    needs_review: true,
    created_at: now,
    action: AuditAction.Create,
    base_rev: null,
  });
}

/**
 * Writes one pulled or bootstrapped row to its table — a plain upsert, unless
 * a local row with a different id already holds one of the table's unique
 * keys (docs/sync-plan.md's "Local unique collisions on pull"). Then, in one
 * transaction:
 *
 * - every such local row the server never accepted is displaced (see
 *   displace) and the pulled row is written: the server already decided
 *   which of the two exists;
 * - if any of them *was* accepted, nothing is written or removed: one
 *   server_unique_conflict review row is left (at most one open per pulled
 *   entity_id), the conflict is logged, and the pulled row is skipped, so
 *   the pull cycle still completes and its cursor still advances.
 */
export async function applyPulledRow(db: ClintraDatabase, entity: string, payload: Record<string, unknown>): Promise<void> {
  const table = db.table(entity) as Table<Row, string>;
  const row = payload as Row;
  if (!table.schema.indexes.some((index) => index.unique)) {
    await table.put(row);
    return;
  }

  await db.transaction("rw", [...familyTables(db, entity), db.sync_ops, db.sync_review], async () => {
    const blockers = await findBlockers(table, row);
    if (blockers.length === 0) {
      await table.put(row);
      return;
    }

    const now = new Date().toISOString();
    const ops = await db.sync_ops.toArray();
    const reviews = await db.sync_review.toArray();

    if (blockers.some((blocker) => !isNeverAccepted(blocker.id, ops, reviews))) {
      console.error(
        `sync_engine_server_unique_conflict: pulled ${entity} ${row.id} collides with accepted local ${blockers.map((blocker) => blocker.id).join(", ")}`,
      );
      const alreadyOpen = reviews.some(
        (review) => review.needs_review && review.entity_id === row.id && review.reason === SERVER_UNIQUE_CONFLICT_REASON,
      );
      if (alreadyOpen) {
        return;
      }
      const conflict: ServerUniqueConflictPayload = { pulled: row, local: blockers };
      await db.sync_review.add({
        id: id(),
        op_id: id(),
        entity,
        entity_id: row.id,
        reason: SERVER_UNIQUE_CONFLICT_REASON,
        payload: conflict,
        needs_review: true,
        created_at: now,
        action: AuditAction.Update,
        base_rev: null,
      });
      return;
    }

    for (const blocker of blockers) {
      await displace(db, entity, blocker, now);
    }
    await table.put(row);
  });
}
