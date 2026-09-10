import type { Membership, User } from "../../db/types";
import { Role } from "../../domain/role";
import { dayScreenStrings } from "./strings";

export const ROLE_LABELS: Record<string, string> = {
  [Role.Owner]: dayScreenStrings.roleOwner,
  [Role.Practitioner]: dayScreenStrings.rolePractitioner,
  [Role.Assistant]: dayScreenStrings.roleAssistant,
  [Role.Manager]: dayScreenStrings.roleManager,
};

/**
 * The "{full_name} ({role_label})" actor label shown next to any recorded
 * action. Shared by the audit sheet (keyed on an audit_log row's
 * actor_membership_id) and the day screen's "recorded by" byline (keyed on
 * a visit's created_by), so the same underlying membership always reads the
 * same name regardless of which surface shows it.
 */
export function formatActorLabel(membership: Membership | undefined, user: User | undefined): string {
  if (!membership || !user) {
    return dayScreenStrings.auditUnknownActor;
  }
  return `${user.full_name} (${ROLE_LABELS[membership.role] ?? membership.role})`;
}
