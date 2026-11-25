import { expect, it } from "vitest";
import { identityChipName } from "./supportIdentity";

it("shows the support administrator instead of the owner or practitioner", () => {
  expect(identityChipName(true, "د. الطبيب", "المالك", "مسؤول الدعم")).toBe("دعم كلينترا — مسؤول الدعم");
  expect(identityChipName(true, "د. الطبيب", "المالك", undefined)).toBeUndefined();
  expect(identityChipName(false, "د. الطبيب", "المالك", "مسؤول الدعم")).toBe("د. الطبيب");
});
