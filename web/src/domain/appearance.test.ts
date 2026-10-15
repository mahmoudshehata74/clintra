import { describe, expect, it } from "vitest";
import {
  APPEARANCE_CYCLE,
  appearanceAccessibleName,
  nextAppearance,
  parseAppearance,
  themeAttribute,
  type Appearance,
} from "./appearance";

describe("nextAppearance", () => {
  it("cycles تلقائي → فاتح → غامق and back to تلقائي", () => {
    expect(nextAppearance("auto")).toBe("light");
    expect(nextAppearance("light")).toBe("dark");
    expect(nextAppearance("dark")).toBe("auto");
  });

  it("visits every appearance once in three taps", () => {
    const seen: Appearance[] = [];
    let current: Appearance = "auto";
    for (let tap = 0; tap < APPEARANCE_CYCLE.length; tap += 1) {
      seen.push(current);
      current = nextAppearance(current);
    }
    expect(seen).toEqual(["auto", "light", "dark"]);
    expect(current).toBe("auto");
  });
});

describe("parseAppearance", () => {
  it("keeps a known explicit choice and auto", () => {
    expect(parseAppearance("light")).toBe("light");
    expect(parseAppearance("dark")).toBe("dark");
    expect(parseAppearance("auto")).toBe("auto");
  });

  it("reads anything else as auto", () => {
    for (const value of [null, undefined, "", "Dark", "sepia", 1, {}]) {
      expect(parseAppearance(value)).toBe("auto");
    }
  });
});

describe("themeAttribute", () => {
  it("sets data-theme only for an explicit choice", () => {
    expect(themeAttribute("auto")).toBeNull();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("appearanceAccessibleName", () => {
  it("names the toggle by its current appearance", () => {
    expect(appearanceAccessibleName("auto")).toBe("المظهر: تلقائي");
    expect(appearanceAccessibleName("light")).toBe("المظهر: فاتح");
    expect(appearanceAccessibleName("dark")).toBe("المظهر: غامق");
  });
});
