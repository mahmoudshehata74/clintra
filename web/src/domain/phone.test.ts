import { describe, expect, it } from "vitest";
import phoneCases from "../../../contract/phone-cases.json";
import { formatEgyptianPhoneForDisplay, normalizeEgyptianPhone } from "./phone";

// Shared with the API's App\Support\EgyptianPhone (api/tests/Feature/EgyptianPhoneTest.php) —
// see contract/README.md. Both implementations must accept and reject the exact same inputs.
describe("normalizeEgyptianPhone", () => {
  it.each(phoneCases.valid)("normalises $input to $expected with kind $kind", ({ input, expected, kind }) => {
    expect(normalizeEgyptianPhone(input)).toEqual({ ok: true, value: expected, kind });
  });

  it.each(phoneCases.invalid)("rejects malformed phone input %s", (input) => {
    const result = normalizeEgyptianPhone(input);
    expect(result.ok).toBe(false);
  });
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
