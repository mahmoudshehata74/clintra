import type { ClinicDay, Instant } from "../../domain/time";
import { computeSinceLabel } from "../doctor/doctorDay";
import { dayScreenStrings } from "./strings";

/**
 * A queue row's in-room `.qwho .meta` phrase: "دخل من 7د", or "دخل دلوقتي"
 * under a minute — the doctor's day's own rule (computeSinceLabel), so both
 * screens switch to "دلوقتي" at the same moment. Off the live day (a pinned
 * ?seedDay=1) there is no elapsed time to show, and the row reads the plain
 * status word.
 */
export function queueInRoomMeta(startedAt: Instant, today: ClinicDay, now: Date): string {
  const since = computeSinceLabel(startedAt, today, now);
  if (since === null) {
    return dayScreenStrings.statusInRoom;
  }
  return since.kind === "just_now"
    ? dayScreenStrings.queueInRoomMetaNow
    : `${dayScreenStrings.queueInRoomMetaPrefix} ${since.label}`;
}
