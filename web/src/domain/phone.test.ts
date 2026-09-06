import { describe, expect, it } from "vitest";
import { formatEgyptianPhoneForDisplay, normalizeEgyptianPhone } from "./phone";

describe("normalizeEgyptianPhone", () => {
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
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeEgyptianPhone(input)).toEqual({ ok: true, value: expected });
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
  it("formats an E.164 number into locally grouped digits", () => {
    expect(formatEgyptianPhoneForDisplay("+201001234567")).toBe("010 0123 4567");
  });

  it("returns the input unchanged when it is not a valid Egyptian E.164 number", () => {
    expect(formatEgyptianPhoneForDisplay("+1 555 0100")).toBe("+1 555 0100");
  });
});
