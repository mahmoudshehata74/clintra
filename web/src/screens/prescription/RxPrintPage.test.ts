import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { splitLtrRuns } from "../../domain/ltrRuns";
import { cssString, rxContinuationCss } from "./continuationHeader";
import type { RxPrintModel } from "./printModel";
import RxPrintPage from "./RxPrintPage";

const model: RxPrintModel = {
  doctorName: "د. أحمد المصري",
  doctorSpec: { title: "استشاري ENT", syndicateNumber: "12345" },
  clinic: {
    title: "عيادة النور",
    details: ["الفرع الرئيسي", "15 شارع الجمهورية، القاهرة", "02 2123 4567"],
    phone: "02 2123 4567",
  },
  hours: [{ days: "السبت – الجمعة", ranges: ["09:00–14:00", "17:00–21:00"] }],
  number: "RX-2026-0001",
  date: "20 / 11 / 2026",
  patientName: "كريم فتحي",
  age: 34,
  diagnosis: "التهاب في الحلق Strep A",
  drugs: [
    {
      number: 1,
      name: "Augmentin 1g — Tablet",
      dose: { instructions: "قرص 1/2 مرتين يوميًا بعد الأكل 100mg", duration: "7 أيام", dose: "", note: null },
      note: "بعد الأكل بـ 30 دقيقة",
    },
  ],
};

/** The text of every <bdi dir="{dir}"> in the markup (none nests another element). */
function isolatesOf(markup: string, dir: "ltr" | "rtl"): string[] {
  return [...markup.matchAll(new RegExp(`<bdi dir="${dir}"[^>]*>([^<]*)</bdi>`, "g"))].map((match) => match[1]);
}

describe("RxPrintPage bidi", () => {
  const markup = renderToStaticMarkup(createElement(RxPrintPage, { model, preview: false }));
  const isolates = isolatesOf(markup, "ltr");

  it("isolates the header's numbers left to right: the phone, each hours range and the RX number", () => {
    expect(isolates).toContain("02 2123 4567");
    expect(isolates).toContain("09:00–14:00");
    expect(isolates).toContain("17:00–21:00");
    expect(isolates).toContain("RX-2026-0001");
    expect(isolates).toContain("12345");
    expect(isolates).toContain("34");
  });

  it("isolates every Latin or digit run inside free text: title, address, diagnosis, dose, duration, note", () => {
    expect(isolates).toContain("ENT");
    expect(isolates).toContain("15");
    expect(isolates).toContain("Strep A");
    expect(isolates).toContain("1/2");
    expect(isolates).toContain("100mg");
    expect(isolates).toContain("7");
    expect(isolates).toContain("30");
    expect(isolates).toContain("Augmentin 1g — Tablet");
  });

  it("leaves the date in its own right-to-left isolate, day on the right as the prototype prints it", () => {
    expect(isolatesOf(markup, "rtl")).toEqual(["20 / 11 / 2026"]);
  });
});

describe("splitLtrRuns", () => {
  it("cuts Latin and digit runs out of Arabic text, keeping marks inside a measure", () => {
    expect(splitLtrRuns("قرص 500mg كل 8 ساعات")).toEqual([
      { text: "قرص ", ltr: false },
      { text: "500mg", ltr: true },
      { text: " كل ", ltr: false },
      { text: "8", ltr: true },
      { text: " ساعات", ltr: false },
    ]);
    expect(splitLtrRuns("2.5 ml x3")).toEqual([{ text: "2.5 ml x3", ltr: true }]);
    expect(splitLtrRuns("بدون أرقام")).toEqual([{ text: "بدون أرقام", ltr: false }]);
    expect(splitLtrRuns("")).toEqual([]);
  });
});

describe("rxContinuationCss", () => {
  it("adds a top-margin header to every page but the first, numbered by the page counters", () => {
    const css = rxContinuationCss("كريم فتحي", "RX-2026-0001");
    expect(css).toContain("@page prescription {");
    expect(css).toContain("@top-center {");
    expect(css).toContain('"تابع روشتة كريم فتحي · ⁦RX-2026-0001⁩ · صفحة "');
    expect(css).toContain('counter(page) "⁩ من ⁦" counter(pages)');
    expect(css).toMatch(/@page prescription:first \{\s*@top-center \{\s*content: none;/);
  });

  it("escapes a name that could end the CSS string or the style element", () => {
    expect(cssString('a"b\\c</style>\nd')).toBe('"a\\22 b\\5c c\\3c /style>\\a d"');
  });
});
