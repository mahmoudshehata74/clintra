import { describe, expect, it } from "vitest";
import { AuditAction, type SyncOp } from "../db/types";
import { chainBaseRevs, rebaseUnsent } from "./baseRevChain";

function op(opId: string, entityId: string, action: AuditAction, baseRev: number | null): SyncOp {
  return {
    op_id: opId,
    entity: "visits",
    entity_id: entityId,
    action,
    payload: {},
    device_id: "device-1",
    created_at: "2026-10-16T09:00:00.000Z",
    synced_at: null,
    base_rev: baseRev,
    failure_count: 0,
    next_retry_at: null,
  };
}

describe("chainBaseRevs", () => {
  it("bases each later update of a row, written on the same pre-image, on the rev the one before produces", () => {
    const batch = [op("a", "v1", AuditAction.Update, 4), op("b", "v1", AuditAction.Update, 4), op("c", "v1", AuditAction.Update, 4)];
    expect(chainBaseRevs(batch).map((sent) => sent.base_rev)).toEqual([4, 5, 6]);
    expect(batch.map((stored) => stored.base_rev)).toEqual([4, 4, 4]);
  });

  it("bases the updates after a create on rev 1, then on from there", () => {
    const batch = [op("a", "v1", AuditAction.Create, null), op("b", "v1", AuditAction.Update, 1), op("c", "v1", AuditAction.Update, 1)];
    expect(chainBaseRevs(batch).map((sent) => sent.base_rev)).toEqual([null, 1, 2]);
  });

  it("keeps each row's chain to itself", () => {
    const batch = [op("a", "v1", AuditAction.Update, 1), op("b", "v2", AuditAction.Update, 7), op("c", "v1", AuditAction.Update, 1)];
    expect(chainBaseRevs(batch).map((sent) => sent.base_rev)).toEqual([1, 7, 2]);
  });

  it("leaves an update written on a newer pulled version alone", () => {
    const batch = [op("a", "v1", AuditAction.Update, 1), op("b", "v1", AuditAction.Update, 5)];
    expect(chainBaseRevs(batch).map((sent) => sent.base_rev)).toEqual([1, 5]);
  });

  it("bases a delete after an update on the update's rev", () => {
    const batch = [op("a", "v1", AuditAction.Update, 2), op("b", "v1", AuditAction.Delete, 2)];
    expect(chainBaseRevs(batch).map((sent) => sent.base_rev)).toEqual([2, 3]);
  });
});

describe("rebaseUnsent", () => {
  it("moves the row's unsent ops on the same pre-image to its last accepted rev", () => {
    const batch = [op("a", "v1", AuditAction.Update, 1), op("b", "v1", AuditAction.Update, 1)];
    const unsent = [batch[1], op("c", "v1", AuditAction.Update, 1)];
    expect(
      rebaseUnsent(
        batch,
        [
          { op_id: "a", status: "accepted", rev: 2 },
          { op_id: "b", status: "failed", reason: "server_error" },
        ],
        unsent,
      ),
    ).toEqual([
      { opId: "b", baseRev: 2 },
      { opId: "c", baseRev: 2 },
    ]);
  });

  it("leaves ops on another pre-image, another row, and settled ones alone", () => {
    const batch = [op("a", "v1", AuditAction.Update, 1)];
    const unsent = [op("b", "v1", AuditAction.Update, 3), op("c", "v2", AuditAction.Update, 1), batch[0]];
    expect(rebaseUnsent(batch, [{ op_id: "a", status: "accepted", rev: 2 }], unsent)).toEqual([]);
  });

  it("does nothing after a create or a rejection", () => {
    const batch = [op("a", "v1", AuditAction.Create, null), op("b", "v2", AuditAction.Update, 1)];
    const unsent = [op("c", "v1", AuditAction.Update, 1), op("d", "v2", AuditAction.Update, 1)];
    expect(
      rebaseUnsent(
        batch,
        [
          { op_id: "a", status: "accepted", rev: 1 },
          { op_id: "b", status: "rejected", reason: "conflict" },
        ],
        unsent,
      ),
    ).toEqual([]);
  });
});
