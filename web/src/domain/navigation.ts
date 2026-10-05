import { sidebarStrings } from "../components/strings";
import { Role } from "./role";

export interface NavItem {
  key: "day" | "settings";
  label: string;
}

/**
 * Which items AppShell's rail shows for a role, in order. Today exactly
 * "day" (every role) and "settings" (owner only — v1's owner==practitioner,
 * see docs/design-audit.md). A later task that adds messages, patient
 * search, the audit log, the doctor day view or the current-visit screen
 * appends its own entry here; AppShell.tsx renders whatever this returns
 * without needing a matching change of its own.
 */
export function navItemsFor(role: Role): NavItem[] {
  const items: NavItem[] = [{ key: "day", label: sidebarStrings.navDay }];
  if (role === Role.Owner) {
    items.push({ key: "settings", label: sidebarStrings.navSettings });
  }
  return items;
}
