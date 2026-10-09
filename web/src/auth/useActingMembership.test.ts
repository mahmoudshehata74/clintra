import { describe, expect, it } from "vitest";
import type { Membership, User } from "../db/types";
import { membershipForSession, userForMembership } from "./useActingMembership";

const row = { id: "membership-a", user_id: "user-a", role: "owner", practitioner_id: "practitioner-a" } as Membership;

describe("membershipForSession", () => {
  it("returns the row when it is the current session's membership", () => {
    expect(membershipForSession(row, "membership-a")).toBe(row);
  });

  it("drops a row left over from a different session", () => {
    expect(membershipForSession(row, "membership-b")).toBeUndefined();
  });

  it("drops any row while there is no session (locked)", () => {
    expect(membershipForSession(row, null)).toBeUndefined();
  });

  it("is undefined while the row has not loaded", () => {
    expect(membershipForSession(undefined, "membership-a")).toBeUndefined();
  });
});

describe("userForMembership", () => {
  const user = { id: "user-a", full_name: "أحمد المصري" } as User;

  it("returns the user when it belongs to the membership", () => {
    expect(userForMembership(user, row)).toBe(user);
  });

  it("drops a user left over from another membership", () => {
    expect(userForMembership(user, { ...row, user_id: "user-b" })).toBeUndefined();
  });

  it("is undefined without a membership or before the user loads", () => {
    expect(userForMembership(user, undefined)).toBeUndefined();
    expect(userForMembership(undefined, row)).toBeUndefined();
  });
});
