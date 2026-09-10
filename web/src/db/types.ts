import type { CancelReason, VisitStatus } from "../domain/visitStatus";
import type { VisitSource } from "../domain/visitSource";
import type { ScheduleMode } from "../domain/scheduleMode";
import type { Role } from "../domain/role";
import type { LocationScope, PractitionerScope } from "../domain/scope";
import type { Piastres } from "../domain/money";
import type { ClinicDay, ClockTime, Instant } from "../domain/time";

export type { ClinicDay, ClockTime, Instant };

export const PlanTier = {
  Small: "small",
  Medium: "medium",
  Large: "large",
} as const;

export type PlanTier = (typeof PlanTier)[keyof typeof PlanTier];

export interface Organization {
  id: string;
  name: string;
  plan_tier: PlanTier;
  created_at: Instant;
}

export interface Location {
  id: string;
  org_id: string;
  name: string;
  address: string;
  phone: string;
  is_active: boolean;
}

export interface User {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  is_active: boolean;
}

export interface Membership {
  id: string;
  user_id: string;
  org_id: string;
  role: Role;
  location_scope: LocationScope;
  practitioner_scope: PractitionerScope;
  /** Required only when practitioner_scope is "self". */
  practitioner_id: string | null;
  pin_hash: string;
  /**
   * Per-membership salt for pin_hash (Argon2id). Nullable for rows written
   * before database version 9, and for any membership whose PIN has not been
   * set yet. See db/deviceRegistration.ts's sibling auth modules
   * (auth/pinHash.ts) and docs/schema.md's v9 additions.
   */
  pin_salt: string | null;
  is_active: boolean;
}

/** Natural key is the composite membership_id + location_id; `id` added as the Dexie primary key. */
export interface MembershipLocation {
  id: string;
  membership_id: string;
  location_id: string;
}

/** Natural key is the composite membership_id + practitioner_id; `id` added as the Dexie primary key. */
export interface MembershipPractitioner {
  id: string;
  membership_id: string;
  practitioner_id: string;
}

export interface Practitioner {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  specialty_id: string;
  title: string;
  is_active: boolean;
}

/** Natural key is the composite practitioner_id + location_id; `id` added as the Dexie primary key. */
export interface PractitionerLocation {
  id: string;
  practitioner_id: string;
  location_id: string;
  is_active: boolean;
}

export interface Service {
  id: string;
  org_id: string;
  name: string;
  duration_minutes: number;
  default_price: Piastres;
  is_active: boolean;
}

export interface ServicePriceOverride {
  id: string;
  service_id: string;
  practitioner_id: string | null;
  location_id: string | null;
  price: Piastres;
}

export interface Schedule {
  id: string;
  practitioner_id: string;
  location_id: string;
  /** 0-6. */
  weekday: number;
  start_time: ClockTime;
  end_time: ClockTime;
  mode: ScheduleMode;
  /** Slots mode only. */
  slot_minutes: number | null;
  /** Queue mode only. */
  max_capacity: number | null;
  /** Defaults to 1. */
  resource_count: number;
}

export const ScheduleExceptionType = {
  Closed: "closed",
  Extra: "extra",
  Shifted: "shifted",
} as const;

export type ScheduleExceptionType = (typeof ScheduleExceptionType)[keyof typeof ScheduleExceptionType];

export interface ScheduleException {
  id: string;
  practitioner_id: string;
  date: ClinicDay;
  type: ScheduleExceptionType;
  start_time: ClockTime | null;
  end_time: ClockTime | null;
  shift_minutes: number | null;
}

export interface Patient {
  id: string;
  org_id: string;
  full_name: string;
  phone: string | null;
  gender: string | null;
  birth_year: number | null;
  note: string | null;
  created_at: Instant;
}

export interface Visit {
  id: string;
  org_id: string;
  location_id: string;
  practitioner_id: string;
  patient_id: string;
  service_id: string | null;
  /** Left null in v1. */
  care_plan_item_id: string | null;
  visit_date: ClinicDay;
  position: number;
  /** Null in queue mode. */
  scheduled_at: Instant | null;
  /**
   * Equal to scheduled_at, except entirely absent (not merely null) when
   * is_overbooked is true. Backs the unique index below: IndexedDB excludes
   * a record from a compound index the moment any of its key path
   * components is undefined, so overbooked visits are simply invisible to
   * this index instead of colliding with each other. See docs/schema.md.
   */
  unique_scheduled_at?: Instant;
  status: VisitStatus;
  is_overbooked: boolean;
  source: VisitSource;
  arrived_at: Instant | null;
  started_at: Instant | null;
  ended_at: Instant | null;
  cancel_reason: CancelReason | null;
  rescheduled_from: string | null;
  /** Membership id. */
  created_by: string;
  created_at: Instant;
}

/** Natural key is the composite practitioner_id + location_id + date; `id` added as the Dexie primary key. */
export interface DayState {
  id: string;
  practitioner_id: string;
  location_id: string;
  date: ClinicDay;
  delay_minutes: number;
  is_closed: boolean;
  /** Derived from started_at to ended_at. */
  avg_consult_minutes: number | null;
}

export const InvoiceStatus = {
  Unpaid: "unpaid",
  Partial: "partial",
  Paid: "paid",
  Void: "void",
} as const;

export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export interface Invoice {
  id: string;
  org_id: string;
  location_id: string;
  /** Sequential per location per calendar year (see issued_year). */
  number: number;
  /**
   * The Africa/Cairo calendar year `number` is scoped to (see
   * domain/time.ts's cairoYear) — a real, indexed field rather than a value
   * derived from issued_at on read, since the compound unique index backing
   * `number`'s per-location-per-year uniqueness needs an actual key path.
   * Added alongside that index in local database version 7.
   */
  issued_year: number;
  patient_id: string;
  practitioner_id: string;
  visit_id: string | null;
  total: Piastres;
  paid: Piastres;
  status: InvoiceStatus;
  issued_at: Instant;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  service_id: string;
  description: string;
  qty: number;
  unit_price: Piastres;
  total: Piastres;
}

