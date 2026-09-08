import { describe, expect, it } from "vitest";
import { normalizeArabicText } from "./arabicText";

describe("normalizeArabicText", () => {
  it("strips tashkeel so a diacritised word matches its bare form", () => {
    const withTashkeel = "مُحَمَّد";
    const bare = "محمد";
    expect(normalizeArabicText(withTashkeel)).toBe(normalizeArabicText(bare));
    expect(normalizeArabicText(withTashkeel)).toBe(bare);
  });

  it("strips tanween and sukun", () => {
    expect(normalizeArabicText("كِتَابٌ")).toBe("كتاب");
    expect(normalizeArabicText("مَكْتَب")).toBe("مكتب");
  });

  it("leaves plain Arabic text without tashkeel unchanged", () => {
    expect(normalizeArabicText("كريم فتحي")).toBe("كريم فتحي");
  });

  it("lowercases Latin text for case-insensitive comparison", () => {
    expect(normalizeArabicText("Ahmed")).toBe("ahmed");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeArabicText("  منى  ")).toBe("منى");
  });
});
