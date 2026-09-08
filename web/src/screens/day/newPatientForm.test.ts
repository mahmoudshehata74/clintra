import { describe, expect, it } from "vitest";
import {
  seedNewPatientFormFromQuery,
  validateNewPatientForm,
  type NewPatientFormState,
} from "./newPatientForm";

function state(overrides: Partial<NewPatientFormState>): NewPatientFormState {
  return { fullName: "", phone: "", phoneOmitted: false, ...overrides };
}

describe("validateNewPatientForm", () => {
  it("accepts a name with no phone", () => {
    const result = validateNewPatientForm(state({ fullName: "أحمد محمود" }));
    expect(result).toEqual({ ok: true, fullName: "أحمد محمود", phone: null });
  });

  it("accepts a name with a valid phone, normalising it to E.164", () => {
    const result = validateNewPatientForm(state({ fullName: "أحمد محمود", phone: "01001234567" }));
    expect(result).toEqual({ ok: true, fullName: "أحمد محمود", phone: "+201001234567" });
  });

  it("trims the name before validating and storing it", () => {
    const result = validateNewPatientForm(state({ fullName: "  أحمد محمود  " }));
    expect(result).toEqual({ ok: true, fullName: "أحمد محمود", phone: null });
  });

  it("writes a null phone when 'من غير رقم' is active, even if the phone field has text", () => {
    const result = validateNewPatientForm(
      state({ fullName: "أحمد محمود", phone: "01001234567", phoneOmitted: true }),
    );
    expect(result).toEqual({ ok: true, fullName: "أحمد محمود", phone: null });
  });

  it("rejects an empty name", () => {
    const result = validateNewPatientForm(state({ fullName: "   " }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.nameError).toBeTruthy();
    expect(result.phoneError).toBeNull();
  });

  it("rejects a malformed phone and does not report a name error for an otherwise valid name", () => {
    const result = validateNewPatientForm(state({ fullName: "أحمد محمود", phone: "123" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.nameError).toBeNull();
    expect(result.phoneError).toBeTruthy();
  });

  it("does not validate the phone at all when 'من غير رقم' is active", () => {
    const result = validateNewPatientForm(state({ fullName: "أحمد محمود", phone: "not a phone", phoneOmitted: true }));
    expect(result).toEqual({ ok: true, fullName: "أحمد محمود", phone: null });
  });
});

describe("seedNewPatientFormFromQuery", () => {
  it("seeds the name field when the query looks like a name", () => {
    expect(seedNewPatientFormFromQuery("أحمد محمود")).toEqual({ fullName: "أحمد محمود", phone: "" });
  });

  it("seeds the phone field when the query looks like a phone number", () => {
    expect(seedNewPatientFormFromQuery("01001234567")).toEqual({ fullName: "", phone: "01001234567" });
  });

  it("seeds the name field when the query looks like neither", () => {
    expect(seedNewPatientFormFromQuery("123")).toEqual({ fullName: "123", phone: "" });
  });

  it("seeds nothing for an empty query", () => {
    expect(seedNewPatientFormFromQuery("   ")).toEqual({ fullName: "", phone: "" });
  });
});
