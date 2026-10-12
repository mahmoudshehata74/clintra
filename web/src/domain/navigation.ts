import { sidebarStrings } from "../components/strings";
import { Role } from "./role";

export interface NavItem {
  key: "day" | "doctor" | "visit" | "audit" | "settings";
  label: string;
}

/**
 * Which items AppShell's rail shows, in order: "day" (every role), then
 * "doctor" — the doctor's own day (reference screen 9) — and "visit" — that
 * practitioner's visit in the room now (reference screen 10) — for any role
 * whose membership is tied to a practitioner (memberships.practitioner_id;
 * both show that practitioner's own visits, so a membership without one has
 * nothing to show there), then "audit" (every role — the audit log was
 * always open to whoever is signed in, from the day card's head before it
 * moved here), then "settings" (owner only — v1's owner==practitioner, see
 * docs/design-audit.md). A later task that adds messages or patient search
 * appends its own entry here; AppShell.tsx renders whatever this returns,
 * given an icon for the new key.
 */
export function navItemsFor(role: Role, hasPractitioner: boolean): NavItem[] {
  const items: NavItem[] = [{ key: "day", label: sidebarStrings.navDay }];
  if (hasPractitioner) {
    items.push({ key: "doctor", label: sidebarStrings.navDoctor });
    items.push({ key: "visit", label: sidebarStrings.navVisit });
  }
  items.push({ key: "audit", label: sidebarStrings.navAudit });
  if (role === Role.Owner) {
    items.push({ key: "settings", label: sidebarStrings.navSettings });
  }
  return items;
}
