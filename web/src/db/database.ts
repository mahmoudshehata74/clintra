import Dexie, { type EntityTable } from "dexie";
import type {
  AuditLog,
  CarePlan,
  CarePlanItem,
  CashClose,
  DayState,
  FormDefinition,
  Invoice,
  InvoiceItem,
  Location,
  Membership,
  MembershipLocation,
  MembershipPractitioner,
  Organization,
  Patient,
  Payment,
  Practitioner,
  PractitionerLocation,
  Schedule,
  ScheduleException,
  Service,
  ServicePriceOverride,
  SpecialtyTemplate,
  SyncOp,
  User,
  Visit,
  VisitFormData,
} from "./types";

export class ClintraDatabase extends Dexie {
  organizations!: EntityTable<Organization, "id">;
  locations!: EntityTable<Location, "id">;
  users!: EntityTable<User, "id">;
  memberships!: EntityTable<Membership, "id">;
  membership_locations!: EntityTable<MembershipLocation, "id">;
  membership_practitioners!: EntityTable<MembershipPractitioner, "id">;
  practitioners!: EntityTable<Practitioner, "id">;
  practitioner_locations!: EntityTable<PractitionerLocation, "id">;
  services!: EntityTable<Service, "id">;
  service_price_overrides!: EntityTable<ServicePriceOverride, "id">;
  schedules!: EntityTable<Schedule, "id">;
  schedule_exceptions!: EntityTable<ScheduleException, "id">;
  patients!: EntityTable<Patient, "id">;
  visits!: EntityTable<Visit, "id">;
  day_state!: EntityTable<DayState, "id">;
  invoices!: EntityTable<Invoice, "id">;
  invoice_items!: EntityTable<InvoiceItem, "id">;
  payments!: EntityTable<Payment, "id">;
  cash_close!: EntityTable<CashClose, "id">;
  audit_log!: EntityTable<AuditLog, "id">;
  specialty_templates!: EntityTable<SpecialtyTemplate, "id">;
  form_definitions!: EntityTable<FormDefinition, "id">;
  visit_form_data!: EntityTable<VisitFormData, "id">;
  care_plans!: EntityTable<CarePlan, "id">;
  care_plan_items!: EntityTable<CarePlanItem, "id">;
  sync_ops!: EntityTable<SyncOp, "op_id">;

  constructor(name = "clintra") {
    super(name);

    // Do not edit this version in place — existing local data must survive
    // every upgrade. Add new stores/indexes in a new version() block below.
    this.version(1).stores({
      organizations: "id",
      locations: "id",
      users: "id",
      memberships: "id",
      membership_locations: "id",
      membership_practitioners: "id",
      practitioners: "id",
      practitioner_locations: "id",
      services: "id",
      service_price_overrides: "id",
      schedules: "id",
      schedule_exceptions: "id",
      patients: "id, full_name, phone",
      visits:
        "id, [org_id+location_id+visit_date+status], [practitioner_id+visit_date], &[practitioner_id+visit_date+position]",
      day_state: "id",
      invoices: "id, &[location_id+number]",
      invoice_items: "id",
      payments: "id",
      cash_close: "id",
      audit_log: "id",
      specialty_templates: "id",
      form_definitions: "id",
      visit_form_data: "id",
      care_plans: "id",
      care_plan_items: "id",
    });

    // Adds the outbound sync queue used by the mutation pipeline (db/mutate.ts).
    // Every store from version 1 not mentioned here is carried forward as-is.
    this.version(2).stores({
      sync_ops: "op_id, synced_at",
    });

    // Adds a unique index enforcing that scheduled_at is unique per
    // practitioner per day, except for overbooked visits — see
    // unique_scheduled_at's doc comment in types.ts for how the exception
    // works. Restates visits' full index list, as Dexie requires when
    // changing an existing table's indexes.
    this.version(3).stores({
      visits:
        "id, [org_id+location_id+visit_date+status], [practitioner_id+visit_date], &[practitioner_id+visit_date+position], &[practitioner_id+visit_date+unique_scheduled_at]",
    });

    // Adds a unique index on users.phone — global, not per organization,
    // since users has no org_id of its own (a user's organizations are its
    // memberships). See docs/schema.md's v4 additions for why this differs
    // from patients.phone, which stays deliberately non-unique.
    this.version(4).stores({
      users: "id, &phone",
    });

    // Enforces the natural key docs/schema.md already declared for day_state
    // (practitioner_id + location_id + date) as a real unique index, now that
    // the doctor-delay feature is the first thing to write to this table.
    this.version(5).stores({
      day_state: "id, &[practitioner_id+location_id+date]",
    });
  }
}

export const db = new ClintraDatabase();
