import { expect, it } from "vitest";
import { canEditPermissions, canManageCredential, hasPermission, permissionCatalogue, type Permission } from "./permissions";

const manager = { id: "manager", role: "manager", practitioner_id: null, is_active: true, permissions: ["staff.manage", "reports.view"] } as const;
const member = { ...manager, permissions: [...manager.permissions] };

it.each(Object.keys(permissionCatalogue) as Permission[])("gates %s only when enforced", (permission) => {
  const person = { ...member, permissions: [] as string[] };
  expect(hasPermission({ enforced: false, member: person }, permission, true)).toBe(true);
  expect(hasPermission({ enforced: false, member: person }, permission, false)).toBe(false);
  expect(hasPermission({ enforced: true, member: person }, permission, true)).toBe(false);
  expect(hasPermission({ enforced: true, member: { ...person, permissions: [permission] } }, permission, false)).toBe(true);
  expect(hasPermission({ enforced: true, member: { ...person, role: "owner" } }, permission, false)).toBe(true);
});

it("hides delegated credential actions for protected targets and retains edit limits", () => {
  const target = { ...member, id: "target", role: "assistant" as const, permissions: ["reports.view"] };
  expect(canManageCredential(member, target)).toBe(true);
  expect(canManageCredential(member, { ...target, role: "owner" })).toBe(false);
  expect(canManageCredential(member, { ...target, role: "practitioner" })).toBe(false);
  expect(canManageCredential(member, { ...target, permissions: ["cash.close"] })).toBe(false);
  expect(canManageCredential(member, member)).toBe(false);
  expect(canEditPermissions(member, member)).toBe(false);
  expect(canEditPermissions(member, { ...target, role: "owner" })).toBe(false);
});
