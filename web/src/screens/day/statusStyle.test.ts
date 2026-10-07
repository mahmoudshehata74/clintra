import { describe, expect, it } from "vitest";
import { statusVisual } from "./statusStyle";
import { VisitStatus } from "../../domain/visitStatus";

// Rewritten for the prototype's `.slot` row design (a left-edge accent
// stripe + a coloured state pill, not a full-row fill) — see
// docs/design-rule.md's #s2 reference and statusStyle.ts's own doc comment.
describe("statusVisual", () => {
  it.each([VisitStatus.Booked, VisitStatus.Confirmed])(
    "%s: no stripe, muted meta, a neutral soft pill",
    (status) => {
      const visual = statusVisual(status)!;
      expect(visual.stripeClassName).toBe("before:bg-transparent");
      expect(visual.rowBgClassName).toBe("");
      expect(visual.nameClassName).toBe("");
      expect(visual.metaClassName).toBe("text-muted");
      expect(visual.badge).toEqual({ appearance: "soft", tone: "neutral" });
    },
  );

  it("arrived: eligible stripe, no name/time colour change, a solid eligible pill", () => {
    const visual = statusVisual(VisitStatus.Arrived)!;
    expect(visual.stripeClassName).toBe("before:bg-eligible");
    expect(visual.rowBgClassName).toBe("");
    expect(visual.nameClassName).toBe("");
    expect(visual.badge).toEqual({ appearance: "solid", tone: "eligible" });
  });

  it("in_room: copper stripe and wash, copper name, bold copper-2 until, a solid copper pill — the loudest treatment", () => {
    const visual = statusVisual(VisitStatus.InRoom)!;
    expect(visual.stripeClassName).toBe("before:bg-copper");
    expect(visual.rowBgClassName).not.toBe("");
    expect(visual.nameClassName).toBe("text-copper");
    expect(visual.untilClassName).toBe("font-semibold text-copper-2");
    expect(visual.badge).toEqual({ appearance: "solid", tone: "copper" });
  });

  it("completed: rule stripe, muted time/name/meta, a neutral soft pill — settles into the past", () => {
    const visual = statusVisual(VisitStatus.Completed)!;
    expect(visual.stripeClassName).toBe("before:bg-rule");
    expect(visual.nameClassName).toBe("text-muted");
    expect(visual.timeClassName).toBe("text-muted");
    expect(visual.metaClassName).toBe("text-faint");
    expect(visual.badge).toEqual({ appearance: "soft", tone: "neutral" });
  });

  it("cancelled: dashed faint stripe, struck-through muted name, a dashed danger pill — no fill", () => {
    const visual = statusVisual(VisitStatus.Cancelled)!;
    expect(visual.stripeClassName).toBe("before:bg-faint before:opacity-40");
    expect(visual.rowBgClassName).toBe("");
    expect(visual.nameClassName).toBe("text-muted line-through decoration-faint");
    expect(visual.metaClassName).toBe("text-faint");
    expect(visual.badge).toEqual({ appearance: "dashed", tone: "danger" });
  });

  it("no_show: danger stripe and wash, danger name, a solid danger pill — was expected and did not show", () => {
    const visual = statusVisual(VisitStatus.NoShow)!;
    expect(visual.stripeClassName).toBe("before:bg-danger");
    expect(visual.rowBgClassName).not.toBe("");
    expect(visual.nameClassName).toBe("text-danger");
    expect(visual.badge).toEqual({ appearance: "solid", tone: "danger" });
  });

  it("rescheduled has no treatment — the caller renders that slot as empty instead", () => {
    expect(statusVisual(VisitStatus.Rescheduled)).toBeNull();
  });
});
