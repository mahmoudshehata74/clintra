import { getApiBaseUrl } from "../config/apiBaseUrl";
import { identityClock } from "../auth/identityClient";
import { requestProof } from "../auth/proof";
import { remoteAuditRowOf } from "../db/auditEntries";
import { setOrganizationSuspended } from "./organizationSuspension";
import type { RemoteAuditLog, SyncOp } from "../db/types";
import {
  SyncAuthError,
  SyncOrganizationSuspendedError,
  type AuditTransport,
  type PullAuditResult,
  type PullSinceResult,
  type PushAuditResult,
  type PushOpResult,
  type SyncTransport,
  type WireAuditRow,
} from "./transport";

/**
 * The wire shape POST /api/sync/push actually validates
 * (api/app/Http/Requests/PushSyncOpsRequest.php) — deliberately narrower
 * than the local SyncOp record, which also carries device_id, synced_at,
 * failure_count and next_retry_at: none of those are the server's business,
 * and sending them anyway would blur the line between "this device's own
 * bookkeeping" and "the op itself" that api/docs/rls.md's accept-or-reject
 * rule already depends on being sharp.
 */
/**
 * An op as POST /api/sync/push takes it. A create has no base_rev and must
 * not send one, not even as null: the server prohibits it on a create and
 * otherwise wants an integer (api's PushSyncOpsRequest), so a null there
 * failed the whole batch's validation.
 */
function toWireOp(op: SyncOp) {
  return {
    op_id: op.op_id,
    entity: op.entity,
    entity_id: op.entity_id,
    action: op.action,
    payload: op.payload,
    created_at: op.created_at,
    ...(op.base_rev === null ? {} : { base_rev: op.base_rev }),
    ...(op.group_id === undefined ? {} : { group_id: op.group_id }),
    ...(op.credential_id && op.proof ? { credential_id: op.credential_id, proof: op.proof } : {}),
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
  deviceKey?: () => Promise<CryptoKey | undefined>;
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
export class HttpTransport implements SyncTransport, AuditTransport {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly deviceKey?: HttpTransportOptions["deviceKey"];

  constructor(options: HttpTransportOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? getApiBaseUrl();
    // The global fetch must be called as a plain function: stored on this
    // object and called as this.fetchImpl(...), a browser refuses it
    // ("Illegal invocation") before any request leaves.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.deviceKey = options.deviceKey;
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
      device_series?: number | null;
      code_notices?: PullSinceResult["codeNotices"];
      support_sessions?: PullSinceResult["supportSessions"];
      identity_enforced_at?: string;
      identity_rollout_auto_at?: string;
      identity_memberships?: PullSinceResult["identityMemberships"];
    };

    return {
      cursor: body.cursor,
      hasMore: body.has_more,
      deviceSeries: body.device_series,
      ...(body.code_notices === undefined ? {} : { codeNotices: body.code_notices }),
      ...(body.support_sessions === undefined ? {} : { supportSessions: body.support_sessions }),
      identityEnforcedAt: body.identity_enforced_at ?? null,
      ...(body.identity_rollout_auto_at === undefined && body.identity_enforced_at === undefined
        ? {} : { identityRolloutAutoAt: body.identity_rollout_auto_at ?? null }),
      ...(body.identity_memberships === undefined ? {} : { identityMemberships: body.identity_memberships }),
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
      device_series?: number | null;
      code_notices?: PullSinceResult["codeNotices"];
      support_sessions?: PullSinceResult["supportSessions"];
      identity_enforced_at?: string;
      identity_rollout_auto_at?: string;
      identity_memberships?: PullSinceResult["identityMemberships"];
    };

    return {
      cursor: body.cursor,
      hasMore: body.has_more,
      deviceSeries: body.device_series,
      ...(body.code_notices === undefined ? {} : { codeNotices: body.code_notices }),
      ...(body.support_sessions === undefined ? {} : { supportSessions: body.support_sessions }),
      identityEnforcedAt: body.identity_enforced_at ?? null,
      ...(body.identity_rollout_auto_at === undefined && body.identity_enforced_at === undefined
        ? {} : { identityRolloutAutoAt: body.identity_rollout_auto_at ?? null }),
      ...(body.identity_memberships === undefined ? {} : { identityMemberships: body.identity_memberships }),
      changes: body.rows.map((row) => ({
        entity: row.entity,
        entity_id: row.entity_id,
        rev: row.rev,
        payload: row.payload,
      })),
    };
  }

  async pushAuditRows(rows: readonly WireAuditRow[]): Promise<PushAuditResult[]> {
    const body = await this.request("/audit/push", { method: "POST", body: JSON.stringify({ rows }) });
    return (body as { results: PushAuditResult[] }).results;
  }

  async pullAuditSince(cursor: string | null): Promise<PullAuditResult> {
    const query = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
    const body = (await this.request(`/audit/pull${query}`, { method: "GET" })) as {
      cursor: string;
      has_more: boolean;
      rows: Array<RemoteAuditLog & { seq: number }>;
    };

    return {
      cursor: body.cursor,
      hasMore: body.has_more,
      // The server's seq is the cursor's business, not the row's.
      rows: body.rows.map(remoteAuditRowOf),
    };
  }

  private async request(path: string, init: { method: string; body?: string }): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const key = await this.deviceKey?.();
    const proof = key ? await requestProof(key, init.method, url, init.body ?? "", await identityClock(this.baseUrl)) : null;
    const response = await this.fetchImpl(url, {
      method: init.method,
      body: init.body,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(proof ? { "X-Clintra-Device-Proof": proof } : {}),
      },
    });

    if (response.status === 401) {
      throw new SyncAuthError();
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (body?.error === "support_read_only") throw new Error("جهاز الدعم للقراءة بس، مفيش تغيير بيتحفظ منه");
      if (body?.error === "org_disabled") {
        setOrganizationSuspended(true);
        throw new SyncOrganizationSuspendedError();
      }
    }
    if (!response.ok) {
      // Never the response body: api/docs/rls.md's "no response body
      // contains a SQLSTATE, query text, or any internal detail" is a
      // server-side guarantee, not a client-side one — this class doesn't
      // repeat that guarantee by inspecting or forwarding what the server
      // actually said, only the status it said it with.
      throw new Error(`sync_transport_http_error:${response.status}`);
    }

    if (path.startsWith("/sync/pull") || path.startsWith("/sync/bootstrap")) setOrganizationSuspended(false);
    return response.json();
  }
}

/**
 * The one seam that decides Fake vs. Http, kept explicit and default-safe:
 * returns FakeTransport whenever no token is available (demo mode; a
 * device row that was never really registered), and a real HttpTransport
 * — pointed at getApiBaseUrl() — the moment one is.
 */
export function selectSyncTransport(token: string | null, fakeTransport: SyncTransport, deviceKey?: HttpTransportOptions["deviceKey"]): SyncTransport {
  return token === null ? fakeTransport : new HttpTransport({ token, deviceKey });
}
