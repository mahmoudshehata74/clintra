import { describe, expect, it } from "vitest";
import { sidebarStrings } from "../components/strings";
import { navItemsFor } from "./navigation";
import { Role } from "./role";

const DAY = { key: "day", label: sidebarStrings.navDay };
const AUDIT = { key: "audit", label: sidebarStrings.navAudit };
const SETTINGS = { key: "settings", label: sidebarStrings.navSettings };

describe("navItemsFor", () => {
  it("shows day then the audit log to an assistant", () => {
    expect(navItemsFor(Role.Assistant)).toEqual([DAY, AUDIT]);
  });

  it("shows day then the audit log to a practitioner", () => {
    expect(navItemsFor(Role.Practitioner)).toEqual([DAY, AUDIT]);
  });

  it("shows day then the audit log to a manager", () => {
    expect(navItemsFor(Role.Manager)).toEqual([DAY, AUDIT]);
  });

  it("shows day, the audit log, then settings to an owner", () => {
    expect(navItemsFor(Role.Owner)).toEqual([DAY, AUDIT, SETTINGS]);
  });
});
