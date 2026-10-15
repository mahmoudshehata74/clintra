import Dexie, { type Table } from "dexie";
import { ClintraDatabase } from "../db/database";
import { AuditAction, type SyncOp } from "../db/types";
import { id } from "../domain/id";
import type { AddStaffRequest, AddStaffResponse } from "./staffServer";
import { SYNCABLE_TABLES } from "./syncableTables";
import type { PulledChange, PullSinceResult, PushOpResult, SyncTransport } from "./transport";

/** The default name two tabs on the same device share, so they see one coherent server. */
export const FAKE_SERVER_DB_NAME = "clintra-fake-server";

/**
 * Resolves a sync_ops "entity" string to its Dexie table by asking the
 * database itself, via Dexie's own db.table(name) — the single source of
 * truth this reads from is the schema declared in database.ts, not a second
 * list maintained by hand here. Every entity string mutate()/write() call
 * sites use is already exactly its table's name (see docs/schema.md), so
 * there is nothing to keep in sync: three real bugs in a row happened
 * because a hand-maintained switch statement here was forgotten when a new
 * entity started being written elsewhere. db.table() throws its own
 * DexieError for a name that matches no table in the schema at all —
 * caught below only to attach the same fake_transport_unknown_entity
 * context this module has always thrown, not to change the outcome.
 */
function tableForEntity(db: ClintraDatabase, entity: string): Table<unknown, string> {
  try {
    return db.table(entity) as Table<unknown, string>;
  } catch {
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
    // The real server's per-op rule (SyncOpApplier's unknown_entity): an
    // entity it does not sync is refused for that op alone, even when a
    // local store of that name exists (users).
    if (!(SYNCABLE_TABLES as readonly string[]).includes(op.entity)) {
      return { op_id: op.op_id, status: "rejected", reason: "unknown_entity" };
    }
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
      // Fake never runs a real rev-versioning trigger (unlike the server's
      // enforce_row_rev() — api/docs/rls.md) — it simply echoes back
      // whatever rev the pushing device's own local row already carried,
      // which is good enough for a stand-in that exists to exercise the
      // *shape* of an accepted response, not real conflict semantics.
      const rev = (op.payload as { rev?: number } | null)?.rev ?? 1;
      return { op_id: op.op_id, status: "accepted", rev };
    });
  }

  /**
   * The demo stand-in for POST /api/staff: creates the membership and its
   * links exactly as add_staff_member(jsonb) returns them (rev 1, the
   * request's user_id), and records each as an applied op so every tab's
   * pull delivers it, as the server's ledger rows do. No users row and no
   * phone lookup — this fake holds no users — so it never answers
   * already_member, and it does not check who is asking. It holds no
   * organizations either, so the caller names the device's own
   * (sync/staffServer.ts's resolveStaffServer).
   */
  async addStaffMember(orgId: string, request: AddStaffRequest): Promise<AddStaffResponse> {
    const response: AddStaffResponse = {
      membership: {
        id: request.membership_id,
        user_id: request.user_id,
        org_id: orgId,
        role: request.role,
        location_scope: request.location_scope,
        practitioner_scope: request.practitioner_scope,
        practitioner_id: request.practitioner_id,
        pin_hash: request.pin_hash,
        pin_salt: request.pin_salt,
        is_active: true,
        display_name: request.display_name,
        rev: 1,
      },
      membership_locations: request.locations.map((link) => ({
        id: link.id,
        membership_id: request.membership_id,
        location_id: link.location_id,
        rev: 1,
      })),
      membership_practitioners: request.practitioners.map((link) => ({
        id: link.id,
        membership_id: request.membership_id,
        practitioner_id: link.practitioner_id,
        rev: 1,
      })),
    };
    const created: { entity: string; row: { id: string } }[] = [
      { entity: "memberships", row: response.membership },
      ...response.membership_locations.map((row) => ({ entity: "membership_locations", row })),
      ...response.membership_practitioners.map((row) => ({ entity: "membership_practitioners", row })),
    ];
    // One millisecond apart, in creation order: pullSince orders by
    // created_at, as the server's ledger orders by seq.
    const startMs = Date.now();
    await this.db.transaction(
      "rw",
      [this.db.memberships, this.db.membership_locations, this.db.membership_practitioners, this.db.sync_ops],
      async () => {
        for (const [index, { entity, row }] of created.entries()) {
          const at = new Date(startMs + index).toISOString();
          await tableForEntity(this.db, entity).put(row);
          await this.db.sync_ops.add({
            op_id: id(),
            entity,
            entity_id: row.id,
            action: AuditAction.Create,
            payload: row,
            device_id: "fake-server",
            created_at: at,
            synced_at: at,
            base_rev: null,
            failure_count: 0,
            next_retry_at: null,
          });
        }
      },
    );
    return response;
  }

  /**
   * Never paginates (hasMore is always false) and returns every applied op
   * reshaped into a PulledChange — entity/entity_id/rev/payload only, the
   * same trimmed-down shape the real pull endpoint returns, even though
   * Fake's own sync_ops rows happen to carry more (op_id, action, ...): the
   * point of Fake is to exercise callers against this interface, not to
   * leak its own richer internal representation through it.
   */
  async pullSince(cursor: string | null): Promise<PullSinceResult> {
    const allOps = await this.db.sync_ops.toArray();
    const sorted = allOps.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ops = cursor ? sorted.filter((op) => op.created_at > cursor) : sorted;
    const newCursor = sorted.length > 0 ? sorted[sorted.length - 1].created_at : (cursor ?? "");
    const changes: PulledChange[] = ops.map((op) => ({
      entity: op.entity,
      entity_id: op.entity_id,
      rev: (op.payload as { rev?: number } | null)?.rev ?? 1,
      payload: op.action === AuditAction.Delete ? null : (op.payload as Record<string, unknown>),
    }));
    return { cursor: newCursor, hasMore: false, changes };
  }

  /**
   * Fake stands in for a single-process test server whose own pullSince
   * already returns everything, unpaginated (no real ledger to page
   * through in the first place) — a separate windowed prefetch would have
   * nothing to usefully shortcut here. Always empty and immediately done,
   * so a test using Fake exercises the client's bootstrap-then-backfill
   * *sequencing* (it always runs, always completes instantly) without
   * Fake needing to model the windowing itself — that's HttpTransport's
   * job, tested against the real endpoint's behavior.
   */
  async pullBootstrap(): Promise<PullSinceResult> {
    return { cursor: "3:", hasMore: false, changes: [] };
  }
}
