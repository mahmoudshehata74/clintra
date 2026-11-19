import { id } from "../domain/id";
import { ACTIVE_VISIT_STATUSES, exceptionOn, isClosureReasonTooLong, normalizeClosureReason } from "../domain/scheduleExceptions";
import { todayInCairo, type ClinicDay, type ClockTime } from "../domain/time";
import { resolveActingMembership } from "./actingMembership";
import type { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { AuditAction, ScheduleExceptionType, type ScheduleException, type Visit } from "./types";

/**
 * A doctor's closed dates and one-day hours (settings → working hours,
 * "إجازات ومواعيد استثنائية"), one exception per doctor per date, written
 * through mutate() so they sync (docs/schema.md's v26 additions). Owner
 * only, as every settings write: the settings sheet is the owner's.
 * Neither write touches a visit: a closure on a date with bookings leaves
 * them where they are, flagged on the day screen as outside working hours.
 * A closure may carry an optional reason ("سبب الإجازة", docs/schema.md's
 * v27 additions), trimmed, null when empty, at most 200 characters; a
 * date's own hours carry none.
 */

export type AddExceptionInput =
  | { practitionerId: string; date: ClinicDay; kind: "closed"; reason?: string | null }
  | { practitionerId: string; date: ClinicDay; kind: "hours"; startTime: ClockTime; endTime: ClockTime };

export type AddExceptionResult =
  | { ok: true; exceptionId: string }
  | { ok: false; reason: "invalid_date" | "past_date" | "already_has_exception" | "end_before_start" | "reason_too_long" | "practitioner_not_found" };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isClinicDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Adds a closed date, or one replacement interval for a date, to a doctor. */
export async function addScheduleException(
  db: ClintraDatabase,
  input: AddExceptionInput,
  now: Date = new Date(),
): Promise<AddExceptionResult> {
  if (!isClinicDay(input.date)) {
    return { ok: false, reason: "invalid_date" };
  }
  if (input.date < todayInCairo(now)) {
    return { ok: false, reason: "past_date" };
  }
  if (input.kind === "hours" && input.startTime >= input.endTime) {
    return { ok: false, reason: "end_before_start" };
  }
  const closureReason = input.kind === "closed" ? normalizeClosureReason(input.reason) : null;
  if (closureReason !== null && isClosureReasonTooLong(closureReason)) {
    return { ok: false, reason: "reason_too_long" };
  }
  const actor = await resolveActingMembership(db);

  return db.transaction("rw", [db.schedule_exceptions, db.practitioners, db.audit_log, db.sync_ops], async () => {
    const practitioner = await db.practitioners.get(input.practitionerId);
    if (!practitioner) {
      return { ok: false, reason: "practitioner_not_found" } as const;
    }
    const existing = await db.schedule_exceptions.where("[practitioner_id+date]").equals([input.practitionerId, input.date]).toArray();
    if (exceptionOn(existing, input.practitionerId, input.date)) {
      return { ok: false, reason: "already_has_exception" } as const;
    }
    const after: ScheduleException = {
      id: id(),
      practitioner_id: input.practitionerId,
      date: input.date,
      type: input.kind === "closed" ? ScheduleExceptionType.Closed : ScheduleExceptionType.Shifted,
      start_time: input.kind === "hours" ? input.startTime : null,
      end_time: input.kind === "hours" ? input.endTime : null,
      shift_minutes: null,
      reason: closureReason,
      rev: 1,
    };
    await mutate(db, {
      table: db.schedule_exceptions,
      entity: "schedule_exceptions",
      entityId: after.id,
      action: AuditAction.Create,
      before: null,
      after,
      actorMembershipId: actor.id,
      orgId: practitioner.org_id,
    });
    return { ok: true, exceptionId: after.id } as const;
  });
}

export type DeleteExceptionResult = { ok: true } | { ok: false; reason: "not_found" };

/** Removes a doctor's exception: that date goes back to its weekly hours. */
export async function deleteScheduleException(db: ClintraDatabase, exceptionId: string): Promise<DeleteExceptionResult> {
  const actor = await resolveActingMembership(db);

  return db.transaction("rw", [db.schedule_exceptions, db.practitioners, db.audit_log, db.sync_ops], async () => {
    const before = await db.schedule_exceptions.get(exceptionId);
    if (!before) {
      return { ok: false, reason: "not_found" } as const;
    }
    const practitioner = await db.practitioners.get(before.practitioner_id);
    await mutate(db, {
      table: db.schedule_exceptions,
      entity: "schedule_exceptions",
      entityId: before.id,
      action: AuditAction.Delete,
      before,
      after: null,
      actorMembershipId: actor.id,
      orgId: practitioner?.org_id ?? actor.org_id,
    });
    return { ok: true } as const;
  });
}

/** The doctor's visits still to be seen on `date`, in time order — what a closure there would leave outside working hours. */
export async function activeVisitsOn(db: ClintraDatabase, practitionerId: string, date: ClinicDay): Promise<Visit[]> {
  const visits = await db.visits.where("[practitioner_id+visit_date]").equals([practitionerId, date]).toArray();
  return visits
    .filter((visit) => ACTIVE_VISIT_STATUSES.has(visit.status))
    .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? "") || a.position - b.position);
}
