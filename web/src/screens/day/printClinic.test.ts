import { describe, expect, it } from "vitest";
import { printClinicLines } from "./printClinic";

const LOCATION = { name: "فرع المعادي", address: "شارع 9، المعادي", phone: "+20221234567" };

describe("printClinicLines", () => {
  it("titles the block with the organization and lists location, address and the local-format phone", () => {
    expect(printClinicLines({ name: "عيادة النور" }, LOCATION)).toEqual({
      title: "عيادة النور",
      details: ["فرع المعادي", "شارع 9، المعادي", "02 2123 4567"],
      phone: "02 2123 4567",
    });
  });

  it("omits each empty part of the detail line", () => {
    expect(printClinicLines({ name: "عيادة النور" }, { name: "فرع المعادي", address: " ", phone: "" })).toEqual({
      title: "عيادة النور",
      details: ["فرع المعادي"],
      phone: null,
    });
    expect(printClinicLines({ name: "عيادة النور" }, { name: "", address: "", phone: "+201001234567" }).details).toEqual([
      "010 0123 4567",
    ]);
  });

  it("returns an empty block when nothing is known yet", () => {
    expect(printClinicLines(undefined, undefined)).toEqual({ title: null, details: [], phone: null });
    expect(printClinicLines({ name: "" }, { name: "", address: "", phone: "" })).toEqual({ title: null, details: [], phone: null });
  });
});
