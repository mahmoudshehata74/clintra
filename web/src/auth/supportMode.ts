const STORAGE_KEY = "clintra:support-mode";
const SUPPORT_DATABASE_NAME = "clintra-support";

function readEntry(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith("#support=")) return null;
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  try { sessionStorage.setItem(STORAGE_KEY, "1"); } catch { /* Private storage may be unavailable. */ }
  try { return decodeURIComponent(hash.slice("#support=".length)); } catch { return ""; }
}

/** Read and remove the one-time URL secret before any registration path runs. */
export const supportEntryCode = readEntry();
let stored = false;
try { stored = typeof sessionStorage !== "undefined" && sessionStorage.getItem(STORAGE_KEY) === "1"; } catch { /* Private storage may be unavailable. */ }
let support = supportEntryCode !== null || stored;
if (support && typeof document !== "undefined") document.documentElement.dataset.supportMode = "true";
let originalFetch: typeof fetch | null = null;

/** Observe every request from this support tab, including auxiliary identity requests. */
export function observeSupport401(): void {
  if (!support || typeof window === "undefined" || originalFetch) return;
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch!(input, init);
    if (response.status === 401) window.dispatchEvent(new Event("clintra:sync-auth-error"));
    return response;
  };
}

export function isSupportMode(): boolean { return support; }
export function supportDatabaseName(): string { return SUPPORT_DATABASE_NAME; }
export function clearSupportMode(): void {
  support = false;
  if (originalFetch && typeof window !== "undefined") window.fetch = originalFetch;
  originalFetch = null;
  if (typeof document !== "undefined") delete document.documentElement.dataset.supportMode;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Private storage may be unavailable. */ }
}
