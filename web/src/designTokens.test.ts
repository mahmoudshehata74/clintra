/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import prototypeHtml from "../../docs/reference/clintra-prototype.html?raw";

// Read from disk: vitest hands a stylesheet's `?raw` import over empty.
const appCss = readFileSync(new URL("./index.css", import.meta.url), "utf8");

type Tokens = Record<string, string>;

/** The body of the first rule whose text starts at `opener`, braces balanced. */
function blockAfter(source: string, opener: string): string {
  const start = source.indexOf(opener);
  expect(start, opener).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start + opener.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  throw new Error(`unclosed block after ${opener}`);
}

/** `--name: value;` and `color-scheme: value;` declarations, values normalised (case, spaces, a decimal's leading and trailing zeros). */
function declarations(body: string): Tokens {
  const tokens: Tokens = {};
  for (const match of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim().toLowerCase().replace(/\s+/g, "").replace(/([(,])0\./g, "$1.").replace(/(\.\d*?)0+(?=[),])/g, "$1");
  }
  return tokens;
}

/** The prototype's `--x` named as the app's `--color-x`; its three shadows as their colours (index.css's `--color-shadow-*`). */
function asAppTokens(prototype: Tokens): Tokens {
  const tokens: Tokens = {};
  for (const [name, value] of Object.entries(prototype)) {
    if (name === "--shadow-s") {
      tokens["--color-shadow-soft"] = value.match(/rgba\([^)]*\)/g)![0];
    } else if (name === "--shadow-m") {
      expect(value.match(/rgba\([^)]*\)/g)![0]).toBe(tokens["--color-shadow-soft"]);
      tokens["--color-shadow-mid"] = value.match(/rgba\([^)]*\)/g)![1];
    } else if (name === "--shadow-l") {
      tokens["--color-shadow-deep"] = value.match(/rgba\([^)]*\)/g)![0];
    } else if (name.startsWith("--")) {
      tokens[`--color-${name.slice(2)}`] = value;
    } else {
      tokens[name] = value;
    }
  }
  return tokens;
}

const theme = declarations(blockAfter(appCss, "@theme {"));
const systemDark = declarations(blockAfter(blockAfter(appCss, "@media (prefers-color-scheme: dark) {"), ':root:not([data-theme="light"]) {'));
const explicitDark = declarations(blockAfter(appCss, ':root[data-theme="dark"] {'));
const print = declarations(blockAfter(appCss, "@media print {\n  :root,"));

const prototypeLight = asAppTokens(declarations(blockAfter(prototypeHtml, ":root{")));
const prototypeDark = asAppTokens(declarations(blockAfter(prototypeHtml, ':root[data-theme="dark"]{')));
const prototypeSystemDark = asAppTokens(declarations(blockAfter(prototypeHtml, ':root:not([data-theme="light"]){')));

/**
 * The text tokens the prototype does not have, derived for contrast
 * (docs/session-handoff.md's "Dark mode", decisions 6 and 9 and the slab's
 * no-show count): the owner's value in each theme. The dark blocks carry
 * them after the prototype's own values, which they never replace.
 */
const DERIVED: Readonly<Record<string, { light: string; dark: string }>> = {
  "--color-on-fill": { light: "#ffffff", dark: "#081311" },
  "--color-on-copper": { light: "#081311", dark: "#081311" },
  "--color-on-ink": { light: "#ffffff", dark: "#ffffff" },
  "--color-copper-ink": { light: "#8e6222", dark: "#c79247" },
  "--color-green-on-ink": { light: "#37b894", dark: "#37b894" },
  "--color-copper-on-ink": { light: "#dba35a", dark: "#dba35a" },
  "--color-danger-on-ink": { light: "#f08c82", dark: "#f08c82" },
};
const derivedDark: Tokens = Object.fromEntries(Object.entries(DERIVED).map(([name, { dark }]) => [name, dark]));

describe("design tokens", () => {
  it("the prototype's two dark blocks agree, so either is its dark theme", () => {
    expect(prototypeSystemDark).toEqual(prototypeDark);
  });

  it("the light tokens are the prototype's :root", () => {
    for (const [name, value] of Object.entries(prototypeLight)) {
      expect(theme[name], name).toBe(value);
    }
  });

  it("both dark blocks are the prototype's dark values verbatim plus the derived text tokens, with color-scheme dark", () => {
    expect(Object.keys(derivedDark).filter((name) => name in prototypeDark || name in prototypeLight)).toEqual([]);
    expect(systemDark).toEqual({ ...prototypeDark, ...derivedDark });
    expect(explicitDark).toEqual({ ...prototypeDark, ...derivedDark });
    expect(systemDark["color-scheme"]).toBe("dark");
  });

  it("the derived text tokens carry the owner's light values", () => {
    for (const [name, { light }] of Object.entries(DERIVED)) {
      expect(theme[name], name).toBe(light);
    }
  });

  it("paper restates every light value the dark blocks change, with color-scheme light", () => {
    expect(print["color-scheme"]).toBe("light");
    expect(Object.keys(print).sort()).toEqual(Object.keys(systemDark).sort());
    for (const [name, value] of Object.entries(print)) {
      if (name !== "color-scheme") {
        expect(theme[name], name).toBe(value);
      }
    }
  });
});

