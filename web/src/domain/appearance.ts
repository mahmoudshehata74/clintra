/**
 * The device's appearance (docs/session-handoff.md's "Dark mode"): "auto"
 * follows the system's light/dark preference; "light" and "dark" are an
 * explicit choice, set as `data-theme` on <html> (index.css's dark blocks).
 * The choice is per device: stored in db/preferences.ts and mirrored into
 * localStorage under APPEARANCE_MIRROR_KEY, which index.html's inline
 * script reads synchronously before the first paint.
 */
export type Appearance = "auto" | "light" | "dark";

/** The toggle's order: تلقائي → فاتح → غامق → تلقائي. */
export const APPEARANCE_CYCLE: readonly Appearance[] = ["auto", "light", "dark"];

/** The localStorage key index.html's boot script reads (index.html.test.ts keeps the two equal). */
export const APPEARANCE_MIRROR_KEY = "clintra.appearance";

export const APPEARANCE_LABEL: Record<Appearance, string> = {
  auto: "تلقائي",
  light: "فاتح",
  dark: "غامق",
};

export function nextAppearance(current: Appearance): Appearance {
  return APPEARANCE_CYCLE[(APPEARANCE_CYCLE.indexOf(current) + 1) % APPEARANCE_CYCLE.length];
}

/** Anything stored that is not a known appearance (missing, stale, hand-edited) reads as auto. */
export function parseAppearance(value: unknown): Appearance {
  return value === "light" || value === "dark" ? value : "auto";
}

/** The `data-theme` attribute an appearance sets on <html>; auto sets none, so the system decides. */
export function themeAttribute(appearance: Appearance): "light" | "dark" | null {
  return appearance === "auto" ? null : appearance;
}

/** The toggle's accessible name, e.g. "المظهر: تلقائي". */
export function appearanceAccessibleName(appearance: Appearance): string {
  return `المظهر: ${APPEARANCE_LABEL[appearance]}`;
}
