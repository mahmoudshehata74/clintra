import { addDaysToClinicDay, cairoInstant, todayInCairo, type ClinicDay } from "../domain/time";
import type { ClintraDatabase } from "./database";
import type { AuditAction, AuditEntry, RemoteAuditLog } from "./types";

/** A row's entry fields alone — this device's own row without its device-local seq. */
function entryOf(row: AuditEntry): AuditEntry {
  return {
    id: row.id,
    org_id: row.org_id,
    actor_membership_id: row.actor_membership_id,
    entity: row.entity,
    entity_id: row.entity_id,
    action: row.action,
    before: row.before,
    after: row.after,
    at: row.at,
  };
}

/** A pulled row with exactly the fields remote_audit_log keeps — a server's or a fake's extra fields (its seq) dropped. */
export function remoteAuditRowOf(row: RemoteAuditLog): RemoteAuditLog {
  return {
    ...entryOf(row),
    location_id: row.location_id,
    practitioner_id: row.practitioner_id,
    device_id: row.device_id,
  };
}

/**
 * Every audit row of one Cairo day, whichever device of the organization
 * wrote it: this device's own `audit_log` rows and the rows pulled from the
 * others (`remote_audit_log`, read by its `at` index). The two stores never
 * share an id (sync/auditSync.ts skips a pulled id this device holds).
 */
export async function auditEntriesOfDay(db: ClintraDatabase, day: ClinicDay): Promise<AuditEntry[]> {
  const [own, remote] = await Promise.all([
    db.audit_log.toArray(),
    db.remote_audit_log
      .where("at")
      .between(cairoInstant(day, "00:00"), cairoInstant(addDaysToClinicDay(day, 1), "00:00"), true, false)
      .toArray(),
  ]);
  const ofDay = (row: AuditEntry) => todayInCairo(new Date(row.at)) === day;
  return [...own.map(entryOf).filter(ofDay), ...remote.filter(ofDay)];
}

/**
 * The first audit row of one entity's action, from either store — the
 * invoice's creator line (the `invoices` create row), whichever device
 * created it. Undefined when neither store holds one: an invoice created
 * on another device before this device's first audit pull window.
 */
export async function findAuditEntry(
  db: ClintraDatabase,
  entity: string,
  entityId: string,
  action: AuditAction,
): Promise<AuditEntry | undefined> {
  const own = await db.audit_log.filter((row) => row.entity === entity && row.entity_id === entityId && row.action === action).first();
  if (own) {
    return entryOf(own);
  }
  return db.remote_audit_log
    .where("[entity+entity_id]")
    .equals([entity, entityId])
    .filter((row) => row.action === action)
    .first();
}
