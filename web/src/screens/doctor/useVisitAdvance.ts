import { useState } from "react";
import { isDeviceSeriesUnknown } from "../../db/deviceRegistration";
import type { Visit } from "../../db/types";
import {
  ADVANCE_COOLDOWN_MS,
  beginCooldown,
  elapseCooldown,
  EMPTY_COOLDOWN_STATE,
  isCoolingDown,
  settleCooldown,
  type CooldownState,
} from "../day/advanceCooldown";
import { dayScreenStrings } from "../day/strings";

export interface VisitAdvance {
  /** Runs one status write (markVisitInRoom, markVisitCompleted…) behind the advance cooldown. */
  advance: (visit: Visit, write: (visitId: string) => Promise<unknown>) => Promise<void>;
  isCoolingDown: (visitId: string) => boolean;
  /** The one failure explained rather than only logged: completing cannot mint an invoice number yet. */
  advanceError: string | null;
}

/**
 * The doctor's own status writes: the day screen's advance cooldown
 * (advanceCooldown.ts) around the same db/ write paths its row taps use.
 * Shared by the doctor's day and the current-visit page, so calling in and
 * closing a visit behave the same from either.
 */
export function useVisitAdvance(): VisitAdvance {
  const [cooldown, setCooldown] = useState<CooldownState>(EMPTY_COOLDOWN_STATE);
  // device_series_unknown: nothing was written and the patient is still in the room.
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  async function advance(visit: Visit, write: (visitId: string) => Promise<unknown>) {
    setCooldown((prev) => beginCooldown(prev, visit.id));
    window.setTimeout(() => {
      setCooldown((prev) => elapseCooldown(prev, visit.id));
    }, ADVANCE_COOLDOWN_MS);
    setAdvanceError(null);
    try {
      await write(visit.id);
    } catch (error) {
      if (isDeviceSeriesUnknown(error)) {
        setAdvanceError(dayScreenStrings.deviceSeriesUnknownError);
        return;
      }
      console.error(error);
    } finally {
      setCooldown((prev) => settleCooldown(prev, visit.id));
    }
  }

  return {
    advance,
    isCoolingDown: (visitId) => isCoolingDown(cooldown, visitId),
    advanceError,
  };
}
