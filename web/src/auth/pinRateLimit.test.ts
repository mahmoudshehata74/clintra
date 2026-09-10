import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAttempts,
  DELAY_MS,
  getFailedCount,
  getLockRemainingMs,
  MAX_ATTEMPTS_BEFORE_DELAY,
  registerFailedAttempt,
} from "./pinRateLimit";

const ID = "membership-rate-test";

beforeEach(() => clearAttempts(ID));

describe("pinRateLimit", () => {
  it("does not lock before the attempt limit", () => {
    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_DELAY - 1; i++) {
      registerFailedAttempt(ID, 1000);
    }
    expect(getFailedCount(ID)).toBe(MAX_ATTEMPTS_BEFORE_DELAY - 1);
    expect(getLockRemainingMs(ID, 1000)).toBe(0);
  });

  it("locks for the delay once the limit is reached, and frees after it passes", () => {
    const start = 1000;
    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_DELAY; i++) {
      registerFailedAttempt(ID, start);
    }
    expect(getLockRemainingMs(ID, start)).toBe(DELAY_MS);
    expect(getLockRemainingMs(ID, start + DELAY_MS - 1)).toBe(1);
    expect(getLockRemainingMs(ID, start + DELAY_MS)).toBe(0);
  });

  it("clears attempt state on a correct PIN", () => {
    registerFailedAttempt(ID, 1000);
    clearAttempts(ID);
    expect(getFailedCount(ID)).toBe(0);
    expect(getLockRemainingMs(ID, 1000)).toBe(0);
  });
});
