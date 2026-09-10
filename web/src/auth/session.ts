/**
 * The active staff session: the membership currently operating the tablet.
 *
 * In memory only, never persisted — per docs/auth-plan.md, Layer 3. Closing the
 * tab, reloading the app, or an idle timeout all drop it, and the lock screen
 * reappears. This is deliberate: a persisted session would survive exactly the
 * events (relaunch, idle) that are supposed to re-lock, and would let the audit
 * log keep attributing writes to someone who walked away hours ago.
 */
let activeMembershipId: string | null = null;
// The last membership that was logged in this run — kept even after the session
// clears (idle/explicit lock) so a re-lock can offer that person's PIN pad
// directly ("دخول <name>"). Not persisted, so an app relaunch forgets it and
// falls back to the picker ("دخول العيادة").
let lastActiveMembershipId: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** The membership id currently logged in, or null when locked. */
export function getActiveMembershipId(): string | null {
  return activeMembershipId;
}

/** The last membership logged in this run, retained across a lock; null after a relaunch. */
export function getLastActiveMembershipId(): string | null {
  return lastActiveMembershipId;
}

/** Begins a session for the given membership (called after a correct PIN). */
export function setActiveMembershipId(membershipId: string): void {
  lastActiveMembershipId = membershipId;
  if (activeMembershipId === membershipId) {
    return;
  }
  activeMembershipId = membershipId;
  emit();
}

/** Ends the session (explicit lock, idle timeout, or app relaunch clean-up). */
export function clearActiveSession(): void {
  if (activeMembershipId === null) {
    return;
  }
  activeMembershipId = null;
  emit();
}

/** Subscribe to session changes — the shape useSyncExternalStore expects. */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
