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
  // Mobile numbers read 4-3-4, as the prototype writes them; landlines keep
  // their area code apart from the subscriber number.
  it.each([
    ["+201001234567", "0100 123 4567"],
    ["+201112345678", "0111 234 5678"],
    ["+201223456789", "0122 345 6789"],
    ["+201551234567", "0155 123 4567"],
  ])("formats the mobile %s as %s", (e164, expected) => {
    expect(formatEgyptianPhoneForDisplay(e164)).toBe(expected);
  });

  it.each([
    ["+20225551234", "02 2555 1234"],
    ["+20221234567", "02 2123 4567"],
    ["+2031234567", "03 123 4567"],
    ["+20501234567", "050 123 4567"],
    ["+20882345678", "088 234 5678"],
  ])("formats the landline %s as %s", (e164, expected) => {
    expect(formatEgyptianPhoneForDisplay(e164)).toBe(expected);
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
