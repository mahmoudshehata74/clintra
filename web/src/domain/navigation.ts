import { sidebarStrings } from "../components/strings";
import { Role } from "./role";

export interface NavItem {
  key: "day" | "patients" | "doctor" | "visit" | "messages" | "audit" | "settings";
  label: string;
}

/**
 * Which items AppShell's rail shows, in order: "day" (every role), then
 * "patients" — patient search and the patient profile (reference screen 18)
 * — for every role, then "doctor" — the doctor's own day (reference screen 9) — and "visit" — that
 * practitioner's visit in the room now (reference screen 10) — for any role
 * whose membership is tied to a practitioner (memberships.practitioner_id;
 * both show that practitioner's own visits, so a membership without one has
 * nothing to show there), then "messages" — the message templates and the
 * recent messages (reference screen 19) — for every role, then "audit" (every role — the audit log was
 * always open to whoever is signed in, from the day card's head before it
 * moved here), then "settings" (owner only — v1's owner==practitioner, see
 * docs/design-audit.md). AppShell.tsx renders whatever this returns, given
 * an icon for each key.
 */
export function navItemsFor(role: Role, hasPractitioner: boolean): NavItem[] {
  const items: NavItem[] = [
    { key: "day", label: sidebarStrings.navDay },
    { key: "patients", label: sidebarStrings.navPatients },
  ];
  if (hasPractitioner) {
    items.push({ key: "doctor", label: sidebarStrings.navDoctor });
    items.push({ key: "visit", label: sidebarStrings.navVisit });
  }
  items.push({ key: "messages", label: sidebarStrings.navMessages });
  items.push({ key: "audit", label: sidebarStrings.navAudit });
  if (role === Role.Owner) {
    items.push({ key: "settings", label: sidebarStrings.navSettings });
  }
  return items;
}
