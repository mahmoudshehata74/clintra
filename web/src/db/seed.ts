import { id } from "../domain/id";
import { Role } from "../domain/role";
import { LocationScope, PractitionerScope } from "../domain/scope";
import { ScheduleMode } from "../domain/scheduleMode";
import { cairoInstant, mostRecentWeekdayOnOrBefore, todayInCairo, type ClinicDay } from "../domain/time";
import { CancelReason, VisitStatus } from "../domain/visitStatus";
import { VisitSource } from "../domain/visitSource";
import { generateSlotTimes } from "../domain/schedule";
import type { Piastres } from "../domain/money";
import type { ClintraDatabase } from "./database";
import {
  PlanTier,
  SpecialtyTemplateGeneration,
  SpecialtyTemplatePricingMode,
  type DayState,
  type Membership,
  type Organization,
  type Patient,
  type Practitioner,
  type PractitionerLocation,
  type Schedule,
  type Service,
  type SpecialtyTemplate,
  type Location,
  type User,
  type Visit,
} from "./types";

const GENERAL_SPECIALTY_KEY = "general";

// The seed always places its five demo visits on the most recent Monday, not
// on whichever day the seed happens to run — otherwise a database seeded on,
// say, a Tuesday would show a populated Tuesday and an empty day for the rest
// of the week. The schedule itself is written for every weekday (see below),
// so today's grid always renders regardless of which day this is.
const SEEDED_VISITS_WEEKDAY = 1; // Monday

/**
 * The clinic day the seed's demo visits are pinned to: the most recent Monday
 * on or before referenceDay. Exposed so a caller that cannot read it back
 * from actual seeded rows (e.g. before any exist) can still derive the same
 * date the seed would choose today.
 */
export function seededVisitsDate(referenceDay: ClinicDay = todayInCairo()): ClinicDay {
  return mostRecentWeekdayOnOrBefore(referenceDay, SEEDED_VISITS_WEEKDAY);
}

/**
 * The seed's original slots-mode practitioner — found by schedule mode, not
 * by array position: db.practitioners.toArray() has no defined order beyond
 * IndexedDB's own key (UUID) ordering, which is arbitrary and does not
 * track insertion order. Now that the seed writes two practitioners (see
 * writeSeedData's doc comment), "the first one" is no longer a safe way for
 * a test to mean "the slots-mode one" — this is.
 */
export async function findSeededSlotsPractitioner(db: ClintraDatabase): Promise<Practitioner> {
  const schedules = await db.schedules.toArray();
  const slotsPractitionerId = schedules.find((schedule) => schedule.mode === ScheduleMode.Slots)?.practitioner_id;
  const practitioner = slotsPractitionerId ? await db.practitioners.get(slotsPractitionerId) : undefined;
  if (!practitioner) {
    throw new Error("seed did not produce a slots-mode practitioner");
  }
  return practitioner;
}

/** The seed's second practitioner, scheduled in queue mode every weekday — see writeSeedData's doc comment. */
export async function findSeededQueuePractitioner(db: ClintraDatabase): Promise<Practitioner> {
  const schedules = await db.schedules.toArray();
  const queuePractitionerId = schedules.find((schedule) => schedule.mode === ScheduleMode.Queue)?.practitioner_id;
  const practitioner = queuePractitionerId ? await db.practitioners.get(queuePractitionerId) : undefined;
  if (!practitioner) {
    throw new Error("seed did not produce a queue-mode practitioner");
  }
  return practitioner;
}

export interface SeedOptions {
  /**
   * Adds a second, queue-mode practitioner and its demo day (see
   * writeSeedData's doc comment). Off by default: every existing caller of
   * seedDatabase(db) — the whole rest of the test suite, written before
   * queue mode existed — assumes exactly one seeded practitioner, and nothing
   * about their behavior should have to change just because this feature
   * exists. Only the day screen itself (so ?seedDay=1 can reach a queue-mode
   * day) and queue-mode-specific tests that actually want the demo data pass
   * this.
   */
  includeQueueDemo?: boolean;
}

