import { prescriptionPrintStrings as T } from "./strings";

/** U+2066 LEFT-TO-RIGHT ISOLATE and U+2069 POP DIRECTIONAL ISOLATE: generated content cannot hold a <bdi>. */
const LRI = "⁦";
const PDI = "⁩";

/** `value` as a CSS string literal: quotes, backslashes, line breaks and "<" escaped. */
export function cssString(value: string): string {
  const escaped = value.replace(/[\\"<\r\n\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
  return `"${escaped}"`;
}

/**
 * The page-margin header of every printed prescription page after the
 * first, one line: "تابع روشتة {patient} · {RX number} · صفحة {n} من {m}".
 * A `@top-center` margin box of `@page prescription`, so Chromium repeats
 * it on every page and numbers it with the page counters; `:first` turns it
 * off on the first page, which carries the full `.rx-doc` header. The RX
 * number and both counters are left-to-right isolates. Rendered as a <style>
 * inside the print target (PrescriptionPrintSheet), so it exists only while
 * a print is under way.
 */
export function rxContinuationCss(patientName: string, number: string): string {
  const prefix = cssString(`${T.continuationPrefix} ${patientName} · ${LRI}${number}${PDI} · ${T.continuationPage} `);
  return [
    "@page prescription {",
    "  @top-center {",
    `    content: ${prefix} "${LRI}" counter(page) "${PDI} ${T.continuationOf} ${LRI}" counter(pages) "${PDI}";`,
    "    font-family: inherit;",
    "    font-size: 9pt;",
    "    color: rgb(0 0 0 / 0.6);",
    "    vertical-align: bottom;",
    "    padding-bottom: 2mm;",
    "  }",
    "}",
    "@page prescription:first {",
    "  @top-center {",
    "    content: none;",
    "  }",
    "}",
  ].join("\n");
}
