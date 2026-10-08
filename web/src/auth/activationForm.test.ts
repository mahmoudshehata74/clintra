import { describe, expect, it } from "vitest";
import { placeActivationError } from "./activationForm";

const MESSAGES = { incompleteCode: "incomplete", invalidPhone: "رقم الموبايل غير صالح" };

describe("placeActivationError", () => {
  it("shows nothing without an error", () => {
    expect(placeActivationError(null, MESSAGES)).toEqual({ code: undefined, phone: undefined, form: undefined });
  });

  it("puts an incomplete code under the code field", () => {
    expect(placeActivationError({ kind: "incomplete_code" }, MESSAGES)).toEqual({
      code: "incomplete",
      phone: undefined,
      form: undefined,
    });
  });

  it("puts the local phone check under the phone field", () => {
    expect(placeActivationError({ kind: "server", message: "رقم الموبايل غير صالح" }, MESSAGES)).toEqual({
      code: undefined,
      phone: "رقم الموبايل غير صالح",
      form: undefined,
    });
  });

  it("shows any other refusal for the whole form, verbatim", () => {
    expect(placeActivationError({ kind: "server", message: "الكود ده انتهى" }, MESSAGES)).toEqual({
      code: undefined,
      phone: undefined,
      form: "الكود ده انتهى",
    });
  });
});
