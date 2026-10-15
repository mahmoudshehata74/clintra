import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { APPEARANCE_MIRROR_KEY } from "./domain/appearance";

// index.html's inline pre-paint script (the only <script> without a src).
const bootScript = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

/** Runs the script against a stand-in localStorage and <html>, returning the data-theme it left. */
function runBootScript(stored: string | null | (() => never)): string | null {
  const attributes = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      if (typeof stored === "function") stored();
      return key === APPEARANCE_MIRROR_KEY ? (stored as string | null) : null;
    },
  };
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    },
  };
  new Function("localStorage", "document", bootScript[0])(localStorage, document);
  return attributes.get("data-theme") ?? null;
}

describe("index.html's pre-paint appearance script", () => {
  it("is the page's one inline script", () => {
    expect(bootScript).toHaveLength(1);
  });

  it("sets data-theme from the mirror for an explicit choice", () => {
    expect(runBootScript("light")).toBe("light");
    expect(runBootScript("dark")).toBe("dark");
  });

  it("leaves auto, a missing or an unknown value to the system", () => {
    expect(runBootScript("auto")).toBeNull();
    expect(runBootScript(null)).toBeNull();
    expect(runBootScript("sepia")).toBeNull();
  });

  it("survives blocked storage", () => {
    expect(
      runBootScript(() => {
        throw new Error("SecurityError");
      }),
    ).toBeNull();
  });
});
