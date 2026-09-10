import { generatePinSalt, hashPin } from "../auth/pinHash";
import { id } from "../domain/id";
import { normalizeEgyptianPhone } from "../domain/phone";
import { Role } from "../domain/role";
import { LocationScope, PractitionerScope } from "../domain/scope";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate, runAtomicMutations } from "./mutate";
import {
  AuditAction,
  type Membership,
  type MembershipLocation,
  type MembershipPractitioner,
  type User,
} from "./types";

export interface NewStaffInput {
  orgId: string;
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

export type CreateStaffResult =
  | { ok: true; membershipId: string }
  | { ok: false; reason: "invalid_phone" | "phone_taken" | "practitioner_required" };

/**
 * Creates a staff member: a users row, its membership (with a hashed PIN), and
 * any membership_locations / membership_practitioners link rows — all in one
 * transaction, so a membership never lands without the links its scope implies.
 * Every row is written through the audited pipeline (attributed to the acting
 * owner). Phone is normalised to E.164 and must be unique across users.
 */
export async function createStaffMembership(db: ClintraDatabase, input: NewStaffInput): Promise<CreateStaffResult> {
  const phone = normalizeEgyptianPhone(input.phone);
  if (!phone.ok) {
    return { ok: false, reason: "invalid_phone" };
  }
  if (input.practitionerScope === PractitionerScope.Self && input.listedPractitionerIds.length !== 1) {
    return { ok: false, reason: "practitioner_required" };
  }
  if ((await db.users.where("phone").equals(phone.value).count()) > 0) {
    return { ok: false, reason: "phone_taken" };
  }

  const actor = await resolveActingMembership(db);
  // Hash before opening the transaction so the ~250ms Argon2id work never runs
  // inside it.
  const pinSalt = generatePinSalt();
  const pinHash = hashPin(input.pin, pinSalt);

  const userId = id();
  const membershipId = id();
  const practitionerId =
    input.practitionerScope === PractitionerScope.Self ? input.listedPractitionerIds[0] : null;

  await runAtomicMutations(
    db,
    [db.users, db.memberships, db.membership_locations, db.membership_practitioners],
    async (write) => {
      const user: User = { id: userId, full_name: input.fullName, phone: phone.value, email: null, is_active: true };
      await write({
        table: db.users,
        entity: "users",
        entityId: userId,
        action: AuditAction.Create,
        before: null,
        after: user,
        actorMembershipId: actor.id,
        orgId: input.orgId,
      });

      const membership: Membership = {
        id: membershipId,
        user_id: userId,
        org_id: input.orgId,
        role: input.role,
        location_scope: input.locationScope,
        practitioner_scope: input.practitionerScope,
        practitioner_id: practitionerId,
        pin_salt: pinSalt,
        pin_hash: pinHash,
        is_active: true,
      };
      await write({
        table: db.memberships,
        entity: "memberships",
        entityId: membershipId,
        action: AuditAction.Create,
        before: null,
        after: membership,
        actorMembershipId: actor.id,
        orgId: input.orgId,
      });

      if (input.locationScope === LocationScope.Listed) {
        for (const locationId of input.listedLocationIds) {
          const link: MembershipLocation = { id: id(), membership_id: membershipId, location_id: locationId };
          await write({
            table: db.membership_locations,
            entity: "membership_locations",
            entityId: link.id,
            action: AuditAction.Create,
            before: null,
            after: link,
            actorMembershipId: actor.id,
            orgId: input.orgId,
          });
        }
      }

      if (input.practitionerScope === PractitionerScope.Listed) {
        for (const linkedPractitionerId of input.listedPractitionerIds) {
          const link: MembershipPractitioner = {
            id: id(),
            membership_id: membershipId,
            practitioner_id: linkedPractitionerId,
          };
          await write({
            table: db.membership_practitioners,
            entity: "membership_practitioners",
            entityId: link.id,
            action: AuditAction.Create,
            before: null,
            after: link,
            actorMembershipId: actor.id,
            orgId: input.orgId,
          });
        }
      }
    },
  );

  return { ok: true, membershipId };
}

export interface MembershipPatch {
  role?: Role;
  isActive?: boolean;
  /** When set, re-hashes the PIN. Does NOT touch any active session for the edited membership. */
  newPin?: string;
}

export type UpdateMembershipResult = { ok: true } | { ok: false; reason: "membership_not_found" | "last_owner" };

/**
 * Edits a membership's role, active flag, and/or PIN. Refuses ("last_owner")
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

  const after: Membership = { ...before, role: nextRole, is_active: nextActive, ...pinFields };
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
