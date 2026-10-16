import { expect, type Locator, type Page } from "@playwright/test";
import { controlsMissingHitTest, expectInsideViewport, expectNoHorizontalScroll } from "./interaction";

// The interaction audit's checks (audit.spec.ts), run on every opened state
// of every screen: no page or console error so far, no sideways page
// scroll, the overlay inside the viewport, every control hit-testing to
// itself, every text input taking typing, and a visible focus on Tab.

export type Theme = "light" | "dark";

/** Collects every uncaught page error and console error from here on. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  return errors;
}

/**
 * Before the first navigation: the system colour scheme for `theme` (the
 * app's appearance stays on auto, so the system decides), and no CSS
 * transitions or animations, so a computed style read right after a focus
 * change is its settled value and the checks never race a fade.
 */
export async function prepareAudit(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(() => {
    const install = () => {
      const style = document.createElement("style");
      style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
      document.head.append(style);
    };
    if (document.head) {
      install();
    } else {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    }
  });
}

const TEXT_INPUT_SELECTOR =
  'input:not([type]), input[type="text"], input[type="tel"], input[type="search"], input[type="number"], input[type="email"], input[type="password"], textarea';

/** What to type into an input, by the keyboard it asks for, and what it must then read. */
function sampleFor(inputMode: string | null, type: string | null): string {
  if (inputMode === "numeric" || inputMode === "decimal" || type === "number") {
    return "12";
  }
  if (inputMode === "tel" || type === "tel") {
    return "0100";
  }
  return "تجربة";
}

/**
 * Every visible, editable text input in `scope` takes typing: the typed
 * sample reads back, and the original value is put back afterwards so the
 * state under audit is unchanged.
 */
async function expectInputsTakeTyping(scope: Locator, label: string): Promise<void> {
  const inputs = scope.locator(TEXT_INPUT_SELECTOR);
  const count = await inputs.count();
  for (let index = 0; index < count; index++) {
    const input = inputs.nth(index);
    if (!(await input.isVisible()) || !(await input.isEditable())) {
      continue;
    }
    const original = await input.inputValue();
    const sample = sampleFor(await input.getAttribute("inputmode"), await input.getAttribute("type"));
    await input.fill(sample);
    await expect(input, `${label}: input ${index} reads back what was typed`).toHaveValue(sample);
    await input.fill(original);
  }
}

/** The computed styles a focus indicator can change. */
const FOCUS_STYLE_PROPERTIES = [
  "outline-style",
  "outline-width",
  "outline-color",
  "box-shadow",
  "background-color",
  "border-color",
  "color",
  "text-decoration-line",
] as const;

/**
 * Tabbing through `scope` (from its first control, at most `maxStops`
 * stops), every control that takes focus inside it looks different focused
 * than not: some focus style (outline, ring, fill, border, colour,
 * underline) changes. Controls outside the scope are skipped.
 */
async function expectFocusVisibleOnTab(page: Page, scope: Locator, label: string, maxStops = 12): Promise<void> {
  const started = await scope.evaluate((root) => {
    const first = root.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return first !== null;
  });
  if (!started) {
    return;
  }
  const failures: string[] = [];
  for (let stop = 0; stop < maxStops; stop++) {
    await page.keyboard.press("Tab");
    const result = await scope.evaluate((root, properties) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body || !root.contains(active)) {
        return { inside: false, same: false, name: "" };
      }
      const read = () => {
        const style = getComputedStyle(active);
        return properties.map((property) => style.getPropertyValue(property)).join("|");
      };
      const focused = read();
      active.blur();
      const unfocused = read();
      active.focus();
      const name = `<${active.tagName.toLowerCase()}> "${(active.getAttribute("aria-label") || active.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
      return { inside: true, same: focused === unfocused, name };
    }, FOCUS_STYLE_PROPERTIES);
    if (!result.inside) {
      break;
    }
    if (result.same) {
      failures.push(result.name);
    }
  }
  expect(failures, `${label}: controls with no visible focus on Tab`).toEqual([]);
}

export interface AuditOptions {
  /** The opened overlay; omit for a whole page (no box check, the page's own controls). */
  overlay?: Locator;
  /** Skip the typing check (a state whose inputs would write on change). */
  skipTyping?: boolean;
}

/** Runs every check on the state now on screen. */
export async function auditState(page: Page, errors: string[], label: string, options: AuditOptions = {}): Promise<void> {
  const scope = options.overlay ?? page.locator("body");
  await expect(scope, `${label}: visible`).toBeVisible();
  expect(errors, `${label}: page and console errors`).toEqual([]);
  await expectNoHorizontalScroll(page);
  if (options.overlay) {
    await expectInsideViewport(options.overlay, label);
  }
  expect(await controlsMissingHitTest(scope), `${label}: controls that do not hit-test to themselves`).toEqual([]);
  if (!options.skipTyping) {
    await expectInputsTakeTyping(scope, label);
  }
  await expectFocusVisibleOnTab(page, scope, label);
  expect(errors, `${label}: page and console errors after interacting`).toEqual([]);
}
