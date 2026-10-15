import { generatePinSalt, hashPin } from "../auth/pinHash";
import { id } from "../domain/id";
import { normalizeEgyptianPhone } from "../domain/phone";
import { Role } from "../domain/role";
import { normalizeStaffName } from "../domain/staffName";
import { LocationScope, PractitionerScope } from "../domain/scope";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { StaffServerError, type AddStaffResponse, type StaffServer, type StaffServerFailure } from "../sync/staffServer";
import { mutate, recordServerCreatedRow } from "./mutate";
import { AuditAction, type Membership } from "./types";

export interface NewStaffInput {
  orgId: string;
  /** The name this organization uses for the member (memberships.display_name); trimmed here. */
  fullName: string;
  /** Raw entry; normalised to E.164 here. */
  phone: string;
  role: Role;
  locationScope: LocationScope;
  practitionerScope: PractitionerScope;
  /** Used when locationScope is "listed". */
  listedLocationIds: readonly string[];
  /** Used when practitionerScope is "listed" (any number) or "self" (exactly one). */
  listedPractitionerIds: readonly string[];
  /** 4-digit PIN, hashed here. */
  pin: string;
}

export type AddStaffResult =
  | { ok: true; membershipId: string }
  | {
      ok: false;
      reason:
        | "invalid_phone"
        | "practitioner_required"
        | "name_required"
        | "name_too_long"
        /** No connection: nothing was sent and nothing written. */
        | "offline"
        /** The phone already belongs to this organization's staff. */
        | "phone_taken"
        /** The server refused (not an active owner, or a location or practitioner not this organization's). */
        | "not_allowed"
        | "failed";
    };

const SERVER_FAILURE_REASON: Record<StaffServerFailure, Extract<AddStaffResult, { ok: false }>["reason"]> = {
  already_member: "phone_taken",
  not_allowed: "not_allowed",
  unreachable: "offline",
  failed: "failed",
};

/**
 * Adds a staff member, online only and on the server in one step
 * (POST /api/staff — the server finds the user by phone or creates it, then
 * creates the membership, its links and the audit row). The device never
 * writes a users row: users is not syncable, and a queued users op used to
 * leave every upload stuck behind it. Offline, it refuses ("offline") before
 * hashing anything and writes nothing.
 *
 * On success the rows the server returns — the membership (carrying the
 * name as display_name) and its membership_locations /
 * membership_practitioners links — are stored here at once, with a local
 * audit row each and no sync op, so the new member can sign in on this
 * device straight away; other devices pull them.
 */
export async function addStaffMember(
  db: ClintraDatabase,
  server: StaffServer,
  input: NewStaffInput,
  isOnline: boolean,
): Promise<AddStaffResult> {
  const name = normalizeStaffName(input.fullName);
  if (!name.ok) {
    return { ok: false, reason: name.reason };
  }
  const phone = normalizeEgyptianPhone(input.phone);
  if (!phone.ok) {
    return { ok: false, reason: "invalid_phone" };
  }
  if (input.practitionerScope === PractitionerScope.Self && input.listedPractitionerIds.length !== 1) {
    return { ok: false, reason: "practitioner_required" };
  }
  if (!isOnline) {
    return { ok: false, reason: "offline" };
  }

  const actor = await resolveActingMembership(db);
  const pinSalt = generatePinSalt();
  const pinHash = hashPin(input.pin, pinSalt);
  const membershipId = id();

  let response: AddStaffResponse;
  try {
    response = await server.addStaffMember({
      membership_id: membershipId,
      user_id: id(),
      display_name: name.value,
      phone: phone.value,
      role: input.role,
      location_scope: input.locationScope,
      practitioner_scope: input.practitionerScope,
      practitioner_id: input.practitionerScope === PractitionerScope.Self ? input.listedPractitionerIds[0] : null,
      pin_hash: pinHash,
      pin_salt: pinSalt,
      locations:
        input.locationScope === LocationScope.Listed
          ? input.listedLocationIds.map((locationId) => ({ id: id(), location_id: locationId }))
          : [],
      practitioners:
        input.practitionerScope === PractitionerScope.Listed
          ? input.listedPractitionerIds.map((practitionerId) => ({ id: id(), practitioner_id: practitionerId }))
          : [],
    });
  } catch (error) {
    return { ok: false, reason: error instanceof StaffServerError ? SERVER_FAILURE_REASON[error.reason] : "failed" };
  }

  await db.transaction("rw", [db.memberships, db.membership_locations, db.membership_practitioners, db.audit_log], async () => {
    const write = { actorMembershipId: actor.id, orgId: input.orgId };
    const membership = response.membership;
    await recordServerCreatedRow(db, { table: db.memberships, entity: "memberships", entityId: membership.id, row: membership, ...write });
    for (const link of response.membership_locations) {
      await recordServerCreatedRow(db, {
        table: db.membership_locations,
        entity: "membership_locations",
        entityId: link.id,
        row: link,
        ...write,
      });
    }
    for (const link of response.membership_practitioners) {
      await recordServerCreatedRow(db, {
        table: db.membership_practitioners,
        entity: "membership_practitioners",
        entityId: link.id,
        row: link,
        ...write,
      });
    }
  });

  return { ok: true, membershipId: response.membership.id };
}

