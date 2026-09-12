import { describe, expect, it, vi } from "vitest";
import { id } from "../domain/id";
import { AuditAction, type SyncOp } from "../db/types";
import { HttpTransport, selectSyncTransport } from "./httpTransport";
import { SyncAuthError } from "./transport";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A properly-typed fetch mock — mockImplementation's callback may take fewer params than typeof fetch declares, so call sites below never need to name (and then ignore) url/init. */
function fetchMock(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>();
}

function makeOp(overrides: Partial<SyncOp> = {}): SyncOp {
  return {
    op_id: id(),
    entity: "patients",
    entity_id: id(),
    action: AuditAction.Create,
    payload: { full_name: "مريض اختبار" },
    device_id: "device-1",
    created_at: "2026-09-07T06:00:00.000Z",
    synced_at: null,
    base_rev: null,
    failure_count: 0,
    next_retry_at: null,
    ...overrides,
  };
}

describe("HttpTransport.pushOps", () => {
  it("sends the token as a Bearer header and the wire-only op fields, never the local bookkeeping fields", async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockImplementation(async () => jsonResponse(200, { results: [] }));
    const transport = new HttpTransport({ token: "test-token", fetchImpl });
    const op = makeOp({ base_rev: 3, action: AuditAction.Update, failure_count: 2 });

    await transport.pushOps([op]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/sync/push");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");

    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toEqual({
      ops: [
        {
          op_id: op.op_id,
          entity: op.entity,
          entity_id: op.entity_id,
          action: op.action,
          payload: op.payload,
          created_at: op.created_at,
          base_rev: 3,
        },
      ],
    });
    expect(sentBody.ops[0]).not.toHaveProperty("device_id");
    expect(sentBody.ops[0]).not.toHaveProperty("failure_count");
  });

  it("passes through each of the five PushOpResult statuses exactly as the server returned them", async () => {
    const results = [
      { op_id: "1", status: "accepted", rev: 4 },
      { op_id: "2", status: "duplicate" },
      { op_id: "3", status: "rejected", reason: "conflict_slot_taken" },
      { op_id: "4", status: "failed", reason: "internal_error" },
      { op_id: "5", status: "blocked" },
    ];
    const fetchImpl = fetchMock();
    fetchImpl.mockImplementation(async () => jsonResponse(200, { results }));
    const transport = new HttpTransport({ token: "test-token", fetchImpl });

    const ops = results.map((r) => makeOp({ op_id: r.op_id }));
    const outcome = await transport.pushOps(ops);

    expect(outcome).toEqual(results);
  });

  it("throws SyncAuthError on a 401, never swallowing it as a generic failure", async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockImplementation(async () => jsonResponse(401, { error: "unauthenticated" }));
    const transport = new HttpTransport({ token: "expired-token", fetchImpl });

    await expect(transport.pushOps([makeOp()])).rejects.toBeInstanceOf(SyncAuthError);
  });

  it("throws a generic error on a non-401 failure without leaking the response body", async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockImplementation(
      async () =>
        new Response("SQLSTATE[42501] some internal detail", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
    );
    const transport = new HttpTransport({ token: "test-token", fetchImpl });

    await expect(transport.pushOps([makeOp()])).rejects.toThrow(/^sync_transport_http_error:500$/);
  });
});

describe("HttpTransport.pullSince", () => {
  it("omits the cursor query param when null, and maps has_more/rows to hasMore/changes", async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockImplementation(async () =>
      jsonResponse(200, {
        cursor: "42",
        has_more: true,
        rows: [{ entity: "patients", entity_id: "p1", rev: 2, payload: { id: "p1", full_name: "x" } }],
      }),
    );
    const transport = new HttpTransport({ token: "test-token", fetchImpl });

    const result = await transport.pullSince(null);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/sync/pull");
    expect(init?.method).toBe("GET");
    expect(result).toEqual({
      cursor: "42",
      hasMore: true,
      changes: [{ entity: "patients", entity_id: "p1", rev: 2, payload: { id: "p1", full_name: "x" } }],
    });
  });

  it("includes the cursor query param when given one", async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockImplementation(async () => jsonResponse(200, { cursor: "43", has_more: false, rows: [] }));
    const transport = new HttpTransport({ token: "test-token", fetchImpl });

    await transport.pullSince("42");

    expect(fetchImpl.mock.calls[0][0]).toBe("/api/sync/pull?cursor=42");
  });

  it("throws SyncAuthError on a 401", async () => {
    const fetchImpl = fetchMock();
    fetchImpl.mockImplementation(async () => jsonResponse(401, { error: "unauthenticated" }));
    const transport = new HttpTransport({ token: "expired-token", fetchImpl });

    await expect(transport.pullSince(null)).rejects.toBeInstanceOf(SyncAuthError);
  });
});

describe("selectSyncTransport", () => {
  it("returns the given fallback (Fake) when no token is available", () => {
    const fallback = { pushOps: vi.fn(), pullSince: vi.fn() };
    expect(selectSyncTransport(null, fallback)).toBe(fallback);
  });

  it("returns an HttpTransport when a token is available", () => {
    const fallback = { pushOps: vi.fn(), pullSince: vi.fn() };
    const selected = selectSyncTransport("real-token", fallback);
    expect(selected).toBeInstanceOf(HttpTransport);
  });
});
