import { getApiBaseUrl } from "../config/apiBaseUrl";
import { getActiveMembershipId } from "../auth/session";
import { identityClock } from "../auth/identityClient";
import { requestProof } from "../auth/proof";
import type { ClintraDatabase } from "../db/database";
import type { Membership, MembershipLocation, MembershipPractitioner } from "../db/types";
import type { LocationScope, PractitionerScope } from "../domain/scope";
import type { Role } from "../domain/role";
import { FakeTransport } from "./fakeTransport";

/**
 * POST /api/staff's body (api/app/Http/Requests/AddStaffMemberRequest.php).
 * Every id is minted on the device; the PIN arrives hashed. user_id is used
 * only when the phone is new on the server — an existing phone keeps its own
 * user, and the response's membership.user_id says which.
 */
export interface AddStaffRequest {
  membership_id: string;
  user_id: string;
  display_name: string;
  /** E.164. */
  phone: string;
  role: Role;
  location_scope: LocationScope;
  practitioner_scope: PractitionerScope;
  practitioner_id: string | null;
  pin_hash: string;
  pin_salt: string;
  locations: { id: string; location_id: string }[];
  practitioners: { id: string; practitioner_id: string }[];
}

/** The rows the server created, exactly as it holds them (rev 1 each). Never a users row. */
export interface AddStaffResponse {
  membership: Membership;
  membership_locations: MembershipLocation[];
  membership_practitioners: MembershipPractitioner[];
}

export type StaffServerFailure =
  /** The phone already belongs to this organization's staff (409). */
  | "already_member"
  /** The server refused who is asking or what they named (404 — it never says which). */
  | "not_allowed"
  /** The server could not be reached. */
  | "unreachable"
  /** Anything else: a refused shape (422), a lost credential (401), a server error. */
  | "failed";

export class StaffServerError extends Error {
  readonly reason: StaffServerFailure;

  constructor(reason: StaffServerFailure) {
    super(`staff_server_${reason}`);
    this.reason = reason;
  }
}

/**
 * Where a staff member is added: always the server, never the local queue —
 * users is not syncable, so a member added on the device could never reach
 * the server (docs/sync-plan.md's "Adding staff").
 */
export interface StaffServer {
  addStaffMember(request: AddStaffRequest): Promise<AddStaffResponse>;
}

/** The real POST /api/staff, authenticated by the device token like sync. */
export class HttpStaffServer implements StaffServer {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly identityHeaders?: (url: string, body: string) => Promise<Record<string, string>>;

  // The default calls the global fetch as a plain function: stored and
  // called as this.fetchImpl(...), a browser refuses fetch itself ("Illegal
  // invocation") before any request leaves.
  constructor(
    token: string, baseUrl: string = getApiBaseUrl(), fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    identityHeaders?: HttpStaffServer["identityHeaders"],
  ) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.identityHeaders = identityHeaders;
  }

  async addStaffMember(request: AddStaffRequest): Promise<AddStaffResponse> {
    let response: Response;
    try {
      const url = `${this.baseUrl}/staff`;
      const body = JSON.stringify(request);
      const proofs = await this.identityHeaders?.(url, body);
      response = await this.fetchImpl(url, {
        method: "POST",
        body,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...proofs,
        },
      });
    } catch {
      throw new StaffServerError("unreachable");
    }
    if (response.status === 201) {
      return (await response.json()) as AddStaffResponse;
    }
    // Only the status, never the body — the same rule as HttpTransport.
    throw new StaffServerError(response.status === 409 ? "already_member" : response.status === 404 ? "not_allowed" : "failed");
  }
}

/**
 * The staff server for this device: the real endpoint once the device holds
 * a token, the demo server otherwise — the same choice
 * selectSyncTransport makes for sync.
 */
export async function resolveStaffServer(db: ClintraDatabase, orgId: string): Promise<StaffServer> {
  const device = (await db.device.toArray()).find((row) => row.token !== null);
  if (device?.token) {
    const baseUrl = getApiBaseUrl();
    return new HttpStaffServer(device.token, baseUrl, undefined, async (url, body) => {
      const key = await db.device_keys.get(device.id);
      if (!key?.bound) return {};
      const membership = getActiveMembershipId();
      const person = membership
        ? await db.credentials.where("[device_id+membership_id]").equals([device.id, membership]).first()
        : undefined;
      const time = await identityClock(baseUrl);
      const proofs: Record<string, string> = {
        "X-Clintra-Device-Proof": await requestProof(key.private_key, "POST", url, body, time),
      };
      if (person && !person.must_change_password) {
        proofs["X-Clintra-Person-Proof"] = await requestProof(person.private_key, "POST", url, body, time, person.id);
      }
      return proofs;
    });
  }
  const demo = new FakeTransport();
  return { addStaffMember: (request) => demo.addStaffMember(orgId, request) };
}
