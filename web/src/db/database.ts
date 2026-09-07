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
  }
}

export const db = new ClintraDatabase();
