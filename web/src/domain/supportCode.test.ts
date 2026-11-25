import { describe, expect, it } from "vitest";
import { generateSupportCode, hashSupportCode } from "./supportCode";

describe("support codes", () => {
  it("uses the activation alphabet and four groups of four", () => {
    for (let i = 0; i < 20; i++) expect(generateSupportCode()).toMatch(/^CLT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){3}$/);
  });

  it("normalizes before hashing with the same fixed vector as the PHP test", async () => {
    const expected = "c93b3fcfa7ef0927301056a6f3e4d61b783f3324fd8070a69c6b397305b72610";
    expect(await hashSupportCode("CLT-7F3K-9QRT-4XWM-2BCD")).toBe(expected);
    expect(await hashSupportCode("7f3k9qrt4xwm2bcd")).toBe(expected);
  });
});
