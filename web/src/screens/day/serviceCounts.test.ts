import { describe, expect, it } from "vitest";
import { countServicesByState } from "./serviceCounts";

describe("countServicesByState", () => {
  it("counts active and stopped services", () => {
    expect(countServicesByState([{ is_active: true }, { is_active: false }, { is_active: true }])).toEqual({
      active: 2,
      inactive: 1,
    });
  });

  it("is zero and zero for no services", () => {
    expect(countServicesByState([])).toEqual({ active: 0, inactive: 0 });
  });
});
