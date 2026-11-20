import { describe, expect, it } from "vitest";
import { memberNextStep, needsAuthorSignIn, showRolloutWarning, type RolloutMember } from "./rollout";

const member: RolloutMember = {
  id: "a", role: "assistant", display_name: "أ", has_username: true, has_password: true, signed_in: true,
};

describe("identity rollout readiness", () => {
  it("tells each member what to do next", () => {
    expect(memberNextStep({ ...member, role: "owner", has_password: false })).toBe("rolloutSetupHint");
    expect(memberNextStep({ ...member, has_username: false })).toBe("rolloutSetUsername");
    expect(memberNextStep({ ...member, has_password: false })).toBe("rolloutSetPassword");
    expect(memberNextStep({ ...member, signed_in: false })).toBe("rolloutMemberSignIn");
    expect(memberNextStep(member)).toBe("rolloutComplete");
  });

  it("shows the server's warning only before enforcement", () => {
    expect(showRolloutWarning(null, "2026-11-26T12:00:00Z")).toBe(true);
    expect(showRolloutWarning(null, null)).toBe(false);
    expect(showRolloutWarning("2026-11-25T12:00:00Z", "2026-11-26T12:00:00Z")).toBe(false);
  });

  it("counts only unsent changes that need their own author's sign-in on this device", () => {
    const queued = { device_id: "1", synced_at: null, actor_membership_id: "a" };
    expect(needsAuthorSignIn(queued, "1", new Set(["b"]))).toBe(true);
    expect(needsAuthorSignIn({ ...queued, actor_membership_id: undefined }, "1", new Set(["b"]))).toBe(true);
    expect(needsAuthorSignIn(queued, "1", new Set(["a"]))).toBe(false);
    expect(needsAuthorSignIn(queued, "2", new Set())).toBe(false);
    expect(needsAuthorSignIn({ ...queued, synced_at: "2026-11-25T12:00:00Z" }, "1", new Set())).toBe(false);
  });
});
