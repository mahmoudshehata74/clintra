/**
 * Client-side PIN rate limiting: five wrong attempts, then a 30-second delay
 * before another is accepted (docs/auth-plan.md, Layer 2). State is kept in
 * sessionStorage, keyed per membership, so a page reload cannot reset the
 * counter — that would be the obvious bypass. It clears when the tab closes.
 *
 * CLIENT-SIDE ONLY, and therefore advisory: anyone who can open dev tools can
 * clear sessionStorage or call the verify path directly, so this stops casual
 * shoulder-surfing guessing, not a determined attacker. Real enforcement
 * arrives when the Laravel backend rate-limits PIN verification server-side;
 * this is the interim local guard until then.
 */
export const MAX_ATTEMPTS_BEFORE_DELAY = 5;
export const DELAY_MS = 30_000;

interface AttemptState {
  failed: number;
  lockedUntil: number | null;
}

const EMPTY: AttemptState = { failed: 0, lockedUntil: null };

// sessionStorage exists in the browser; in the Node test runner it does not, so
// fall back to an in-memory map (a unit test only needs the logic, not the
// reload-survival, which the Playwright suite covers in a real browser).
const memoryStore = new Map<string, string>();

function storageKey(membershipId: string): string {
  return `clintra:pin_attempts:${membershipId}`;
}

function readRaw(key: string): string | null {
  if (typeof sessionStorage !== "undefined") {
    return sessionStorage.getItem(key);
  }
  return memoryStore.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(key, value);
  } else {
    memoryStore.set(key, value);
  }
}

function removeRaw(key: string): void {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(key);
  } else {
    memoryStore.delete(key);
  }
}

function readState(membershipId: string): AttemptState {
  const raw = readRaw(storageKey(membershipId));
  if (!raw) {
    return { ...EMPTY };
  }
  try {
    const parsed = JSON.parse(raw) as AttemptState;
    return { failed: parsed.failed ?? 0, lockedUntil: parsed.lockedUntil ?? null };
  } catch {
    return { ...EMPTY };
  }
}

/** How long the membership must wait before the next attempt, in ms (0 when free to try). */
export function getLockRemainingMs(membershipId: string, now: number = Date.now()): number {
  const { lockedUntil } = readState(membershipId);
  if (lockedUntil === null) {
    return 0;
  }
  return Math.max(0, lockedUntil - now);
}

/** Number of failed attempts recorded so far (for the "wrong PIN" UI state). */
export function getFailedCount(membershipId: string): number {
  return readState(membershipId).failed;
}

/**
 * Records one wrong PIN. Once the failure count reaches the limit, every
 * further failure (re)arms a fresh 30-second delay — an escalating cool-down
 * rather than a hard lockout, so a shared front-desk device is never bricked
 * mid-shift (docs/auth-plan.md, Layer 2). Returns the new remaining lock in ms.
 */
export function registerFailedAttempt(membershipId: string, now: number = Date.now()): number {
  const state = readState(membershipId);
  const failed = state.failed + 1;
  const lockedUntil = failed >= MAX_ATTEMPTS_BEFORE_DELAY ? now + DELAY_MS : null;
  writeRaw(storageKey(membershipId), JSON.stringify({ failed, lockedUntil } satisfies AttemptState));
  return lockedUntil === null ? 0 : DELAY_MS;
}

/** Clears all attempt state for a membership — called on a correct PIN. */
export function clearAttempts(membershipId: string): void {
  removeRaw(storageKey(membershipId));
}