// The two themes as the browser resolves them: the light tokens are
// @theme; dark is @theme with the system-dark block over it (the explicit
// dark block is the same, asserted above).
const THEMES = { light: theme, dark: { ...theme, ...systemDark } } as const;
type ThemeName = keyof typeof THEMES;

type Rgb = readonly [number, number, number];

function hexColour(tokens: Tokens, name: string): Rgb {
  const value = tokens[`--color-${name}`];
  expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as unknown as Rgb;
}

function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  return top.map((channel, i) => channel * alpha + under[i] * (1 - alpha)) as unknown as Rgb;
}

/** "name", or "name N%" laid over `under`, or "name N% over other". */
function colour(tokens: Tokens, expression: string, under?: Rgb): Rgb {
  const match = expression.match(/^([\w-]+)(?: (\d+)%(?: over ([\w-]+))?)?$/);
  expect(match, expression).not.toBeNull();
  const [, name, percent, base] = match!;
  if (percent === undefined) {
    return hexColour(tokens, name);
  }
  const ground = base === undefined ? under : hexColour(tokens, base);
  expect(ground, expression).toBeDefined();
  return over(hexColour(tokens, name), Number(percent) / 100, ground!);
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2's contrast ratio of a text colour on its background. */
function contrast(tokens: Tokens, text: string, background: string): number {
  const ground = colour(tokens, background);
  const [a, b] = [luminance(colour(tokens, text, ground)), luminance(ground)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

interface Pair {
  group: string;
  text: string;
  background: string;
  use: string;
}

/**
 * Every text/background token pair the screens use (docs/design-tokens.md's
 * "Contrast"). A gradient is listed at both ends; a tint or a translucent
 * glass as its composite over the surface beneath ("glass 16% over ink-2");
 * a text with an opacity as its composite over its background.
 */
const PAIRS: readonly Pair[] = [
  ...["paper", "paper-2", "card", "field"].flatMap((background) =>
    ["text", "muted"].map((text) => ({ group: "Text on surfaces", text, background, use: "body, labels, hints, timestamps, empty states" })),
  ),
  { group: "Text on surfaces", text: "text", background: "copper 12% over card", use: "the care-plan entry on the visit sheet" },
  ...["card", "field"].flatMap((background) =>
    ["green", "copper-ink", "danger", "warning", "eligible"].map((text) => ({
      group: "Tone text on surfaces",
      text,
      background,
      use: "links, status words, amounts, the in-room name",
    })),
  ),
  { group: "Tone text on surfaces", text: "copper-ink", background: "copper 12% over card", use: "the care-plan entry's progress" },
  { group: "Tone text on its wash", text: "green", background: "green-wash", use: "soft badges, secondary and outline buttons, pressed chips" },
  { group: "Tone text on its wash", text: "copper-ink", background: "copper-wash", use: "soft badges, pressed tabs, the in-room row, the next session" },
  { group: "Tone text on its wash", text: "danger", background: "danger-wash", use: "soft badges, danger buttons, the no-show row" },
  { group: "Tone text on its wash", text: "warning", background: "warning-wash", use: "soft badges, the late notes" },
  { group: "Tone text on its wash", text: "eligible", background: "eligible 18% over card", use: "a done session's status" },
  ...["ink", "ink-2"].flatMap((background) =>
    [
      { text: "on-dark", use: "titles, values, buttons" },
      { text: "on-dark-dim", use: "labels, sub-lines, inactive nav, the card head's badge" },
      { text: "on-ink", use: "the lock card's and the activation card's brand" },
      { text: "copper-2", use: "the lock card's “tra”, the slab's copper figures" },
      { text: "green-on-ink", use: "the slab's arrived count" },
      { text: "danger-on-ink", use: "the slab's no-show count" },
    ].map(({ text, use }) => ({ group: "Chrome (ink)", text, background, use })),
  ),
  { group: "Chrome (ink)", text: "on-dark", background: "glass 25% over ink-2", use: "on-dark buttons, the PIN pad, the active nav item" },
  ...["warning", "eligible", "danger"].map((text) => ({
    group: "Chrome (ink)",
    text,
    background: `${text} 22% over ink-2`,
    use: "the invoice head's tinted status",
  })),
  { group: "Chrome (ink)", text: "copper-on-ink", background: "copper 22% over ink-2", use: "the on-dark copper button" },
  ...["green", "green-2", "danger", "warning", "eligible", "muted"].map((background) => ({
    group: "Text on fills",
    text: "on-fill",
    background,
    use: "primary buttons, solid badges and pills, numbered circles, the invoice head's status",
  })),
  ...["copper", "copper-2"].map((background) => ({
    group: "Text on fills",
    text: "on-copper",
    background,
    use: "the in-room pill, avatars, the care-plan hero",
  })),
  { group: "Text on fills", text: "paper", background: "danger", use: "the sync auth-error banner" },
  { group: "Text on fills", text: "paper", background: "green", use: "the install banner's action" },
  { group: "Print", text: "print-note-ink", background: "print-note", use: "the printed pages' note" },
  { group: "Print", text: "print-ink", background: "print-paper", use: "printed pages" },
  { group: "Print", text: "print-ink 60%", background: "print-paper", use: "printed pages' greys (60% is the lightest)" },
  { group: "Print", text: "print-paper", background: "print-ink", use: "the prescription's drug numbers" },
];

const AA = 4.5;

/**
 * Placeholder text in an empty field is faint, outside the guard (decision
 * 7: faint is for placeholders and disabled controls only), each at its
 * exact ratio (two decimals).
 */
const PLACEHOLDERS: Readonly<Record<string, number>> = {
  "light: faint on field": 2.75,
  "light: faint on card": 2.92,
  "dark: faint on field": 3.88,
  "dark: faint on card": 4.13,
};

/** The pairs under AA the owner accepted, each at its exact ratio (two decimals). */
const ACCEPTED_UNDER_AA: Readonly<Record<string, number>> = {
  // Decision 9: warning on warning-wash is accepted in light as it is.
  "light: warning on warning-wash": 4.49,
  // Until decision 8 makes the invoice head's status a solid badge.
  "light: warning on warning 22% over ink-2": 2.21,
  "light: eligible on eligible 22% over ink-2": 1.8,
  "light: danger on danger 22% over ink-2": 1.8,
  "dark: eligible on eligible 22% over ink-2": 4.02,
  "dark: danger on danger 22% over ink-2": 3.44,
};

describe("contrast", () => {
  for (const name of Object.keys(THEMES) as ThemeName[]) {
    it(`every text/background pair the app uses reads at AA (${AA}:1) in ${name}`, () => {
      const under: string[] = [];
      for (const { text, background } of PAIRS) {
        const key = `${name}: ${text} on ${background}`;
        const ratio = contrast(THEMES[name], text, background);
        if (key in ACCEPTED_UNDER_AA) {
          expect(ratio.toFixed(2), key).toBe(ACCEPTED_UNDER_AA[key].toFixed(2));
        } else if (ratio < AA) {
          under.push(`${key} ${ratio.toFixed(2)}`);
        }
      }
      expect(under).toEqual([]);
    });
  }

  it("placeholders keep their recorded ratios", () => {
    for (const [key, recorded] of Object.entries(PLACEHOLDERS)) {
      const [name, pair] = key.split(": ") as [ThemeName, string];
      const [text, background] = pair.split(" on ");
      expect(contrast(THEMES[name], text, background).toFixed(2), key).toBe(recorded.toFixed(2));
    }
  });

  it("faint is text only as a placeholder", () => {
    const sources = (readdirSync(new URL(".", import.meta.url), { recursive: true }) as string[]).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    expect(sources).toContain(join("components", "ui", "Field.tsx"));
    const faintText: string[] = [];
    for (const file of sources) {
      readFileSync(new URL(file.replaceAll("\\", "/"), import.meta.url), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/(?<![\w:-])text-faint(?![\w-])/.test(line)) {
            faintText.push(`${file}:${index + 1}`);
          }
        });
    }
    expect(faintText).toEqual([]);
  });

  it("every accepted pair is one the app uses", () => {
    const used = new Set(PAIRS.flatMap(({ text, background }) => Object.keys(THEMES).map((name) => `${name}: ${text} on ${background}`)));
    for (const key of Object.keys(ACCEPTED_UNDER_AA)) {
      expect(used.has(key), key).toBe(true);
    }
  });
});