/**
 * Seeds one organization, one location, one assistant membership, three
 * services with Arabic names, five patients, one slots-mode practitioner (a
 * schedule for every weekday, five visits spread across seededVisitsDate()
 * in different statuses), and — only with { includeQueueDemo: true } — a
 * second, queue-mode practitioner scheduled every weekday the same way, with
 * six queue visits on the same seededVisitsDate(): two completed (10 and 12
 * minutes, so avg_consult_minutes has a real two-point median to show — see
 * docs/schema.md), one in_room, one arrived and one booked (both waiting,
 * exercising the "next" marker and the expected-wait line), and one no_show
 * (muted, doesn't count as waiting).
 *
 * Only runs when the database is empty, and is safe to call more than once
 * — including when two calls run concurrently (e.g. two open tabs), since
 * the emptiness check and every write happen inside one transaction:
 * IndexedDB serializes overlapping readwrite transactions on the same
 * stores, so a second concurrent call always sees the first call's
 * committed rows before deciding anything.
 */
export async function seedDatabase(db: ClintraDatabase, options: SeedOptions = {}): Promise<void> {
  const now = new Date().toISOString();
  const visitsDate = seededVisitsDate();

  await db.transaction(
    "rw",
    [
      db.organizations,
      db.locations,
      db.specialty_templates,
      db.practitioners,
      db.practitioner_locations,
      db.users,
      db.memberships,
      db.services,
      db.schedules,
      db.patients,
      db.visits,
      db.day_state,
    ],
    async () => {
      // The emptiness check and every write below share this one transaction,
      // so a concurrent call is serialized against this one by IndexedDB and
      // always sees these rows already committed before it decides anything.
      const existingCount = await db.organizations.count();
      if (existingCount > 0) {
        return;
      }

      await writeSeedData(db, now, visitsDate, options);
    },
  );
}

