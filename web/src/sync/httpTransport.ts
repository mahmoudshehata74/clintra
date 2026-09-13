import { getApiBaseUrl } from "../config/apiBaseUrl";
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
  /** Defaults to config/apiBaseUrl.ts's getApiBaseUrl() — the build-time VITE_API_BASE_URL, or "/api" if unset. */
  baseUrl?: string;
  /** Overridable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Implements SyncTransport against the real POST /api/sync/push,
 * GET /api/sync/pull, and GET /api/sync/bootstrap (api/docs/rls.md's "The
 * sync push endpoint" / "The sync pull endpoint" / "The sync bootstrap
 * endpoint"). Wired up in the running app by `selectSyncTransport` below,
 * whenever a device holds a real token — `db/registration.ts`'s
 * `registerDevice` is what stores one, on every real
 * `POST /api/devices/register` success. `App.tsx` reads it back
 * (`db.device.toArray()`, the row whose `token` is non-null) and passes it
 * here; `FakeTransport` is only ever selected for a device with no real
 * token (demo mode's seed-bound device row).
 */
export class HttpTransport implements SyncTransport {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpTransportOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? getApiBaseUrl();
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

  async pullBootstrap(cursor: string | null): Promise<PullSinceResult> {
    const query = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
    const body = (await this.request(`/sync/bootstrap${query}`, { method: "GET" })) as {
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
 * The one seam that decides Fake vs. Http, kept explicit and default-safe:
 * returns FakeTransport whenever no token is available (demo mode; a
 * device row that was never really registered), and a real HttpTransport
 * — pointed at getApiBaseUrl() — the moment one is.
 */
export function selectSyncTransport(token: string | null, fakeTransport: SyncTransport): SyncTransport {
  return token === null ? fakeTransport : new HttpTransport({ token });
}
