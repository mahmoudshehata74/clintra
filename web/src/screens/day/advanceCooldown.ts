// A row's primary button re-renders with a fresh click handler the instant
// its visit's status changes, so an accidental double-tap can land as two
// deliberate taps and skip a status entirely (e.g. arrived straight to
// completed, invoiced, without ever being in_room). The data layer already
// refuses a stale duplicate transition (db/visitAttendance.ts's
// canTransitionVisitStatus), but by then the UI has already acted on the
// second tap as if it meant something — this guard keeps that second tap
// from reaching a handler at all. 700ms is comfortably longer than any
// human double-tap interval, and far shorter than the real-world gap
// between two statuses.
export const ADVANCE_COOLDOWN_MS = 700;

interface CooldownEntry {
  startedAt: number;
  /** True once the advance's own write has resolved (success or failure). */
  settled: boolean;
}

export type CooldownState = Readonly<Record<string, CooldownEntry>>;

export const EMPTY_COOLDOWN_STATE: CooldownState = {};

/** Starts a visit's cooldown at the moment of its advancing tap. */
export function beginCooldown(state: CooldownState, visitId: string, startedAt: number): CooldownState {
  return { ...state, [visitId]: { startedAt, settled: false } };
}

/** Marks a visit's in-flight advance as settled. A no-op for an unknown visit id. */
export function settleCooldown(state: CooldownState, visitId: string): CooldownState {
  const entry = state[visitId];
  if (!entry) {
    return state;
  }
  return { ...state, [visitId]: { ...entry, settled: true } };
}

/**
 * True while this visit's row button should stay disabled: blocked until
 * ADVANCE_COOLDOWN_MS has passed since the tap AND the advance has settled,
 * whichever is later. A visit with no cooldown entry (never tapped, or long
 * since released) is never blocked.
 */
export function isCoolingDown(state: CooldownState, visitId: string, now: number): boolean {
  const entry = state[visitId];
  if (!entry) {
    return false;
  }
  return !entry.settled || now - entry.startedAt < ADVANCE_COOLDOWN_MS;
}
