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
  /** True once the advance's own write has resolved (success or failure). */
  settled: boolean;
  /** True once ADVANCE_COOLDOWN_MS has elapsed since the tap — set by a timer, never compared against a clock at render time. */
  windowElapsed: boolean;
}

export type CooldownState = Readonly<Record<string, CooldownEntry>>;

export const EMPTY_COOLDOWN_STATE: CooldownState = {};

/** Starts (or restarts) a visit's cooldown at the moment of its advancing tap. */
export function beginCooldown(state: CooldownState, visitId: string): CooldownState {
  return { ...state, [visitId]: { settled: false, windowElapsed: false } };
}

/** Marks a visit's in-flight advance as settled. A no-op for an unknown visit id. */
export function settleCooldown(state: CooldownState, visitId: string): CooldownState {
  return resolveFlag(state, visitId, "settled");
}

/** Marks a visit's cooldown window as elapsed (called from the timer started alongside beginCooldown). A no-op for an unknown visit id. */
export function elapseCooldown(state: CooldownState, visitId: string): CooldownState {
  return resolveFlag(state, visitId, "windowElapsed");
}

// Sets the given flag on a visit's entry, unless the other flag is already
// true — in that case both conditions are now met, so the entry is dropped
// entirely rather than kept around fully resolved, which is what lets
// isCoolingDown stay a plain membership check and keeps the map from
// growing over the course of a day.
function resolveFlag(state: CooldownState, visitId: string, flag: keyof CooldownEntry): CooldownState {
  const entry = state[visitId];
  if (!entry) {
    return state;
  }
  const otherFlag: keyof CooldownEntry = flag === "settled" ? "windowElapsed" : "settled";
  if (entry[otherFlag]) {
    const next = { ...state };
    delete next[visitId];
    return next;
  }
  return { ...state, [visitId]: { ...entry, [flag]: true } };
}

/** True while this visit's row button should stay disabled: present in the state at all means at least one of settled/windowElapsed is still outstanding. */
export function isCoolingDown(state: CooldownState, visitId: string): boolean {
  return visitId in state;
}
