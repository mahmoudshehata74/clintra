import { id } from "../domain/id";
import type { ClinicDay } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, type DayState } from "./types";

export interface SetDayDelayInput {
  practitionerId: string;
  locationId: string;
  orgId: string;
  date: ClinicDay;
  delayMinutes: number;
}

/**
 * Sets (or clears, with delayMinutes 0) the doctor's delay for a
 * practitioner + location + date, writing through mutate() like every other
 * change. The existing row for that day is looked up by its natural key
 * (practitioner_id + location_id + date — see docs/schema.md) inside the
 * same transaction as the write, so a concurrent call can't create two rows
 * for the same day: IndexedDB serializes overlapping readwrite transactions
 * on the same store, so a second call always sees the first one's row
 * already committed before deciding whether to create or update.
 */
export async function setDayDelay(db: ClintraDatabase, input: SetDayDelayInput): Promise<string> {
  const actor = await resolveActingMembership(db);

  return db.transaction("rw", db.day_state, db.audit_log, db.sync_ops, async () => {
    const current = await db.day_state
      .where("[practitioner_id+location_id+date]")
      .equals([input.practitionerId, input.locationId, input.date])
      .first();

    const after: DayState = current
      ? { ...current, delay_minutes: input.delayMinutes }
      : {
          id: id(),
          practitioner_id: input.practitionerId,
          location_id: input.locationId,
          date: input.date,
          delay_minutes: input.delayMinutes,
          is_closed: false,
          avg_consult_minutes: null,
        };

    return mutate(db, {
      table: db.day_state,
      entity: "day_state",
      entityId: after.id,
      action: current ? AuditAction.Update : AuditAction.Create,
      before: current ?? null,
      after,
      actorMembershipId: actor.id,
      orgId: input.orgId,
    });
  });
}
