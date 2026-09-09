import type { SyncOp } from "../db/types";

/** The outcome of pushing one op, keyed back to it by op_id so a batch push can report per-op results. */
export type PushOpResult =
  | { op_id: string; status: "accepted" }
  /** The transport had already seen this exact op_id — proof of dedup, not an error. */
  | { op_id: string; status: "duplicate" }
  /** The op cannot be applied as-is; reason is a short machine code (e.g. "conflict_slot_taken"), not free text. */
  | { op_id: string; status: "rejected"; reason: string };

export interface PullSinceResult {
  /** Opaque; pass back on the next call to resume from here. Null means "from the beginning". */
  cursor: string;
  /** Changes the server has that this device does not, oldest first. */
  ops: SyncOp[];
}

/**
 * The seam a real Laravel backend slots into. No call site anywhere in this
 * app is allowed to hardcode which implementation it talks to — every caller
 * takes a SyncTransport and depends on nothing beyond this interface. Until
 * a real server exists, FakeTransport (sync/fakeTransport.ts) implements it
 * against a second local database standing in for the network.
 */
export interface SyncTransport {
  /** Pushes ops (any order the caller likes) and returns one result per op, in the same order. */
  pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]>;
  /** Pulls changes the server has recorded since cursor (null for everything). */
  pullSince(cursor: string | null): Promise<PullSinceResult>;
}
