import { describe, expect, it } from "vitest";
import {
  practitionerTitleOf,
  storedPractitionerTitle,
  storedSyndicateNumber,
  syndicateNumberOf,
  SYNDICATE_NUMBER_MAX_LENGTH,
} from "./practitionerProfile";

describe("practitionerTitleOf", () => {
  it("is the trimmed title", () => {
    expect(practitionerTitleOf("  استشاري العلاج الطبيعي ")).toBe("استشاري العلاج الطبيعي");
  });

  it("is null for the stored \"no title\", a blank one, or none at all", () => {
    expect(practitionerTitleOf("")).toBeNull();
    expect(practitionerTitleOf(" \t\n")).toBeNull();
    expect(practitionerTitleOf(null)).toBeNull();
    expect(practitionerTitleOf(undefined)).toBeNull();
  });
});

describe("syndicateNumberOf", () => {
  it("is the trimmed number, or null when none is on record", () => {
    expect(syndicateNumberOf(" 12345 ")).toBe("12345");
    expect(syndicateNumberOf(null)).toBeNull();
    expect(syndicateNumberOf("  ")).toBeNull();
  });
});

describe("stored values", () => {
  it("a title is stored trimmed, \"\" for none — the column is NOT NULL", () => {
    expect(storedPractitionerTitle(" طبيب عام ")).toBe("طبيب عام");
    expect(storedPractitionerTitle("   ")).toBe("");
  });

  it("a syndicate number is stored trimmed, null for none", () => {
    expect(storedSyndicateNumber(" 12345 ")).toBe("12345");
    expect(storedSyndicateNumber("   ")).toBeNull();
  });

  it("practitioners.syndicate_number holds 50 characters", () => {
    expect(SYNDICATE_NUMBER_MAX_LENGTH).toBe(50);
  });
});
