import { addDaysToClinicDay, todayInCairo, type ClinicDay, type Instant } from "../../domain/time";

export type ActorRecency = { kind: "yesterday" } | { kind: "earlier"; day: number; month: number } | null;

/**
 * How much earlier than `today` a visit's actor byline's timestamp falls —
 * null for today itself (the common case, nothing extra to show), "أمس" for
 * yesterday, or a short numeric day/month for anything earlier. Feeds
 * SlotRow's actor line (`.slot .actor`).
 */
export function computeActorRecency(createdAt: Instant, today: ClinicDay): ActorRecency {
  const createdDay = todayInCairo(new Date(createdAt));
  if (createdDay === today) {
    return null;
  }
  if (createdDay === addDaysToClinicDay(today, -1)) {
    return { kind: "yesterday" };
  }
  const [, month, day] = createdDay.split("-").map(Number);
  return { kind: "earlier", day, month };
}
