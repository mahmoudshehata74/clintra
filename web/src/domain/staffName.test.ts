import { describe, expect, it } from "vitest";
import { normalizeStaffName, staffName } from "./staffName";

describe("staffName", () => {
  const user = { full_name: "سارة حسن" };

  it("uses the membership's display_name when it has one", () => {
    expect(staffName({ display_name: "أ. سارة" }, user)).toBe("أ. سارة");
  });

  it("falls back to the user's full_name when display_name is null, absent or blank", () => {
    expect(staffName({ display_name: null }, user)).toBe("سارة حسن");
    expect(staffName({}, user)).toBe("سارة حسن");
    expect(staffName({ display_name: "  " }, user)).toBe("سارة حسن");
  });

  it("needs no users row when the membership carries its name", () => {
    expect(staffName({ display_name: "منى" }, undefined)).toBe("منى");
  });

  it("is null when neither is known", () => {
    expect(staffName({ display_name: null }, undefined)).toBeNull();
    expect(staffName(undefined, undefined)).toBeNull();
  });
});

describe("normalizeStaffName", () => {
  it("trims", () => {
    expect(normalizeStaffName("  منى فؤاد ")).toEqual({ ok: true, value: "منى فؤاد" });
  });

  it("refuses an empty name", () => {
    expect(normalizeStaffName("   ")).toEqual({ ok: false, reason: "name_required" });
  });

  it("allows 120 characters and refuses 121", () => {
    expect(normalizeStaffName("م".repeat(120)).ok).toBe(true);
    expect(normalizeStaffName("م".repeat(121))).toEqual({ ok: false, reason: "name_too_long" });
  });
});
