import { afterEach, expect, it, vi } from "vitest";
import { ClintraDatabase } from "../db/database";
import { getDeviceId } from "../db/deviceRegistration";
import type { SyncOp } from "../db/types";
import { startSyncEngine } from "./engine";
import { HttpTransport } from "./httpTransport";
import { isOrganizationSuspended, setOrganizationSuspended } from "./organizationSuspension";
import { SyncOrganizationSuspendedError, type SyncTransport } from "./transport";

afterEach(() => {
  setOrganizationSuspended(false);
  vi.useRealTimers();
});

it("recognizes the specific suspension response and clears it after a successful pull", async () => {
  let disabled = true;
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(disabled
    ? { error: "org_disabled" }
    : { cursor: "0", has_more: false, rows: [] }), { status: disabled ? 403 : 200 }));
  const transport = new HttpTransport({ token: "test", fetchImpl });
  await expect(transport.pullSince(null)).rejects.toBeInstanceOf(SyncOrganizationSuspendedError);
  expect(isOrganizationSuspended()).toBe(true);
  disabled = false;
  await transport.pullSince(null);
  expect(isOrganizationSuspended()).toBe(false);
});

it("keeps queued operations and probes once after 15 minutes before resuming", async () => {
  const db = new ClintraDatabase("suspension-" + crypto.randomUUID());
  await db.device.put({ id: getDeviceId(), org_id: "org", location_id: "location", membership_id: null,
    token: null, registered_at: new Date().toISOString(), series: 1, pull_cursor: "0" });
  const op: SyncOp = {
    op_id: crypto.randomUUID(), entity: "patients", entity_id: crypto.randomUUID(), action: "create",
    payload: { full_name: "مريض اختبار" }, device_id: getDeviceId(), created_at: new Date().toISOString(),
    base_rev: null, synced_at: null, failure_count: 0, next_retry_at: null,
  };
  await db.sync_ops.put(op);
  let disabled = true;
  const pull = vi.fn(async () => {
    if (disabled) throw new SyncOrganizationSuspendedError();
    return { cursor: "0", hasMore: false, changes: [] };
  });
  const push = vi.fn<SyncTransport["pushOps"]>(async (ops) => {
    if (disabled) throw new SyncOrganizationSuspendedError();
    return ops.map((queued) => ({ op_id: queued.op_id, status: "duplicate" }));
  });
  const transport: SyncTransport = { pushOps: push, pullSince: pull, pullBootstrap: pull };
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const handle = startSyncEngine(db, transport);
  try {
    await vi.waitFor(() => expect(isOrganizationSuspended()).toBe(true));
    expect(await db.sync_ops.get(op.op_id)).toEqual(op);
    const requests = push.mock.calls.length;
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    handle.triggerSync();
    expect(push).toHaveBeenCalledTimes(requests);
    expect(pull).toHaveBeenCalledTimes(0);
    disabled = false;
    // The deadline is measured from the refused request's completion,
    // and the ordinary engine timer checks it on its next 10-second tick.
    await vi.advanceTimersByTimeAsync(70_000);
    await vi.waitFor(async () => expect((await db.sync_ops.get(op.op_id))?.synced_at).not.toBeNull());
    expect(isOrganizationSuspended()).toBe(false);
    expect(push).toHaveBeenCalledTimes(requests + 1);
    expect(pull.mock.calls.length).toBeGreaterThanOrEqual(1);
  } finally {
    handle.stop();
    await db.delete();
  }
});
