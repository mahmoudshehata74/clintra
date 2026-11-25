import { afterEach, expect, it } from "vitest";
import { clinicSupportText, getSupportSessions, ownerSupportSessionText, removeSupportSession, setSupportSessions, supportDeviceText } from "./supportSessions";

afterEach(() => setSupportSessions([]));

it("parses only well-formed live-session rows and removes an ended device immediately", () => {
  setSupportSessions([
    { device_id: "one", admin_name: "منى", expires_at: "2026-11-24T10:00:00Z" },
    { device_id: "bad", admin_name: "x", expires_at: "never" },
  ]);
  expect(getSupportSessions()).toEqual([{ device_id: "one", admin_name: "منى", expires_at: "2026-11-24T10:00:00Z" }]);
  removeSupportSession("one");
  expect(getSupportSessions()).toEqual([]);
});

it("uses the exact Arabic banner lines and Latin Cairo time", () => {
  expect(clinicSupportText("2026-11-24T10:00:00Z")).toBe("فريق كلينترا عنده وصول للقراءة بس لحد 24 / 11 / 2026 · 12:00");
  expect(supportDeviceText("2026-11-24T10:00:00Z")).toBe("جهاز دعم — قراءة بس — بينتهي 24 / 11 / 2026 · 12:00");
  expect(ownerSupportSessionText("منى", "2026-11-24T10:00:00Z"))
    .toBe("جهاز دعم كلينترا — منى — بينتهي 24 / 11 / 2026 · 12:00");
});
