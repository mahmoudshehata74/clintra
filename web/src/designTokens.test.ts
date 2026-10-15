/// <reference types="node" />
import { readFileSync } from "node:fs";
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

describe("design tokens", () => {
  it("the prototype's two dark blocks agree, so either is its dark theme", () => {
    expect(prototypeSystemDark).toEqual(prototypeDark);
  });

  it("the light tokens are the prototype's :root", () => {
    for (const [name, value] of Object.entries(prototypeLight)) {
      expect(theme[name], name).toBe(value);
    }
  });

  it("both dark blocks are the prototype's dark values verbatim, with color-scheme dark", () => {
    expect(systemDark).toEqual(prototypeDark);
    expect(explicitDark).toEqual(prototypeDark);
    expect(systemDark["color-scheme"]).toBe("dark");
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
