import { afterEach, describe, expect, it, vi } from "vitest";
import { clearActiveSession, getActiveMembershipId, setActiveMembershipId, subscribeSession } from "./session";

afterEach(() => clearActiveSession());

describe("session", () => {
  it("starts with no active membership", () => {
    expect(getActiveMembershipId()).toBeNull();
  });

  it("sets and clears the active membership", () => {
    setActiveMembershipId("membership-1");
    expect(getActiveMembershipId()).toBe("membership-1");
    clearActiveSession();
    expect(getActiveMembershipId()).toBeNull();
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);
    setActiveMembershipId("membership-2");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    clearActiveSession();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
