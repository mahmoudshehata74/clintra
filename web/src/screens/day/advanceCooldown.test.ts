import { describe, expect, it } from "vitest";
import { beginCooldown, elapseCooldown, EMPTY_COOLDOWN_STATE, isCoolingDown, settleCooldown } from "./advanceCooldown";

describe("isCoolingDown", () => {
  it("blocks right at the moment of the tap", () => {
    const state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1");
    expect(isCoolingDown(state, "visit-1")).toBe(true);
  });

  it("stays blocked once the window has elapsed if the advance has not settled yet", () => {
    let state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1");
    state = elapseCooldown(state, "visit-1");
    expect(isCoolingDown(state, "visit-1")).toBe(true);
  });

  it("stays blocked once settled if the window has not elapsed yet", () => {
    let state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1");
    state = settleCooldown(state, "visit-1");
    expect(isCoolingDown(state, "visit-1")).toBe(true);
  });

  it("releases once settled then elapsed", () => {
    let state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1");
    state = settleCooldown(state, "visit-1");
    state = elapseCooldown(state, "visit-1");
    expect(isCoolingDown(state, "visit-1")).toBe(false);
  });

  it("releases once elapsed then settled", () => {
    let state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1");
    state = elapseCooldown(state, "visit-1");
    state = settleCooldown(state, "visit-1");
    expect(isCoolingDown(state, "visit-1")).toBe(false);
  });

  it("removes the entry once released", () => {
    let state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1");
    state = settleCooldown(state, "visit-1");
    state = elapseCooldown(state, "visit-1");
    expect(Object.keys(state)).toHaveLength(0);
  });

  it("is independent per visit id", () => {
    const state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1");
    expect(isCoolingDown(state, "visit-2")).toBe(false);
  });

  it("never blocks a visit with no cooldown entry", () => {
    expect(isCoolingDown(EMPTY_COOLDOWN_STATE, "visit-1")).toBe(false);
  });
});

describe("beginCooldown", () => {
  it("resets both flags if a visit is re-begun while already resolved on one flag", () => {
    let state = beginCooldown(EMPTY_COOLDOWN_STATE, "visit-1");
    state = settleCooldown(state, "visit-1");
    state = beginCooldown(state, "visit-1");
    expect(isCoolingDown(state, "visit-1")).toBe(true);
    // Settling again alone must not release it — windowElapsed was reset too.
    state = settleCooldown(state, "visit-1");
    expect(isCoolingDown(state, "visit-1")).toBe(true);
  });
});

describe("settleCooldown and elapseCooldown", () => {
  it("do nothing for a visit with no cooldown entry", () => {
    expect(settleCooldown(EMPTY_COOLDOWN_STATE, "visit-1")).toBe(EMPTY_COOLDOWN_STATE);
    expect(elapseCooldown(EMPTY_COOLDOWN_STATE, "visit-1")).toBe(EMPTY_COOLDOWN_STATE);
  });
});
