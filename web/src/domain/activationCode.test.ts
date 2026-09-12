import { describe, expect, it } from "vitest";
import { formatActivationCodeInput } from "./activationCode";

describe("formatActivationCodeInput", () => {
  it("groups raw characters into CLT-XXXX-XXXX-XXXX-XXXX as the user types, one group at a time", () => {
    expect(formatActivationCodeInput("7")).toBe("CLT-7");
    expect(formatActivationCodeInput("7F3K")).toBe("CLT-7F3K");
    expect(formatActivationCodeInput("7F3K9")).toBe("CLT-7F3K-9");
    expect(formatActivationCodeInput("7F3K9QRT4XWM2BCD")).toBe("CLT-7F3K-9QRT-4XWM-2BCD");
  });

  it("accepts a pasted code that already has dashes and the CLT- prefix, without doubling it", () => {
    expect(formatActivationCodeInput("CLT-7F3K-9QRT-4XWM-2BCD")).toBe("CLT-7F3K-9QRT-4XWM-2BCD");
  });

  it("accepts a pasted code with no dashes and no prefix", () => {
    expect(formatActivationCodeInput("7F3K9QRT4XWM2BCD")).toBe("CLT-7F3K-9QRT-4XWM-2BCD");
  });

  it("lowercases and stray punctuation are normalised, not rejected", () => {
    expect(formatActivationCodeInput("clt 7f3k-9qrt 4xwm.2bcd")).toBe("CLT-7F3K-9QRT-4XWM-2BCD");
  });

  it("never exceeds the 16 significant characters the real format has", () => {
    expect(formatActivationCodeInput("7F3K9QRT4XWM2BCDEXTRA")).toBe("CLT-7F3K-9QRT-4XWM-2BCD");
  });

  it("returns an empty string for empty input, not a bare 'CLT-'", () => {
    expect(formatActivationCodeInput("")).toBe("");
  });
});
