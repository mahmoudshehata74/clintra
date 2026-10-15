import { useSyncExternalStore } from "react";
import { db } from "../db/database";
import { loadAppearance, saveAppearance } from "../db/preferences";
import { APPEARANCE_MIRROR_KEY, nextAppearance, parseAppearance, themeAttribute, type Appearance } from "../domain/appearance";

/**
 * The device's appearance at run time (domain/appearance.ts): one value
 * shared by every toggle on screen (the app bar's and the lock screen's),
 * applied to <html> as `data-theme`, mirrored into localStorage for
 * index.html's pre-paint script, and stored in db/preferences.ts — the
 * source of truth, restored once at boot.
 */

function readMirror(): Appearance {
  try {
    return parseAppearance(window.localStorage.getItem(APPEARANCE_MIRROR_KEY));
  } catch {
    // Storage blocked (a private window's policy): the system decides.
    return "auto";
  }
}

function writeMirror(appearance: Appearance): void {
  try {
    window.localStorage.setItem(APPEARANCE_MIRROR_KEY, appearance);
  } catch {
    // Without the mirror the next load paints auto first, then restores.
  }
}

/** `<meta name="theme-color">` follows the active theme: the green token, as the page's CSS resolves it right now. */
function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  const green = getComputedStyle(document.documentElement).getPropertyValue("--color-green").trim();
  if (meta && green) {
    meta.setAttribute("content", green);
  }
}

// index.html's script already set data-theme from the same mirror.
let current: Appearance = readMirror();
let chosenThisSession = false;
const listeners = new Set<() => void>();

// In auto the system can switch under the page; the theme colour follows.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);

function apply(appearance: Appearance): void {
  const attribute = themeAttribute(appearance);
  if (attribute) {
    document.documentElement.setAttribute("data-theme", attribute);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  writeMirror(appearance);
  syncThemeColor();
  if (appearance !== current) {
    current = appearance;
    listeners.forEach((listener) => listener());
  }
}

/** The toggle: تلقائي → فاتح → غامق, applied at once and stored for this device. */
export function cycleAppearance(): void {
  const next = nextAppearance(current);
  chosenThisSession = true;
  apply(next);
  void saveAppearance(db, next);
}

/**
 * At boot: the stored choice wins over the mirror (cleared site storage,
 * another tab's change), unless the toggle was already pressed meanwhile.
 */
export async function restoreAppearance(): Promise<void> {
  const stored = await loadAppearance(db);
  if (!chosenThisSession) {
    apply(stored ?? "auto");
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => current);
}
