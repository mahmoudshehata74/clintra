import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TimeField from "./TimeField";
import { HOUR_OPTIONS, joinTimeValue, minuteOptions, splitTimeValue } from "./timeValue";

describe("TimeField options", () => {
  it("offers every hour 00–23 with Latin digits", () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toBe("00");
    expect(HOUR_OPTIONS[13]).toBe("13");
    expect(HOUR_OPTIONS[23]).toBe("23");
  });

  it("offers minutes in 5-minute steps", () => {
    expect(minuteOptions("30")).toEqual(["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  });

  it("keeps a stored minute that is off the 5-minute steps, in order", () => {
    expect(minuteOptions("07")).toEqual(["00", "05", "07", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  });
});

describe("TimeField value", () => {
  it("splits and joins HH:MM", () => {
    expect(splitTimeValue("09:30")).toEqual({ hour: "09", minute: "30" });
    expect(splitTimeValue("23:55")).toEqual({ hour: "23", minute: "55" });
    expect(joinTimeValue({ hour: "14", minute: "05" })).toBe("14:05");
  });

  it("reads anything that is not a 24-hour time as 00:00", () => {
    expect(splitTimeValue("")).toEqual({ hour: "00", minute: "00" });
    expect(splitTimeValue("24:00")).toEqual({ hour: "00", minute: "00" });
    expect(splitTimeValue("9:30 AM")).toEqual({ hour: "00", minute: "00" });
  });
});

describe("TimeField markup", () => {
  const render = (props: Partial<Parameters<typeof TimeField>[0]> = {}) =>
    renderToStaticMarkup(createElement(TimeField, { value: "14:05", onChange: () => {}, label: "من", id: "start", ...props }));

  it("is a labelled group of two named selects, never a native time input", () => {
    const html = render();
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="من"');
    expect(html).toContain('aria-label="الساعة"');
    expect(html).toContain('aria-label="الدقيقة"');
    expect(html).not.toContain('type="time"');
    expect(html.match(/<select/g)).toHaveLength(2);
  });

  it("selects the value's hour and minute", () => {
    const html = render();
    expect(html).toContain('<option value="14" selected="">14</option>');
    expect(html).toContain('<option value="05" selected="">05</option>');
  });

  it("puts the Field's id on the hour select and its error wiring on both", () => {
    const html = render({ "aria-invalid": true, "aria-describedby": "start-error" });
    const [hour, minute] = html.match(/<select[^>]*>/g) ?? [];
    for (const attribute of ['id="start"', 'aria-label="الساعة"', 'aria-invalid="true"', 'aria-describedby="start-error"']) {
      expect(hour).toContain(attribute);
    }
    for (const attribute of ['id="start-minute"', 'aria-label="الدقيقة"', 'aria-invalid="true"', 'aria-describedby="start-error"']) {
      expect(minute).toContain(attribute);
    }
  });
});
