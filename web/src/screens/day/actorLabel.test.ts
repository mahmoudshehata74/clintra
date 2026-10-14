import { describe, expect, it } from "vitest";
import { formatActorLabel, formatActorName } from "./actorLabel";
import { Role } from "../../domain/role";
import type { Membership, User } from "../../db/types";
import { dayScreenStrings } from "./strings";

function membership(overrides: Partial<Membership>): Membership {
  return {
    id: "membership-1",
    user_id: "user-1",
    org_id: "org-1",
    role: Role.Assistant,
    location_scope: "all",
    practitioner_scope: "all",
    practitioner_id: null,
    pin_hash: "hash",
    pin_salt: "salt",
    is_active: true,
    ...overrides,
  } as Membership;
}

function user(overrides: Partial<User>): User {
  return {
    id: "user-1",
    full_name: "سارة حسن",
    phone: "+201001234567",
    email: null,
    is_active: true,
    ...overrides,
  };
}

describe("formatActorLabel", () => {
  it("formats a resolved membership and user as '{full_name} ({role_label})'", () => {
    expect(formatActorLabel(membership({ role: Role.Assistant }), user({ full_name: "سارة حسن" }))).toBe(
      "سارة حسن (المساعد)",
    );
  });

  it.each([
    [Role.Owner, dayScreenStrings.roleOwner],
    [Role.Practitioner, dayScreenStrings.rolePractitioner],
    [Role.Assistant, dayScreenStrings.roleAssistant],
    [Role.Manager, dayScreenStrings.roleManager],
  ])("labels role %s as %s", (role, expectedRoleLabel) => {
    const label = formatActorLabel(membership({ role }), user({ full_name: "X" }));
    expect(label).toBe(`X (${expectedRoleLabel})`);
  });

  it("falls back to the unknown-actor string when the membership is missing", () => {
    expect(formatActorLabel(undefined, user({}))).toBe(dayScreenStrings.auditUnknownActor);
  });

  it("falls back to the unknown-actor string when the user is missing", () => {
    expect(formatActorLabel(membership({}), undefined)).toBe(dayScreenStrings.auditUnknownActor);
  });
});

describe("formatActorName", () => {
  it("reads the bare name, as the day rows and the audit log show it", () => {
    expect(formatActorName(membership({}), user({}))).toBe("سارة حسن");
    expect(formatActorName(membership({ role: Role.Owner }), user({ full_name: "أحمد المصري" }))).toBe("أحمد المصري");
  });

  it("reads an unknown actor when the membership or user is missing", () => {
    expect(formatActorName(undefined, user({}))).toBe(dayScreenStrings.auditUnknownActor);
    expect(formatActorName(membership({}), undefined)).toBe(dayScreenStrings.auditUnknownActor);
  });
});