async function writeSeedData(
  db: ClintraDatabase,
  now: string,
  visitsDate: ClinicDay,
  options: SeedOptions,
): Promise<void> {
  const organization: Organization = {
    id: id(),
    name: "عيادة النور",
    plan_tier: PlanTier.Small,
    created_at: now,
  };

  const location: Location = {
    id: id(),
    org_id: organization.id,
    name: "الفرع الرئيسي",
    address: "شارع الجمهورية، القاهرة",
    phone: "+20221234567",
    is_active: true,
  };

  const specialtyTemplate: SpecialtyTemplate = {
    id: id(),
    org_id: null,
    key: GENERAL_SPECIALTY_KEY,
    name: "عام",
    generation: SpecialtyTemplateGeneration.None,
    default_count: null,
    gap_days: null,
    resource_type: null,
    pricing_mode: SpecialtyTemplatePricingMode.PerItem,
    stall_days: null,
    unit_label: "زيارة",
    provider_label: "طبيب",
  };

  const practitioner: Practitioner = {
    id: id(),
    org_id: organization.id,
    user_id: null,
    full_name: "أحمد المصري",
    specialty_id: specialtyTemplate.id,
    title: "طبيب عام",
    is_active: true,
  };

  const practitionerLocation: PractitionerLocation = {
    id: id(),
    practitioner_id: practitioner.id,
    location_id: location.id,
    is_active: true,
  };

  const queuePractitioner: Practitioner = {
    id: id(),
    org_id: organization.id,
    user_id: null,
    full_name: "سلمى إبراهيم",
    specialty_id: specialtyTemplate.id,
    title: "طبيبة عامة",
    is_active: true,
  };

  const queuePractitionerLocation: PractitionerLocation = {
    id: id(),
    practitioner_id: queuePractitioner.id,
    location_id: location.id,
    is_active: true,
  };

  const assistantUser: User = {
    id: id(),
    full_name: "سارة حسن",
    phone: "+201123456789",
    email: null,
    is_active: true,
  };

  const assistantMembership: Membership = {
    id: id(),
    user_id: assistantUser.id,
    org_id: organization.id,
    role: Role.Assistant,
    location_scope: LocationScope.All,
    practitioner_scope: PractitionerScope.All,
    practitioner_id: null,
    // Seed data only: not a real password/PIN hash.
    pin_hash: "seed-placeholder-pin-hash",
    is_active: true,
  };

  const services: Service[] = [
    {
      id: id(),
      org_id: organization.id,
      name: "كشف عام",
      duration_minutes: 30,
      default_price: 300_00 as Piastres,
      is_active: true,
    },
    {
      id: id(),
      org_id: organization.id,
      name: "استشارة متابعة",
      duration_minutes: 15,
      default_price: 150_00 as Piastres,
      is_active: true,
    },
    {
      id: id(),
      org_id: organization.id,
      name: "فحص شامل",
      duration_minutes: 45,
      default_price: 500_00 as Piastres,
      is_active: true,
    },
  ];

  // A working schedule on every weekday, so today's grid always has one
  // regardless of which day the app happens to be opened on — only the
  // demo visits below are pinned to a single fixed date.
  const SCHEDULE_TEMPLATE = {
    start_time: "09:00",
    end_time: "14:00",
    mode: ScheduleMode.Slots,
    slot_minutes: 30,
    max_capacity: null,
    resource_count: 1,
  } as const;

  const schedules: Schedule[] = Array.from({ length: 7 }, (_, weekday) => ({
    id: id(),
    practitioner_id: practitioner.id,
    location_id: location.id,
    weekday,
    ...SCHEDULE_TEMPLATE,
  }));

  // Every weekday in queue mode too, for the same reason — today's queue
  // renders regardless of which real day this runs on.
  const QUEUE_SCHEDULE_TEMPLATE = {
    start_time: "10:00",
    end_time: "16:00",
    mode: ScheduleMode.Queue,
    slot_minutes: null,
    max_capacity: 20,
    resource_count: 1,
  } as const;

  const queueSchedules: Schedule[] = Array.from({ length: 7 }, (_, weekday) => ({
    id: id(),
    practitioner_id: queuePractitioner.id,
    location_id: location.id,
    weekday,
    ...QUEUE_SCHEDULE_TEMPLATE,
  }));

  const patients: Patient[] = [
    "منى عبد الله",
    "كريم فتحي",
    "ياسمين توفيق",
    "عمر جمال",
    "هدى رجب",
  ].map((full_name) => ({
    id: id(),
    org_id: organization.id,
    full_name,
    phone: null,
    gender: null,
    birth_year: null,
    note: null,
    created_at: now,
  }));

  const slotTimes = generateSlotTimes(SCHEDULE_TEMPLATE);
  const visitPlan: { status: Visit["status"]; cancelReason: Visit["cancel_reason"] }[] = [
    { status: VisitStatus.Booked, cancelReason: null },
    { status: VisitStatus.Arrived, cancelReason: null },
    { status: VisitStatus.Completed, cancelReason: null },
    { status: VisitStatus.NoShow, cancelReason: CancelReason.NoShow },
    { status: VisitStatus.Cancelled, cancelReason: CancelReason.Patient },
  ];

  const visits: Visit[] = visitPlan.map((plan, index) => {
    const time = slotTimes[index];
    const scheduledAt = cairoInstant(visitsDate, time);
    const isArrivedOrLater =
      plan.status === VisitStatus.Arrived || plan.status === VisitStatus.Completed;
    const isCompleted = plan.status === VisitStatus.Completed;

    return {
      id: id(),
      org_id: organization.id,
      location_id: location.id,
      practitioner_id: practitioner.id,
      patient_id: patients[index].id,
      service_id: services[index % services.length].id,
      care_plan_item_id: null,
      visit_date: visitsDate,
      position: index + 1,
      scheduled_at: scheduledAt,
      unique_scheduled_at: scheduledAt,
      status: plan.status,
      is_overbooked: false,
      source: VisitSource.Phone,
      arrived_at: isArrivedOrLater ? scheduledAt : null,
      started_at: isCompleted ? scheduledAt : null,
      ended_at: isCompleted ? cairoInstant(visitsDate, slotTimes[index + 1] ?? "14:00") : null,
      cancel_reason: plan.cancelReason,
      rescheduled_from: null,
      created_by: assistantMembership.id,
      created_at: now,
    };
  });

  // Queue demo: two completed (10 and 12 minutes — median 11, matching this
  // feature's own specification example), one in_room (the prominent row),
  // one arrived and one booked (both waiting — the second becomes "التالي"),
  // and one no_show (muted, does not count as waiting). Reuses the same
  // five patients as the slots practitioner; the sixth visit reuses the
  // first patient again rather than inventing a sixth demo identity.
  const queueVisitPlan: { status: Visit["status"]; startTime: string | null; endTime: string | null }[] = [
    { status: VisitStatus.Completed, startTime: "10:00", endTime: "10:10" },
    { status: VisitStatus.Completed, startTime: "10:10", endTime: "10:22" },
    { status: VisitStatus.InRoom, startTime: "10:22", endTime: null },
    { status: VisitStatus.Arrived, startTime: null, endTime: null },
    { status: VisitStatus.Booked, startTime: null, endTime: null },
    { status: VisitStatus.NoShow, startTime: null, endTime: null },
  ];

  const queueVisits: Visit[] = queueVisitPlan.map((plan, index) => {
    const patient = patients[index % patients.length];
    const isArrivedOrLater = plan.status === VisitStatus.Arrived || plan.status === VisitStatus.InRoom || plan.status === VisitStatus.Completed;

    return {
      id: id(),
      org_id: organization.id,
      location_id: location.id,
      practitioner_id: queuePractitioner.id,
      patient_id: patient.id,
      service_id: services[index % services.length].id,
      care_plan_item_id: null,
      visit_date: visitsDate,
      position: index + 1,
      scheduled_at: null,
      status: plan.status,
      is_overbooked: false,
      source: VisitSource.Phone,
      arrived_at: isArrivedOrLater ? cairoInstant(visitsDate, plan.startTime ?? "10:00") : null,
      started_at: plan.startTime ? cairoInstant(visitsDate, plan.startTime) : null,
      ended_at: plan.endTime ? cairoInstant(visitsDate, plan.endTime) : null,
      cancel_reason: plan.status === VisitStatus.NoShow ? CancelReason.NoShow : null,
      rescheduled_from: null,
      created_by: assistantMembership.id,
      created_at: now,
    };
  });

  const queueDayState: DayState = {
    id: id(),
    practitioner_id: queuePractitioner.id,
    location_id: location.id,
    date: visitsDate,
    delay_minutes: 0,
    is_closed: false,
    // The median of the two completed visits' durations above (10, 12).
    avg_consult_minutes: 11,
  };

  await db.organizations.add(organization);
  await db.locations.add(location);
  await db.specialty_templates.add(specialtyTemplate);
  await db.practitioners.bulkAdd(options.includeQueueDemo ? [practitioner, queuePractitioner] : [practitioner]);
  await db.practitioner_locations.bulkAdd(
    options.includeQueueDemo ? [practitionerLocation, queuePractitionerLocation] : [practitionerLocation],
  );
  await db.users.add(assistantUser);
  await db.memberships.add(assistantMembership);
  await db.services.bulkAdd(services);
  await db.schedules.bulkAdd(options.includeQueueDemo ? [...schedules, ...queueSchedules] : schedules);
  await db.patients.bulkAdd(patients);
  await db.visits.bulkAdd(options.includeQueueDemo ? [...visits, ...queueVisits] : visits);
  if (options.includeQueueDemo) {
    await db.day_state.add(queueDayState);
  }
}
