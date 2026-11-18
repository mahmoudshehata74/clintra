import { describe, expect, it } from "vitest";
import { readsClinicalText } from "./clinicalAccess";
import { Role } from "./role";

describe("readsClinicalText", () => {
  it.each([
    [Role.Owner, null, true],
    [Role.Practitioner, "practitioner-1", true],
    [Role.Practitioner, null, true],
    [Role.Assistant, null, false],
    [Role.Manager, null, false],
    // A membership tied to a practitioner is that doctor's own.
    [Role.Assistant, "practitioner-1", true],
    [Role.Manager, "practitioner-1", true],
  ])("%s with practitioner %s reads clinical text: %s", (role, practitionerId, expected) => {
    expect(readsClinicalText({ role, practitioner_id: practitionerId })).toBe(expected);
  });

  it("reads nothing with nobody signed in", () => {
    expect(readsClinicalText(undefined)).toBe(false);
  });
});