export interface MembershipPatch {
  role?: Role;
  isActive?: boolean;
  /**
   * The name this organization uses for the member (memberships.display_name),
   * trimmed here; required and at most 120 characters. Renaming never touches
   * users.full_name, which other organizations may share.
   */
  displayName?: string;
  /** When set, re-hashes the PIN. Does NOT touch any active session for the edited membership. */
  newPin?: string;
}

export type UpdateMembershipResult =
  | { ok: true }
  | { ok: false; reason: "membership_not_found" | "last_owner" | "name_required" | "name_too_long" };

/**
 * Edits a membership's role, active flag, name and/or PIN. Owner-only, on
 * the device (the settings panel is the owner's) — the server does not check
 * who edits a membership, the same known gap as every other settings write
 * (api/docs/rls.md). Refuses ("last_owner")
 * any edit that would leave the org with no active owner — you cannot demote or
 * deactivate the last one. A new PIN is only stored (pin_hash + pin_salt); it
 * never unlocks or changes any active session, so the affected person must use
 * the new PIN at the next lock.
 */
export async function updateMembership(
  db: ClintraDatabase,
  membershipId: string,
  patch: MembershipPatch,
): Promise<UpdateMembershipResult> {
  const actor = await resolveActingMembership(db);
  const before = await db.memberships.get(membershipId);
  if (!before) {
    return { ok: false, reason: "membership_not_found" };
  }
  const displayName = patch.displayName !== undefined ? normalizeStaffName(patch.displayName) : null;
  if (displayName !== null && !displayName.ok) {
    return { ok: false, reason: displayName.reason };
  }

  const nextRole = patch.role ?? before.role;
  const nextActive = patch.isActive ?? before.is_active;
  const willBeActiveOwner = nextRole === Role.Owner && nextActive;
  if (!willBeActiveOwner) {
    const otherActiveOwners = (await db.memberships.toArray()).filter(
      (membership) => membership.id !== membershipId && membership.role === Role.Owner && membership.is_active,
    );
    if (otherActiveOwners.length === 0) {
      return { ok: false, reason: "last_owner" };
    }
  }

  const pinFields =
    patch.newPin !== undefined
      ? (() => {
          const pinSalt = generatePinSalt();
          return { pin_salt: pinSalt, pin_hash: hashPin(patch.newPin, pinSalt) };
        })()
      : {};

  const nameFields = displayName?.ok ? { display_name: displayName.value } : {};
  const after: Membership = { ...before, role: nextRole, is_active: nextActive, ...pinFields, ...nameFields };
  await mutate(db, {
    table: db.memberships,
    entity: "memberships",
    entityId: membershipId,
    action: AuditAction.Update,
    before,
    after,
    actorMembershipId: actor.id,
    orgId: before.org_id,
  });

  return { ok: true };
}
