import { addDaysToClinicDay, todayInCairo, type ClinicDay, type Instant } from "../../domain/time";

export type ActorRecency = { kind: "yesterday" } | { kind: "earlier"; day: number; month: number } | null;

/**
 * How much earlier than `today` a visit's actor byline's timestamp falls —
 * null when the visit was created on `today` itself or later (the common
 * case, nothing extra to show; "later" matters under the dev-only
 * ?seedDay=1 affordance, where a fresh write's real-now timestamp can fall
 * after the pinned displayed day), "أمس" for exactly the day before, or a
 * short numeric day/month for anything strictly earlier than that. Feeds
 * SlotRow's actor line (`.slot .actor`).
 */
export function computeActorRecency(createdAt: Instant, today: ClinicDay): ActorRecency {
  const createdDay = todayInCairo(new Date(createdAt));
  // ClinicDay is a zero-padded "YYYY-MM-DD" string, so lexicographic and
  // chronological ordering agree — no Date parsing needed for the compare.
  if (createdDay >= today) {
    return null;
  }
  if (createdDay === addDaysToClinicDay(today, -1)) {
    return { kind: "yesterday" };
  }
  const [, month, day] = createdDay.split("-").map(Number);
  return { kind: "earlier", day, month };
}
