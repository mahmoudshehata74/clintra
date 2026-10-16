import type { ClintraDatabase } from "../db/database";
import { getDeviceId } from "../db/deviceRegistration";
import type { AuditLog, RemoteAuditLog } from "../db/types";
import { AUDIT_SCOPE_PARENT_FIELD, auditScopeParentId, auditScopeTags, type AuditScopeParent } from "../domain/auditScope";
import { addDaysToClinicDay, cairoInstant, todayInCairo } from "../domain/time";
import { SyncAuthError, type AuditTransport, type WireAuditRow } from "./transport";

/** Rows per POST /api/audit/push, the server's limit. */
export const AUDIT_PUSH_BATCH = 200;

/** Pulled rows are kept this many Cairo days, today included (the brief's 60-day local window). */
export const REMOTE_AUDIT_RETENTION_DAYS = 60;

/** Fields of a memberships record that never leave the device (docs/audit-sync.md, decision 8). */
const SECRET_MEMBERSHIP_FIELDS = ["pin_hash", "pin_salt"] as const;

/** How an audit pass ended, for the engine's transport health. */
export type AuditSyncOutcome = "done" | "unauthenticated" | "unreachable";

function withoutSecrets(entity: string, record: unknown): unknown {
  if (entity !== "memberships" || record === null || typeof record !== "object") {
    return record;
  }
  const copy: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const field of SECRET_MEMBERSHIP_FIELDS) {
    delete copy[field];
  }
  return copy;
}

/** The parent rows (visits, prescriptions, care plans, invoices) a batch's child rows are scoped by. */
async function scopeParentsOf(db: ClintraDatabase, rows: readonly AuditLog[]): Promise<Map<string, AuditScopeParent>> {
  const tableFor = {
    visit_id: db.visits,
    prescription_id: db.prescriptions,
    care_plan_id: db.care_plans,
    invoice_id: db.invoices,
  } as const;
  const parents = new Map<string, AuditScopeParent>();
  for (const [field, table] of Object.entries(tableFor)) {
    const ids = [
      ...new Set(
        rows
          .filter((row) => AUDIT_SCOPE_PARENT_FIELD[row.entity] === field)
          .map((row) => auditScopeParentId(row))
          .filter((parentId): parentId is string => parentId !== null),
      ),
    ];
    if (ids.length === 0) {
      continue;
    }
    for (const parent of await (table as typeof db.visits).bulkGet(ids)) {
      if (parent) {
        parents.set(parent.id, parent);
      }
    }
  }
  return parents;
}

/** A local row as it goes up: its scope tags, no seq, no PIN fields. */
export function toWireAuditRow(row: AuditLog, parents: ReadonlyMap<string, AuditScopeParent>): WireAuditRow {
  const parentId = auditScopeParentId(row);
  const tags = auditScopeTags(row, parentId === null ? undefined : parents.get(parentId)) ?? { location_id: null, practitioner_id: null };
  return {
    id: row.id,
    org_id: row.org_id,
    location_id: tags.location_id,
    practitioner_id: tags.practitioner_id,
    actor_membership_id: row.actor_membership_id,
    entity: row.entity,
    entity_id: row.entity_id,
    action: row.action,
    before: withoutSecrets(row.entity, row.before),
    after: withoutSecrets(row.entity, row.after),
    at: row.at,
  };
}

function outcomeOf(error: unknown): AuditSyncOutcome {
  return error instanceof SyncAuthError ? "unauthenticated" : "unreachable";
}

/**
 * Pushes this device's audit rows the server has not answered for yet —
 * every row above device.audit_pushed_seq, in seq (write) order, 200 a
 * request, until none is left. accepted, duplicate and rejected are final:
 * the watermark moves past them (a rejected row stays on this device and is
 * not sent again). A failed row, and everything after it, waits for the
 * next cycle, as does a whole batch when the request itself fails. The
 * rows are their own outbox: no sync op is queued for them.
 */
export async function runAuditPush(db: ClintraDatabase, transport: AuditTransport): Promise<AuditSyncOutcome> {
  const deviceId = getDeviceId();
  for (;;) {
    const device = await db.device.get(deviceId);
    if (!device) {
      return "done";
    }
    const watermark = device.audit_pushed_seq ?? 0;
    const batch = await db.audit_log.where("seq").above(watermark).limit(AUDIT_PUSH_BATCH).toArray();
    if (batch.length === 0) {
      return "done";
    }

    const parents = await scopeParentsOf(db, batch);
    let results;
    try {
      results = await transport.pushAuditRows(batch.map((row) => toWireAuditRow(row, parents)));
    } catch (error) {
      return outcomeOf(error);
    }

    let answeredThrough = watermark;
    for (const [index, row] of batch.entries()) {
      if (results[index]?.id !== row.id || results[index].status === "failed") {
        break;
      }
      answeredThrough = row.seq;
    }
    if (answeredThrough !== watermark) {
      await db.device.update(deviceId, { audit_pushed_seq: answeredThrough });
    }
    if (answeredThrough !== batch[batch.length - 1].seq) {
      return "done";
    }
  }
}

/** The first instant a pulled row is kept from: the start of the Cairo day 59 days before today. */
function retentionStart(now: Date): string {
  return cairoInstant(addDaysToClinicDay(todayInCairo(now), -(REMOTE_AUDIT_RETENTION_DAYS - 1)), "00:00");
}

/**
 * Stores one pulled page: each row once — an id already in either store is
 * skipped, so nothing is ever overwritten — and none older than the
 * retention window.
 */
export async function storePulledAuditRows(db: ClintraDatabase, rows: readonly RemoteAuditLog[], now: Date = new Date()): Promise<void> {
  const keepFrom = retentionStart(now);
  const kept = rows.filter((row) => row.at >= keepFrom);
  if (kept.length === 0) {
    return;
  }
  const ids = kept.map((row) => row.id);
  await db.transaction("rw", db.audit_log, db.remote_audit_log, async () => {
    const [own, pulled] = await Promise.all([db.audit_log.bulkGet(ids), db.remote_audit_log.bulkGet(ids)]);
    const held = new Set([...own, ...pulled].filter((row) => row !== undefined).map((row) => row.id));
    const fresh = [...new Map(kept.filter((row) => !held.has(row.id)).map((row) => [row.id, row])).values()];
    if (fresh.length > 0) {
      await db.remote_audit_log.bulkAdd(fresh);
    }
  });
}

/**
 * Pulls the organization's other devices' audit rows from
 * device.audit_pull_cursor (null: the first pull, 14 Cairo days back),
 * page by page, storing each page before moving the cursor.
 */
export async function runAuditPull(db: ClintraDatabase, transport: AuditTransport): Promise<AuditSyncOutcome> {
  const deviceId = getDeviceId();
  const device = await db.device.get(deviceId);
  if (!device) {
    return "done";
  }
  let cursor = device.audit_pull_cursor ?? null;
  let hasMore = true;
  while (hasMore) {
    let page;
    try {
      page = await transport.pullAuditSince(cursor);
    } catch (error) {
      return outcomeOf(error);
    }
    await storePulledAuditRows(db, page.rows);
    cursor = page.cursor;
    hasMore = page.hasMore;
    await db.device.update(deviceId, { audit_pull_cursor: cursor });
  }
  return "done";
}

/** Deletes pulled rows older than the retention window — never this device's own. */
export async function pruneRemoteAuditRows(db: ClintraDatabase, now: Date = new Date()): Promise<void> {
  await db.remote_audit_log.where("at").below(retentionStart(now)).delete();
}
