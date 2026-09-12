import type { SyncOp } from "../db/types";

/**
 * The outcome of pushing one op, keyed back to it by op_id so a batch push
 * can report per-op results. Matches POST /api/sync/push's five statuses
 * exactly (api/app/Support/Sync/SyncOpApplier.php,
 * api/app/Http/Controllers/SyncPushController.php) — see
 * docs/sync-plan.md's Q2/Q11 for why there are five, not three.
 */
export type PushOpResult =
  /** rev is the row's new server rev; sync/engine.ts writes it back to the local row. */
  | { op_id: string; status: "accepted"; rev: number }
  /** The transport had already seen this exact op_id — proof of dedup, not an error. */
  | { op_id: string; status: "duplicate" }
  /** A genuine business conflict; reason is a short machine code (e.g. "conflict_slot_taken"), not free text. */
  | { op_id: string; status: "rejected"; reason: string }
  /** A server bug or unmodelled failure, never a business conflict — retried with backoff, never reviewed (Q11). */
  | { op_id: string; status: "failed"; reason: string }
  /** Never attempted: an earlier op in the same batch, same entity_id, was rejected or failed first (Q2). */
  | { op_id: string; status: "blocked" };

/** One row of server-side history this device does not have applied locally yet. */
export interface PulledChange {
  /** Matches db.table(entity) exactly — one of the 14 syncable tables. */
  entity: string;
  entity_id: string;
  /** The row's rev as of this change; written to the local row once applied. */
  rev: number;
  /** The entity's current full state, or null when it has since been deleted. */
  payload: Record<string, unknown> | null;
}

export interface PullSinceResult {
  /** Opaque; pass back on the next call to resume from here. */
  cursor: string;
  /** True when more remains beyond this page — call again with `cursor` before considering a pull cycle done. */
  hasMore: boolean;
  /** Changes the server has that this device does not, oldest first. */
  changes: PulledChange[];
}

/**
 * The seam a real Laravel backend slots into. No call site anywhere in this
 * app is allowed to hardcode which implementation it talks to — every caller
 * takes a SyncTransport and depends on nothing beyond this interface.
 * FakeTransport (sync/fakeTransport.ts) implements it against a second local
 * database standing in for the network, for tests and for the app until a
 * real device credential exists to construct HttpTransport with (see its own
 * doc comment in sync/httpTransport.ts for why that switch isn't wired up
 * yet). Both implementations must return exactly this shape regardless of
 * how differently their underlying "servers" are built.
 */
export interface SyncTransport {
  /** Pushes ops (any order the caller likes) and returns one result per op, in the same order. */
  pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]>;
  /** Pulls one page of changes recorded since cursor (null for everything). */
  pullSince(cursor: string | null): Promise<PullSinceResult>;
}

/**
 * Thrown by a SyncTransport when the server rejects the request's
 * credential outright (HTTP 401) — distinct from every PushOpResult/pull
 * failure above, which all mean "the request was authenticated but this
 * particular op/page has a problem." An expired or revoked device
 * credential is a different class of fact the assistant can actually act
 * on (re-register the device), so sync/engine.ts must never let this reach
 * a generic `console.error` the way an ordinary thrown transport error
 * still does (docs/sync-plan.md's Q10) — see engine.ts's own handling.
 */
export class SyncAuthError extends Error {
  constructor() {
    super("sync_unauthenticated");
    this.name = "SyncAuthError";
  }
}
