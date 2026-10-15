import { describe, expect, it } from "vitest";
import { queueInRoomMeta } from "./queueInRoomMeta";

describe("queueInRoomMeta", () => {
  const TODAY = "2026-09-07";
  // Noon Cairo on TODAY (UTC+3 in September).
  const NOW = new Date("2026-09-07T09:00:00.000Z");
  const startedBefore = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

  it.each([
    [0, "دخل دلوقتي"],
    [29, "دخل دلوقتي"],
    [59, "دخل دلوقتي"],
    [60, "دخل من 1د"],
    [7 * 60, "دخل من 7د"],
    [75 * 60, "دخل من 1س 15د"],
  ])("started %i seconds ago reads %s", (seconds, expected) => {
    expect(queueInRoomMeta(startedBefore(seconds), TODAY, NOW)).toBe(expected);
  });

  it("reads the plain status word off the live day", () => {
    expect(queueInRoomMeta("2026-08-03T07:00:00.000Z", "2026-08-03", NOW)).toBe("في الكشف");
  });
});
