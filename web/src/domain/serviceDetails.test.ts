import { describe, expect, it } from "vitest";
import type { Piastres } from "./money";
import { checkServiceDetails, formatPriceForInput, isValidServiceDuration, parseServiceForm, serviceNameKey } from "./serviceDetails";

const OTHERS = [{ name: "كشف عام" }, { name: "Physio Session" }];

describe("serviceNameKey", () => {
  it.each([
    ["  كشف   عام ", "كشف عام"],
    ["Physio  SESSION", "physio session"],
    ["أشعة", "أشعة"],
  ])("%j compares as %j", (name, key) => {
    expect(serviceNameKey(name)).toBe(key);
  });
});

describe("isValidServiceDuration", () => {
  it.each([
    [5, true],
    [30, true],
    [480, true],
    [0, false],
    [4, false],
    [12, false],
    [485, false],
    [7.5, false],
    [Number.NaN, false],
  ])("%d minutes → %s", (minutes, valid) => {
    expect(isValidServiceDuration(minutes)).toBe(valid);
  });
});

describe("checkServiceDetails", () => {
  const details = (name: string, durationMinutes = 30, defaultPrice = 150_00) => ({
    name,
    durationMinutes,
    defaultPrice: defaultPrice as Piastres,
  });

  it.each([
    ["a new name", details("أشعة"), null],
    ["an empty name", details("   "), "name_required"],
    ["another service's name, spaced differently", details(" كشف  عام "), "name_taken"],
    ["another service's name, in another case", details("physio session"), "name_taken"],
    ["a duration off the 5-minute step", details("أشعة", 22), "duration_invalid"],
    ["a duration over eight hours", details("أشعة", 485), "duration_invalid"],
    ["a free service", details("أشعة", 30, 0), null],
    ["a negative price", details("أشعة", 30, -100), "price_invalid"],
  ])("%s → %s", (_label, input, expected) => {
    expect(checkServiceDetails(input, OTHERS)).toBe(expected);
  });
});

describe("parseServiceForm", () => {
  it.each([
    [{ name: " أشعة ", duration: "20", price: "250" }, { ok: true, details: { name: "أشعة", durationMinutes: 20, defaultPrice: 25000 } }],
    [{ name: "أشعة", duration: "45", price: "99.50" }, { ok: true, details: { name: "أشعة", durationMinutes: 45, defaultPrice: 9950 } }],
    [{ name: "", duration: "", price: "" }, { ok: false, error: "name_required" }],
    [{ name: "كشف عام", duration: "20", price: "100" }, { ok: false, error: "name_taken" }],
    [{ name: "أشعة", duration: "", price: "100" }, { ok: false, error: "duration_invalid" }],
    [{ name: "أشعة", duration: "2.5", price: "100" }, { ok: false, error: "duration_invalid" }],
    [{ name: "أشعة", duration: "20", price: "" }, { ok: false, error: "price_invalid" }],
    [{ name: "أشعة", duration: "20", price: "-5" }, { ok: false, error: "price_invalid" }],
  ])("%j → %j", (input, expected) => {
    expect(parseServiceForm(input, OTHERS)).toEqual(expected);
  });
});

describe("formatPriceForInput", () => {
  it.each([
    [0, "0"],
    [150_00, "150"],
    [99_50, "99.50"],
    [12_05, "12.05"],
  ])("%d piastres → %s", (price, text) => {
    expect(formatPriceForInput(price as Piastres)).toBe(text);
    expect(parseServiceForm({ name: "أشعة", duration: "20", price: text }, [])).toMatchObject({ details: { defaultPrice: price } });
  });
});
