/**
 * A Latin or digit run inside free text: a letter or digit, then letters,
 * digits and the marks that stay inside a dose or a measure ("100mg",
 * "1/2", "2.5", "08:00", "5%", "x3"), across single spaces between two such
 * pieces ("Augmentin 1 g").
 */
const LTR_RUN = /[A-Za-z0-9][A-Za-z0-9.,:/%+×\-–]*(?: [A-Za-z0-9][A-Za-z0-9.,:/%+×\-–]*)*/g;

export interface TextPart {
  text: string;
  ltr: boolean;
}

/** `text` cut into its Latin or digit runs (`ltr`) and the text between them, in order. */
export function splitLtrRuns(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LTR_RUN)) {
    const start = match.index;
    if (start > last) {
      parts.push({ text: text.slice(last, start), ltr: false });
    }
    parts.push({ text: match[0], ltr: true });
    last = start + match[0].length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), ltr: false });
  }
  return parts;
}
