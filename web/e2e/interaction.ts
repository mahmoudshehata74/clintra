import { expect, type Locator, type Page } from "@playwright/test";

// Interaction checks shared by the delay picker's spec and the interaction
// audit (audit.spec.ts): an opened overlay must sit fully inside the
// viewport, and every control in it must be the element a tap at its centre
// actually reaches — which catches a control clipped by an ancestor's
// overflow, covered by another layer, or pushed off screen.

/** The controls a person can tap: buttons, links, inputs, menu items. */
export const CONTROL_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="menuitem"], [role="button"], [role="tab"]';

/** Asserts the element's box lies inside the viewport (1px of rounding allowed). */
export async function expectInsideViewport(target: Locator): Promise<void> {
  const box = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
  });
  expect(box.top, "top edge inside the viewport").toBeGreaterThanOrEqual(-1);
  expect(box.left, "left edge inside the viewport").toBeGreaterThanOrEqual(-1);
  expect(box.bottom, "bottom edge inside the viewport").toBeLessThanOrEqual(box.height + 1);
  expect(box.right, "right edge inside the viewport").toBeLessThanOrEqual(box.width + 1);
}

/**
 * Every visible control inside `scope` (the scope itself included when it is
 * one), scrolled into view, hit-tests to itself at its centre:
 * document.elementFromPoint returns the control or something inside it.
 * Resolves to the descriptions of the controls that fail, so a caller can
 * report every one at once.
 */
export async function controlsMissingHitTest(scope: Locator): Promise<string[]> {
  return scope.evaluate((root, selector) => {
    const describe = (element: Element) => {
      const label =
        element.getAttribute("aria-label") ||
        (element as HTMLInputElement).placeholder ||
        element.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) ||
        element.id;
      return `<${element.tagName.toLowerCase()}> "${label}"`;
    };
    const controls = [root, ...Array.from(root.querySelectorAll(selector))].filter((element) => element.matches(selector));
    const failures: string[] = [];
    for (const element of controls) {
      const html = element as HTMLElement;
      if (!html.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
        continue;
      }
      // A control inside a closed <details> or a zero-size control (a
      // visually hidden native input behind a styled one) is not a target.
      const initial = html.getBoundingClientRect();
      if (initial.width < 1 || initial.height < 1) {
        continue;
      }
      html.scrollIntoView({ block: "center", inline: "center" });
      const rect = html.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== element && !element.contains(hit))) {
        failures.push(`${describe(element)} at (${Math.round(x)}, ${Math.round(y)}) hits ${hit ? describe(hit) : "nothing"}`);
      }
    }
    return failures;
  }, CONTROL_SELECTOR);
}

/** Asserts every visible control inside `scope` hit-tests to itself. */
export async function expectControlsHitTest(scope: Locator): Promise<void> {
  expect(await controlsMissingHitTest(scope)).toEqual([]);
}

/** The page never scrolls sideways. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal page overflow in px").toBeLessThanOrEqual(0);
}
