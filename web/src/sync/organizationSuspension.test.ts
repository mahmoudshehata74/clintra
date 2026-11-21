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

it.each(["pushOps", "pullSince", "pullBootstrap", "pushAuditRows", "pullAuditSince"] as const)(
  "%s recognizes org_disabled without treating it as an auth or network failure", async (method) => {
    const transport = new HttpTransport({ token: "test", fetchImpl: async () => new Response(JSON.stringify({ error: "org_disabled" }), { status: 403 }) });
    const request = method === "pushOps" ? transport.pushOps([])
      : method === "pushAuditRows" ? transport.pushAuditRows([]) : transport[method](null);
    await expect(request).rejects.toBeInstanceOf(SyncOrganizationSuspendedError);
    expect(isOrganizationSuspended()).toBe(true);
  },
);

it("a refused bootstrap stops immediately and every mutation trigger stays quiet until the deadline", async () => {
  const db = new ClintraDatabase("disabled-bootstrap-" + crypto.randomUUID());
  await db.device.put({ id: getDeviceId(), org_id: "org", location_id: "location", membership_id: null,
    token: null, registered_at: new Date().toISOString(), series: 1, pull_cursor: null });
  const bootstrap = vi.fn(async () => { throw new SyncOrganizationSuspendedError(); });
  const pull = vi.fn(async () => ({ cursor: "0", hasMore: false, changes: [] }));
  const push = vi.fn(async () => []);
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const handle = startSyncEngine(db, { pushOps: push, pullSince: pull, pullBootstrap: bootstrap });
  try {
    await vi.waitFor(() => expect(isOrganizationSuspended()).toBe(true));
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    for (let i = 0; i < 5; i++) handle.triggerSync();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(pull).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(70_000);
    await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(2));
    expect(pull).not.toHaveBeenCalled();
  } finally {
    handle.stop();
    await db.delete();
  }
});

it("an audit suspension pauses the same engine without deleting the audit watermark or queued work", async () => {
  const db = new ClintraDatabase("disabled-audit-" + crypto.randomUUID());
  await db.device.put({ id: getDeviceId(), org_id: "org", location_id: "location", membership_id: null,
    token: null, registered_at: new Date().toISOString(), series: 1, pull_cursor: "0", audit_pull_cursor: "7" });
  const pull = vi.fn(async () => ({ cursor: "0", hasMore: false, changes: [] }));
  const auditPull = vi.fn(async () => { throw new SyncOrganizationSuspendedError(); });
  const transport = { pushOps: vi.fn(async () => []), pullSince: pull, pullBootstrap: pull,
    pushAuditRows: vi.fn(async () => []), pullAuditSince: auditPull };
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const handle = startSyncEngine(db, transport);
  try {
    await vi.waitFor(() => expect(isOrganizationSuspended()).toBe(true));
    const requests = pull.mock.calls.length;
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    handle.triggerSync();
    expect(pull).toHaveBeenCalledTimes(requests);
    expect(auditPull).toHaveBeenCalledTimes(1);
    expect((await db.device.get(getDeviceId()))?.audit_pull_cursor).toBe("7");
  } finally {
    handle.stop();
    await db.delete();
  }
});
