import { afterEach, expect, it, vi } from "vitest";
import { codeNoticeText, getCodeNotices, setCodeNoticeDevice, setCodeNotices } from "./codeNotices";

afterEach(() => {
  setCodeNotices([]);
  setCodeNoticeDevice(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retains notices across a reload scope and never shows another device's notices", () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  });
  const notice = { id: "one", purpose: "device" as const, issued_at: new Date().toISOString() };
  setCodeNoticeDevice("device-a");
  setCodeNotices([notice], "device-a");
  setCodeNoticeDevice("device-b");
  expect(getCodeNotices()).toEqual([]);
  setCodeNoticeDevice("device-a");
  expect(getCodeNotices()).toEqual([notice]);
});

it("renders both Arabic notice purposes with Latin Cairo time and expires at seven days", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
  setCodeNotices([
    { id: "device", purpose: "device", issued_at: "2026-11-23T10:00:00Z" },
    { id: "owner", purpose: "owner_recovery", issued_at: "2026-11-23T10:00:00Z" },
  ]);
  expect(getCodeNotices()).toHaveLength(2);
  expect(codeNoticeText(getCodeNotices()[0])).toBe("فريق كلينترا أصدر كود تفعيل جهاز جديد للعيادة في 23/11/2026, 12:00");
  expect(codeNoticeText(getCodeNotices()[1])).toBe("فريق كلينترا أصدر كود استرجاع لحساب المالك في 23/11/2026, 12:00");
  await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000);
  expect(getCodeNotices()).toEqual([]);
});

it("ignores malformed and future notice times", () => {
  setCodeNotices([
    { id: "bad", purpose: "device", issued_at: "bad" },
    { id: "future", purpose: "device", issued_at: "2999-01-01T00:00:00Z" },
  ]);
  expect(getCodeNotices()).toEqual([]);
});
