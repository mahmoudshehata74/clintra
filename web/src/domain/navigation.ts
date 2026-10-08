import { sidebarStrings } from "../components/strings";
import { Role } from "./role";

export interface NavItem {
  key: "day" | "audit" | "settings";
  label: string;
}

/**
 * Which items AppShell's rail shows for a role, in order: "day" and
 * "audit" (every role — the audit log was always open to whoever is signed
 * in, from the day card's head before it moved here), then "settings"
 * (owner only — v1's owner==practitioner, see docs/design-audit.md). A
 * later task that adds messages, patient search, the doctor day view or the
 * current-visit screen appends its own entry here; AppShell.tsx renders
 * whatever this returns, given an icon for the new key.
 */
export function navItemsFor(role: Role): NavItem[] {
  const items: NavItem[] = [
    { key: "day", label: sidebarStrings.navDay },
    { key: "audit", label: sidebarStrings.navAudit },
  ];
  if (role === Role.Owner) {
    items.push({ key: "settings", label: sidebarStrings.navSettings });
  }
  return items;
}
