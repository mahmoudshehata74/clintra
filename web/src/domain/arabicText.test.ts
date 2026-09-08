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
    expect(normalizeArabicText("  كريم  ")).toBe("كريم");
  });

  it("folds ى (alef maksura) and ي (yeh) to the same form", () => {
    expect(normalizeArabicText("هدى")).toBe(normalizeArabicText("هدي"));
  });

  it("folds ة (taa marbouta) to ه (haa)", () => {
    expect(normalizeArabicText("فاطمة")).toBe(normalizeArabicText("فاطمه"));
  });

  it("folds every alef variant (أ إ آ ٱ) to plain ا", () => {
    const plain = normalizeArabicText("احمد");
    expect(normalizeArabicText("أحمد")).toBe(plain);
    expect(normalizeArabicText("إحمد")).toBe(plain);
    expect(normalizeArabicText("آحمد")).toBe(plain);
    expect(normalizeArabicText("ٱحمد")).toBe(plain);
  });

  it("folds ؤ to و and ئ to ي", () => {
    expect(normalizeArabicText("مؤمن")).toBe(normalizeArabicText("مومن"));
    expect(normalizeArabicText("بئر")).toBe(normalizeArabicText("بير"));
  });

  it("does not fold a bare hamza (ء), only the exact letters listed", () => {
    expect(normalizeArabicText("رءوف")).not.toBe(normalizeArabicText("رؤوف"));
  });

  it("folds Arabic-Indic digits to Western digits", () => {
    expect(normalizeArabicText("١٢٣")).toBe("123");
  });

  it("collapses a run of whitespace, including non-breaking space, to a single space", () => {
    expect(normalizeArabicText("محمد   علي")).toBe(normalizeArabicText("محمد علي"));
    expect(normalizeArabicText("محمد  علي")).toBe(normalizeArabicText("محمد علي"));
  });
});
