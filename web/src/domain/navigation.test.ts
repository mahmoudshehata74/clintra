import { describe, expect, it } from "vitest";
import { sidebarStrings } from "../components/strings";
import { navItemsFor } from "./navigation";
import { Role } from "./role";

const DAY = { key: "day", label: sidebarStrings.navDay };
const DOCTOR = { key: "doctor", label: sidebarStrings.navDoctor };
const AUDIT = { key: "audit", label: sidebarStrings.navAudit };
const SETTINGS = { key: "settings", label: sidebarStrings.navSettings };

describe("navItemsFor", () => {
  it("shows day then the audit log to an assistant", () => {
    expect(navItemsFor(Role.Assistant, false)).toEqual([DAY, AUDIT]);
  });

  it("shows day then the audit log to a practitioner", () => {
    expect(navItemsFor(Role.Practitioner, false)).toEqual([DAY, AUDIT]);
  });

  it("shows day then the audit log to a manager", () => {
    expect(navItemsFor(Role.Manager, false)).toEqual([DAY, AUDIT]);
  });

  it("shows day, the audit log, then settings to an owner", () => {
    expect(navItemsFor(Role.Owner, false)).toEqual([DAY, AUDIT, SETTINGS]);
  });

  it("adds the doctor's day right after day for any role tied to a practitioner", () => {
    expect(navItemsFor(Role.Assistant, true)).toEqual([DAY, DOCTOR, AUDIT]);
    expect(navItemsFor(Role.Practitioner, true)).toEqual([DAY, DOCTOR, AUDIT]);
    expect(navItemsFor(Role.Manager, true)).toEqual([DAY, DOCTOR, AUDIT]);
    expect(navItemsFor(Role.Owner, true)).toEqual([DAY, DOCTOR, AUDIT, SETTINGS]);
  });
});
