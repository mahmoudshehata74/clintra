import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import { APP_VERSION, printedBrand } from "./appVersion";

describe("printedBrand", () => {
  it("reads web/package.json's version after the brand", () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(printedBrand()).toBe(`Clintra v${packageJson.version}`);
  });
});
