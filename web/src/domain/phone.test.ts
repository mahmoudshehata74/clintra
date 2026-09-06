import { describe, expect, it } from "vitest";
import { formatEgyptianPhoneForDisplay, normalizeEgyptianPhone } from "./phone";

describe("normalizeEgyptianPhone", () => {
  describe("mobile numbers", () => {
    it.each([
      ["01001234567", "+201001234567"],
      ["+201001234567", "+201001234567"],
      ["00201001234567", "+201001234567"],
      ["201001234567", "+201001234567"],
      ["1001234567", "+201001234567"],
      ["010 0123 4567", "+201001234567"],
      ["+20 100 123 4567", "+201001234567"],
      ["(010) 0123-4567", "+201001234567"],
      ["٠١٠٠١٢٣٤٥٦٧", "+201001234567"],
      ["01512345678", "+201512345678"],
    ])("normalises %s to %s with kind mobile", (input, expected) => {
      expect(normalizeEgyptianPhone(input)).toEqual({ ok: true, value: expected, kind: "mobile" });
    });
  });

  describe("landline numbers", () => {
    it.each([
      // Cairo/Giza/Qalyubia: single-digit area code "2", 8-digit subscriber number.
      ["0225551234", "+20225551234"],
      ["+20225551234", "+20225551234"],
      ["0020225551234", "+20225551234"],
      ["20225551234", "+20225551234"],
      ["225551234", "+20225551234"],
      ["02 2555 1234", "+20225551234"],
      ["٠٢٢٥٥٥١٢٣٤", "+20225551234"],
      // Alexandria: single-digit area code "3", 7-digit subscriber number.
      ["031234567", "+2031234567"],
      ["+2031234567", "+2031234567"],
      // Mansoura: two-digit area code "50", 7-digit subscriber number.
      ["0501234567", "+20501234567"],
      ["+20501234567", "+20501234567"],
    ])("normalises %s to %s with kind landline", (input, expected) => {
      expect(normalizeEgyptianPhone(input)).toEqual({
        ok: true,
        value: expected,
        kind: "landline",
      });
    });
  });

  it.each(["", "notaphone", "123", "01334567890", "010012345", "020012345678"])(
    "rejects malformed phone input %s",
    (input) => {
      const result = normalizeEgyptianPhone(input);
      expect(result.ok).toBe(false);
    },
  );
});

describe("formatEgyptianPhoneForDisplay", () => {
  it("formats a mobile E.164 number into locally grouped digits", () => {
    expect(formatEgyptianPhoneForDisplay("+201001234567")).toBe("010 0123 4567");
  });

  it("formats a Cairo landline E.164 number with its area code separated", () => {
    expect(formatEgyptianPhoneForDisplay("+20225551234")).toBe("02 2555 1234");
  });

  it("formats an Alexandria landline E.164 number with its area code separated", () => {
    expect(formatEgyptianPhoneForDisplay("+2031234567")).toBe("03 123 4567");
  });

  it("formats a Mansoura landline E.164 number with its area code separated", () => {
    expect(formatEgyptianPhoneForDisplay("+20501234567")).toBe("050 123 4567");
  });

  it("returns the input unchanged when it is not a valid Egyptian E.164 number", () => {
    expect(formatEgyptianPhoneForDisplay("+1 555 0100")).toBe("+1 555 0100");
  });
});
