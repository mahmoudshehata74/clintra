import { describe, expect, it } from "vitest";
import { computeActorRecency } from "./actorRecency";

describe("computeActorRecency", () => {
  it("is null for a visit created today", () => {
    expect(computeActorRecency("2026-09-07T08:00:00.000Z", "2026-09-07")).toBeNull();
  });

  it("is yesterday for a visit created the day before", () => {
    expect(computeActorRecency("2026-09-06T08:00:00.000Z", "2026-09-07")).toEqual({ kind: "yesterday" });
  });

  it("is a day/month pair for anything earlier than yesterday", () => {
    expect(computeActorRecency("2026-09-01T08:00:00.000Z", "2026-09-07")).toEqual({
      kind: "earlier",
      day: 1,
      month: 9,
    });
  });

  it("crosses a month boundary correctly", () => {
    expect(computeActorRecency("2026-08-31T08:00:00.000Z", "2026-09-01")).toEqual({ kind: "yesterday" });
  });
});
