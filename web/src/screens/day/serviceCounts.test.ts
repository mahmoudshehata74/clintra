import { describe, expect, it } from "vitest";
import { countServicesByState, sortServicesByName } from "./serviceCounts";

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

describe("sortServicesByName", () => {
  it("orders services by name under Arabic collation, whatever order they were read in", () => {
    const services = [
      { id: "s3", name: "كشف عام" },
      { id: "s1", name: "استشارة متابعة" },
      { id: "s4", name: "حقنة علاجية" },
      { id: "s2", name: "فحص شامل" },
      { id: "s5", name: "تدليك علاجي" },
    ];
    const expected = ["استشارة متابعة", "تدليك علاجي", "حقنة علاجية", "فحص شامل", "كشف عام"];
    expect(sortServicesByName(services).map((service) => service.name)).toEqual(expected);
    expect(sortServicesByName([...services].reverse()).map((service) => service.name)).toEqual(expected);
  });

  it("breaks a tie between equal names by id, so the order is always the same", () => {
    const services = [
      { id: "b", name: "كشف" },
      { id: "a", name: "كشف" },
    ];
    expect(sortServicesByName(services).map((service) => service.id)).toEqual(["a", "b"]);
    expect(sortServicesByName([...services].reverse()).map((service) => service.id)).toEqual(["a", "b"]);
  });

  it("leaves its input untouched", () => {
    const services = [
      { id: "s2", name: "فحص" },
      { id: "s1", name: "استشارة" },
    ];
    sortServicesByName(services);
    expect(services.map((service) => service.id)).toEqual(["s2", "s1"]);
  });
});