export const PaymentMethod = {
  Cash: "cash",
  Card: "card",
  Wallet: "wallet",
  Transfer: "transfer",
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export interface Payment {
  id: string;
  invoice_id: string;
  /**
   * Denormalised from the invoice at write time (not just derivable by a
   * join) so receipt_number's per-location sequence, and its backing unique
   * index, can be queried and enforced directly on this table. Added in
   * local database version 7.
   */
  location_id: string;
  amount: Piastres;
  method: PaymentMethod;
  /** Sequential per location, across all time — never reused, never per-invoice or per-year. */
  receipt_number: string;
  note: string | null;
  /**
   * True when a cash_close already existed for this payment's location and
   * day at the moment it was recorded — a late payment on an already-closed
   * day, flagged so it stands out in the audit log rather than silently
   * blending into the closed day's numbers. Added in local database version 7.
   */
  after_close: boolean;
  /** Membership id. */
  created_by: string;
  created_at: Instant;
}

export interface CashClose {
  id: string;
  location_id: string;
  date: ClinicDay;
  total_expected: Piastres;
  total_collected: Piastres;
  difference: Piastres;
  /** Required when difference is not zero. */
  difference_note: string | null;
  /** Membership id. */
  closed_by: string;
  closed_at: Instant;
}

export const AuditAction = {
  Create: "create",
  Update: "update",
  Delete: "delete",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditLog {
  id: string;
  org_id: string;
  actor_membership_id: string;
  entity: string;
  entity_id: string;
  action: AuditAction;
  before: unknown | null;
  after: unknown | null;
  at: Instant;
  /**
   * A strictly monotonic, globally-unique write counter — never two writes
   * ever share a value, unlike `at`, which is millisecond-resolution and can
   * collide between two mutations of the same entity written back to back.
   * Reserved inside the same transaction as the row itself (see db/mutate.ts,
   * the same pattern invoices.number already uses), so it survives a reload
   * and two tabs writing at once, not just same-process ordering. This is
   * what `undoMostRecentMutation` compares to decide "most recent" — never
   * `at` directly.
   */
  seq: number;
}

/**
 * One outbound change, queued for the future sync transport. Added in
 * database version 2, alongside the audited mutation pipeline (see
 * db/mutate.ts). op_id is its own primary key, distinct from entity_id.
 */
export interface SyncOp {
  op_id: string;
  entity: string;
  entity_id: string;
  action: AuditAction;
  payload: unknown;
  device_id: string;
  created_at: Instant;
  synced_at: Instant | null;
}

/**
 * Written by the sync engine when the transport rejects a pushed op — the
 * op itself is never deleted or marked synced, so nothing about the write is
 * lost; this is the record an assistant reviews. Added in database version 6.
 */
export interface SyncReview {
  id: string;
  op_id: string;
  entity: string;
  entity_id: string;
  reason: string;
  payload: unknown;
  needs_review: boolean;
  created_at: Instant;
}

/**
 * This browser's device registration: its stable id and the org+location it
 * serves. Exactly one row per browser — the row's `id` IS the device_id. The
 * single source of truth for these three ids (see db/deviceRegistration.ts's
 * getDeviceBinding), so the eventual Laravel-backed registration is a
 * one-file change. Added in database version 8; the device id moved here from
 * localStorage, which no longer holds device identity.
 */
export interface DeviceRegistration {
  id: string;
  org_id: string;
  location_id: string;
  registered_at: Instant;
}

// Declared now, unused in v1, no screens.

export const SpecialtyTemplateGeneration = {
  None: "none",
  Repeat: "repeat",
  Sequence: "sequence",
  Interval: "interval",
} as const;

export type SpecialtyTemplateGeneration =
  (typeof SpecialtyTemplateGeneration)[keyof typeof SpecialtyTemplateGeneration];

export const SpecialtyTemplatePricingMode = {
  PerItem: "per_item",
  Package: "package",
} as const;

export type SpecialtyTemplatePricingMode =
  (typeof SpecialtyTemplatePricingMode)[keyof typeof SpecialtyTemplatePricingMode];

export interface SpecialtyTemplate {
  id: string;
  /** Null means a system-wide template. */
  org_id: string | null;
  key: string;
  name: string;
  generation: SpecialtyTemplateGeneration;
  default_count: number | null;
  gap_days: number | null;
  resource_type: string | null;
  pricing_mode: SpecialtyTemplatePricingMode;
  stall_days: number | null;
  unit_label: string;
  provider_label: string;
}

export interface FormDefinition {
  id: string;
  template_id: string;
  version: number;
  schema: unknown;
  is_current: boolean;
}

/** Natural key is the composite visit_id + form_definition_id; `id` added as the Dexie primary key. */
export interface VisitFormData {
  id: string;
  visit_id: string;
  form_definition_id: string;
  data: unknown;
}

export interface CarePlan {
  id: string;
  org_id: string;
  location_id: string;
  template_id: string;
  patient_id: string;
  practitioner_id: string;
  goal: string;
  diagnosis: string;
  planned_count: number;
  total_price: Piastres;
  paid: Piastres;
  status: string;
  started_at: Instant;
  expected_end: Instant;
}

export interface CarePlanItem {
  id: string;
  care_plan_id: string;
  service_id: string;
  sequence: number;
  visit_id: string;
  min_gap_days: number;
  depends_on_item_id: string | null;
  price: Piastres;
  status: string;
}
