import { describe, expect, it } from "vitest";
import type { Membership } from "../../db/types";
import { Role } from "../../domain/role";
import { hasPinSet, isLastActiveOwner } from "./staffRows";

function membership(overrides: Partial<Membership>): Membership {
  return {
    id: "m-1",
    org_id: "org-1",
    role: Role.Owner,
    is_active: true,
    pin_hash: "hash",
    pin_salt: "salt",
    ...overrides,
  } as Membership;
}

describe("isLastActiveOwner", () => {
  it("is true for the only active owner", () => {
    const owner = membership({ id: "owner" });
    const assistant = membership({ id: "assistant", role: Role.Assistant });
    expect(isLastActiveOwner(owner, [owner, assistant])).toBe(true);
  });

  it("is false once another active owner exists, or for an inactive owner", () => {
    const first = membership({ id: "first" });
    const second = membership({ id: "second" });
    expect(isLastActiveOwner(first, [first, second])).toBe(false);
    const inactiveOwner = membership({ id: "inactive", is_active: false });
    expect(isLastActiveOwner(inactiveOwner, [first, inactiveOwner])).toBe(false);
  });

  it("is false for a non-owner", () => {
    const assistant = membership({ id: "assistant", role: Role.Assistant });
    expect(isLastActiveOwner(assistant, [assistant])).toBe(false);
  });

  it("only counts owners of the same organization", () => {
    const owner = membership({ id: "owner" });
    const otherOrgOwner = membership({ id: "other", org_id: "org-2" });
    expect(isLastActiveOwner(owner, [owner, otherOrgOwner])).toBe(true);
  });
});

describe("hasPinSet", () => {
  it("reads a stored hash as set and an empty one as unset", () => {
    expect(hasPinSet({ pin_hash: "abc" })).toBe(true);
    expect(hasPinSet({ pin_hash: "" })).toBe(false);
  });
});
