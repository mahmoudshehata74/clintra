import { describe, expect, it } from "vitest";
import vectors from "../../../contract/jcs-cases.json";
import { canonicalizeJcs } from "./jcs";

describe("canonical JSON", () => {
  it.each(vectors.cases)("$name", ({ input, canonical }) => {
    expect(canonicalizeJcs(JSON.parse(input))).toBe(canonical);
  });

  it("refuses non-finite numbers and unpaired surrogates", () => {
    expect(() => canonicalizeJcs(Infinity)).toThrow(TypeError);
    expect(() => canonicalizeJcs("\uD800")).toThrow(TypeError);
  });
});
