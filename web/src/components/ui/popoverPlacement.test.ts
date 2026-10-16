import { describe, expect, it } from "vitest";
import { placePopover } from "./popoverPlacement";

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
const panel = { width: 240, height: 300 };

describe("placePopover", () => {
  it("opens under the anchor, its right edge on the anchor's in a right-to-left page", () => {
    const anchor = { top: 200, bottom: 240, left: 700, right: 900 };
    expect(placePopover(anchor, panel, desktop, "rtl")).toEqual({ top: 244, left: 660, maxHeight: null });
  });

  it("lines up with the anchor's left edge in a left-to-right page", () => {
    const anchor = { top: 200, bottom: 240, left: 700, right: 900 };
    expect(placePopover(anchor, panel, desktop, "ltr").left).toBe(700);
  });

  it("slides back inside the viewport when the anchor sits near the left edge", () => {
    const anchor = { top: 200, bottom: 240, left: 12, right: 150 };
    expect(placePopover(anchor, panel, phone, "rtl").left).toBe(8);
  });

  it("slides back inside the viewport when the anchor sits near the right edge", () => {
    const anchor = { top: 200, bottom: 240, left: 300, right: 380 };
    expect(placePopover(anchor, panel, phone, "ltr").left).toBe(390 - 8 - 240);
  });

  it("flips above the anchor when it fits there and not below", () => {
    const anchor = { top: 700, bottom: 740, left: 700, right: 900 };
    expect(placePopover(anchor, panel, desktop, "rtl").top).toBe(700 - 4 - 300);
  });

  it("stays under the anchor, pushed up to the bottom edge, when it fits on neither side", () => {
    const anchor = { top: 250, bottom: 290, left: 700, right: 900 };
    const tall = { width: 240, height: 600 };
    expect(placePopover(anchor, tall, desktop, "rtl")).toEqual({ top: 800 - 8 - 600, left: 660, maxHeight: null });
  });

  it("caps a panel taller than the viewport, which then scrolls", () => {
    const anchor = { top: 250, bottom: 290, left: 700, right: 900 };
    const huge = { width: 240, height: 1000 };
    expect(placePopover(anchor, huge, desktop, "rtl")).toEqual({ top: 8, left: 660, maxHeight: 784 });
  });

  it("keeps a panel wider than the viewport on its left gap", () => {
    const anchor = { top: 200, bottom: 240, left: 100, right: 200 };
    expect(placePopover(anchor, { width: 500, height: 100 }, phone, "rtl").left).toBe(8);
  });
});
