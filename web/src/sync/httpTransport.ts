import type { SyncOp } from "../db/types";
import { SyncAuthError, type PullSinceResult, type PushOpResult, type SyncTransport } from "./transport";

/**
 * The wire shape POST /api/sync/push actually validates
 * (api/app/Http/Requests/PushSyncOpsRequest.php) — deliberately narrower
 * than the local SyncOp record, which also carries device_id, synced_at,
 * failure_count and next_retry_at: none of those are the server's business,
 * and sending them anyway would blur the line between "this device's own
 * bookkeeping" and "the op itself" that api/docs/rls.md's accept-or-reject
 * rule already depends on being sharp.
 */
function toWireOp(op: SyncOp) {
  return {
    op_id: op.op_id,
    entity: op.entity,
    entity_id: op.entity_id,
    action: op.action,
    payload: op.payload,
    created_at: op.created_at,
    base_rev: op.base_rev,
  };
}

export interface HttpTransportOptions {
  /**
   * The device's Sanctum bearer token, exactly as returned by
   * POST /api/devices/register. Required here, not read from anywhere
   * inside this class: nothing in web/ today actually calls that endpoint
   * or stores what it returns (db/deviceRegistration.ts's "registration" is
   * still the pre-existing local seed binding, unrelated to the real
   * server) — see this class's own doc comment below. A caller that has one
   * (a future registration flow, or a test) passes it in directly.
   */
  token: string;
  /** Defaults to "/api" — same-origin, matching how the Laravel app is deployed alongside this one. */
  baseUrl?: string;
  /** Overridable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Implements SyncTransport against the real POST /api/sync/push and
 * GET /api/sync/pull (api/docs/rls.md's "The sync push endpoint" / "The
 * sync pull endpoint"). FakeTransport remains the app's only wired-up
 * transport today (App.tsx) — this class exists and is fully tested against
 * a mocked fetch, but nothing in web/ can construct it with a real token
 * yet:
 *
 * db/deviceRegistration.ts's `ensureDeviceRegistration` binds a device to a
 * *locally seeded* org+location and has never called
 * POST /api/devices/register or stored a Sanctum token anywhere — there is
 * currently no field, table, or in-memory value in this app that holds one.
 * Wiring HttpTransportOptions.token up to a real credential is therefore a
 * separate, unbuilt task (the actual device-registration HTTP integration),
 * not something this class can paper over by inventing a storage location
 * that would need to be redone once that task lands. Until then, selecting
 * this transport is only ever done explicitly by a caller that already has
 * a token in hand (e.g. a test) — see selectSyncTransport in this same
 * file for the one seam that will switch over once that token exists.
 */
export class HttpTransport implements SyncTransport {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpTransportOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? "/api";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async pushOps(ops: readonly SyncOp[]): Promise<PushOpResult[]> {
    const body = await this.request("/sync/push", {
      method: "POST",
      body: JSON.stringify({ ops: ops.map(toWireOp) }),
    });
    return (body as { results: PushOpResult[] }).results;
  }

  async pullSince(cursor: string | null): Promise<PullSinceResult> {
    const query = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
    const body = (await this.request(`/sync/pull${query}`, { method: "GET" })) as {
      cursor: string;
      has_more: boolean;
      rows: Array<{ entity: string; entity_id: string; rev: number; payload: Record<string, unknown> | null }>;
    };

    return {
      cursor: body.cursor,
      hasMore: body.has_more,
      changes: body.rows.map((row) => ({
        entity: row.entity,
        entity_id: row.entity_id,
        rev: row.rev,
        payload: row.payload,
      })),
    };
  }

  private async request(path: string, init: { method: string; body?: string }): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init.method,
      body: init.body,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });

    if (response.status === 401) {
      throw new SyncAuthError();
    }
    if (!response.ok) {
      // Never the response body: api/docs/rls.md's "no response body
      // contains a SQLSTATE, query text, or any internal detail" is a
      // server-side guarantee, not a client-side one — this class doesn't
      // repeat that guarantee by inspecting or forwarding what the server
      // actually said, only the status it said it with.
      throw new Error(`sync_transport_http_error:${response.status}`);
    }

    return response.json();
  }
}

/**
 * The one seam that decides Fake vs. Http, per this task's own requirement
 * that the choice be explicit and default safe. Returns FakeTransport
 * whenever no token is available — which, per HttpTransport's own doc
 * comment, is every real call site in this app today — so nothing switches
 * over until a real device credential exists to pass in deliberately.
 */
export function selectSyncTransport(token: string | null, fakeTransport: SyncTransport): SyncTransport {
  return token === null ? fakeTransport : new HttpTransport({ token });
}
