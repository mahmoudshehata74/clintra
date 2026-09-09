import Dexie, { type Table } from "dexie";
import { ClintraDatabase } from "../db/database";
import { AuditAction, type SyncOp } from "../db/types";
import type { PullSinceResult, PushOpResult, SyncTransport } from "./transport";

/** The default name two tabs on the same device share, so they see one coherent server. */
export const FAKE_SERVER_DB_NAME = "clintra-fake-server";

// Every entity this app currently writes through mutate() (see db/mutate.ts
// call sites: visitAttendance.ts, visitCancel.ts, visitBooking.ts,
// visitMove.ts use "visits"; patientCreate.ts uses "patients"; dayState.ts
// uses "day_state"). Add an entity here only once something writes it.
function tableForEntity(db: ClintraDatabase, entity: string): Table<unknown, string> {
  switch (entity) {
    case "visits":
      return db.visits as unknown as Table<unknown, string>;
    case "patients":
      return db.patients as unknown as Table<unknown, string>;
    case "day_state":
      return db.day_state as unknown as Table<unknown, string>;
    default:
      throw new Error(`fake_transport_unknown_entity:${entity}`);
  }
}

/**
 * Stands in for a real server until Laravel exists: a second Dexie database
 * in the same browser, not an in-memory Map. It has its own copy of every
 * table and its own version, because it reuses ClintraDatabase's own schema
 * under a different database name — so it enforces the exact same natural
 * constraints (visits' position and scheduled_at uniqueness, in particular)
 * a real backend would, which is what makes a slot conflict something this
 * fake genuinely detects rather than something hardcoded into it. Being a
 * real separate database is also what lets two tabs on the same device
 * share one coherent view: both connect to the same IndexedDB database
 * under this name, and IndexedDB serializes their overlapping writes.
 */
export class FakeTransport implements SyncTransport {
  private readonly db: ClintraDatabase;

  constructor(dbName: string = FAKE_SERVER_DB_NAME) {
    this.db = new ClintraDatabase(dbName);
  }

  async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    const results: PushOpResult[] = [];
    for (const op of ops) {
      results.push(await this.pushOne(op));
    }
    return results;
  }

  private async pushOne(op: SyncOp): Promise<PushOpResult> {
    const table = tableForEntity(this.db, op.entity);

    return this.db.transaction("rw", table, this.db.sync_ops, async (): Promise<PushOpResult> => {
      // op_id dedup: this is the exact mechanism a resend is proven safe by.
      const alreadySeen = await this.db.sync_ops.get(op.op_id);
      if (alreadySeen) {
        return { op_id: op.op_id, status: "duplicate" };
      }

      try {
        if (op.action === AuditAction.Delete) {
          await table.delete(op.entity_id);
        } else {
          await table.put(op.payload);
        }
      } catch (error) {
        if (error instanceof Dexie.ConstraintError) {
          // The specific reason name the spec asks for when two ops target
          // the same visit and the later one violates position or
          // scheduled_at uniqueness; anything else that could in principle
          // violate a different table's constraint gets a generic reason
          // rather than inventing a visits-specific label for it.
          return {
            op_id: op.op_id,
            status: "rejected",
            reason: op.entity === "visits" ? "conflict_slot_taken" : "conflict",
          };
        }
        throw error;
      }

      // Recorded as both "seen" (for dedup) and "applied" (for pullSince) in one row.
      await this.db.sync_ops.add(op);
      return { op_id: op.op_id, status: "accepted" };
    });
  }

  async pullSince(cursor: string | null): Promise<PullSinceResult> {
    const allOps = await this.db.sync_ops.toArray();
    const sorted = allOps.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ops = cursor ? sorted.filter((op) => op.created_at > cursor) : sorted;
    const newCursor = sorted.length > 0 ? sorted[sorted.length - 1].created_at : (cursor ?? "");
    return { cursor: newCursor, ops };
  }
}
