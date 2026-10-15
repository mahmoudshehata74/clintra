import type { Membership, User } from "../../db/types";
import { Role } from "../../domain/role";
import { staffName } from "../../domain/staffName";
import { dayScreenStrings } from "./strings";

export const ROLE_LABELS: Record<string, string> = {
  [Role.Owner]: dayScreenStrings.roleOwner,
  [Role.Practitioner]: dayScreenStrings.rolePractitioner,
  [Role.Assistant]: dayScreenStrings.roleAssistant,
  [Role.Manager]: dayScreenStrings.roleManager,
};

/**
 * The actor's bare name (domain/staffName.ts: the membership's display_name,
 * else the user's full_name), as the prototype's `.slot .actor` ("سجّله سارة
 * حسن") and `.aud-txt .who b` ("سارة حسن") show it — the day rows and the
 * audit log. The lock screen's picker keeps formatActorLabel's role.
 */
export function formatActorName(membership: Membership | undefined, user: User | undefined): string {
  const name = membership ? staffName(membership, user) : null;
  return name ?? dayScreenStrings.auditUnknownActor;
}

/**
 * The "{name} ({role_label})" actor label shown next to any recorded
 * action. Shared by the audit sheet (keyed on an audit_log row's
 * actor_membership_id) and the day screen's "recorded by" byline (keyed on
 * a visit's created_by), so the same underlying membership always reads the
 * same name regardless of which surface shows it.
 */
export function formatActorLabel(membership: Membership | undefined, user: User | undefined): string {
  const name = membership ? staffName(membership, user) : null;
  if (!membership || name === null) {
    return dayScreenStrings.auditUnknownActor;
  }
  return `${name} (${ROLE_LABELS[membership.role] ?? membership.role})`;
}
