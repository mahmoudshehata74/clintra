import { afterEach, expect, it, vi } from "vitest";
import { watchSupportExpiry } from "./supportExpiry";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("expires by timer and once only, even when focus arrives at the same instant", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  const ended = vi.fn();
  const stop = watchSupportExpiry(async () => "2026-11-24T10:00:10Z", ended);
  await vi.advanceTimersByTimeAsync(10_000);
  events.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(ended).toHaveBeenCalledTimes(1);
  stop();
});

it("rechecks on focus and stops cleanly before expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  let expiry = "2026-11-24T10:01:00Z";
  const ended = vi.fn();
  const stop = watchSupportExpiry(async () => expiry, ended);
  await vi.advanceTimersByTimeAsync(0);
  expiry = "2026-11-24T09:59:00Z";
  events.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(ended).toHaveBeenCalledTimes(1);
  stop();
});
