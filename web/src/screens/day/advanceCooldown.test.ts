import { describe, expect, it } from "vitest";
import { ADVANCE_COOLDOWN_MS, beginCooldown, EMPTY_COOLDOWN_STATE, isCoolingDown, settleCooldown } from "./advanceCooldown";

describe("isCoolingDown", () => {
  it("blocks right at the moment of the tap", () => {
    const state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1", 1_000);
    expect(isCoolingDown(state, "visit-1", 1_000)).toBe(true);
  });

  it("stays blocked once the window has passed if the advance has not settled yet", () => {
    const state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1", 1_000);
    expect(isCoolingDown(state, "visit-1", 1_000 + ADVANCE_COOLDOWN_MS + 1_000)).toBe(true);
  });

  it("stays blocked once settled if the window has not passed yet", () => {
    let state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1", 1_000);
    state = settleCooldown(state, "visit-1");
    expect(isCoolingDown(state, "visit-1", 1_000 + ADVANCE_COOLDOWN_MS - 1)).toBe(true);
  });

  it("releases once both the window has passed and the advance has settled", () => {
    let state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1", 1_000);
    state = settleCooldown(state, "visit-1");
    expect(isCoolingDown(state, "visit-1", 1_000 + ADVANCE_COOLDOWN_MS)).toBe(false);
  });

  it("is independent per visit id", () => {
    const state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1", 1_000);
    expect(isCoolingDown(state, "visit-2", 1_000)).toBe(false);
  });

  it("never blocks a visit with no cooldown entry", () => {
    expect(isCoolingDown(EMPTY_COOLDOWN_STATE, "visit-1", 1_000)).toBe(false);
  });
});

describe("settleCooldown", () => {
  it("does nothing for a visit with no cooldown entry", () => {
    expect(settleCooldown(EMPTY_COOLDOWN_STATE, "visit-1")).toBe(EMPTY_COOLDOWN_STATE);
  });
});
