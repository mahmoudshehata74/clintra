import { describe, expect, it } from "vitest";
import { statusVisual } from "./statusStyle";
import { VisitStatus } from "../../domain/visitStatus";

describe("statusVisual", () => {
  it.each([VisitStatus.Booked, VisitStatus.Confirmed])(
    "%s: plain unfilled card outline, muted meta, no accent",
    (status) => {
      const visual = statusVisual(status)!;
      expect(visual.containerClassName).toBe("border border-line bg-paper");
      expect(visual.nameClassName).toBe("");
      expect(visual.metaClassName).toBe("text-muted");
    },
  );

  it("arrived: light green fill, bold green name, green-medium meta", () => {
    const visual = statusVisual(VisitStatus.Arrived)!;
    expect(visual.containerClassName).toBe("border border-green/20 bg-green-soft");
    expect(visual.nameClassName).toBe("font-semibold text-green");
    expect(visual.metaClassName).toBe("text-green-medium");
  });

  it("in_room: solid green fill, bold paper-coloured name — the loudest treatment on the screen", () => {
    const visual = statusVisual(VisitStatus.InRoom)!;
    expect(visual.containerClassName).toBe("border border-green bg-green");
    expect(visual.nameClassName).toBe("font-semibold text-paper");
    expect(visual.metaClassName).toBe("text-paper/80");
  });

  it("completed: muted grey fill, all text muted — settles into the past", () => {
    const visual = statusVisual(VisitStatus.Completed)!;
    expect(visual.containerClassName).toBe("border border-line bg-line-soft");
    expect(visual.nameClassName).toBe("text-muted");
    expect(visual.metaClassName).toBe("text-muted");
  });

  it("cancelled: dashed red border (full, not a left-edge stripe), struck-through name, no fill", () => {
    const visual = statusVisual(VisitStatus.Cancelled)!;
    expect(visual.containerClassName).toBe("border border-dashed border-red bg-paper");
    expect(visual.nameClassName).toBe("line-through");
    expect(visual.metaClassName).toBe("text-muted");
  });

  it("no_show: light red fill, red name and meta, no bold — was expected and did not show", () => {
    const visual = statusVisual(VisitStatus.NoShow)!;
    expect(visual.containerClassName).toBe("border border-red/20 bg-red-soft");
    expect(visual.nameClassName).toBe("text-red");
    expect(visual.metaClassName).toBe("text-red");
  });

  it("rescheduled has no treatment — the caller renders that slot as empty instead", () => {
    expect(statusVisual(VisitStatus.Rescheduled)).toBeNull();
  });
});
