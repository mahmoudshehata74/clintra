import { describe, expect, it } from "vitest";
import { sidebarStrings } from "../components/strings";
import { navItemsFor } from "./navigation";
import { Role } from "./role";

const DAY = { key: "day", label: sidebarStrings.navDay };
const PATIENTS = { key: "patients", label: sidebarStrings.navPatients };
const DOCTOR = { key: "doctor", label: sidebarStrings.navDoctor };
const VISIT = { key: "visit", label: sidebarStrings.navVisit };
const MESSAGES = { key: "messages", label: sidebarStrings.navMessages };
const AUDIT = { key: "audit", label: sidebarStrings.navAudit };
const SETTINGS = { key: "settings", label: sidebarStrings.navSettings };

describe("navItemsFor", () => {
  it("shows day, patients, messages, then the audit log to an assistant", () => {
    expect(navItemsFor(Role.Assistant, false)).toEqual([DAY, PATIENTS, MESSAGES, AUDIT]);
  });

  it("shows day, patients, messages, then the audit log to a practitioner", () => {
    expect(navItemsFor(Role.Practitioner, false)).toEqual([DAY, PATIENTS, MESSAGES, AUDIT]);
  });

  it("shows day, patients, messages, then the audit log to a manager", () => {
    expect(navItemsFor(Role.Manager, false)).toEqual([DAY, PATIENTS, MESSAGES, AUDIT]);
  });

  it("shows day, patients, messages, the audit log, then settings to an owner", () => {
    expect(navItemsFor(Role.Owner, false)).toEqual([DAY, PATIENTS, MESSAGES, AUDIT, SETTINGS]);
  });

  it("adds the doctor's day, then the current visit, right after patients for any role tied to a practitioner, with messages after them", () => {
    expect(navItemsFor(Role.Assistant, true)).toEqual([DAY, PATIENTS, DOCTOR, VISIT, MESSAGES, AUDIT]);
    expect(navItemsFor(Role.Practitioner, true)).toEqual([DAY, PATIENTS, DOCTOR, VISIT, MESSAGES, AUDIT]);
    expect(navItemsFor(Role.Manager, true)).toEqual([DAY, PATIENTS, DOCTOR, VISIT, MESSAGES, AUDIT]);
    expect(navItemsFor(Role.Owner, true)).toEqual([DAY, PATIENTS, DOCTOR, VISIT, MESSAGES, AUDIT, SETTINGS]);
  });
});
