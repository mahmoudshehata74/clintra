import Dexie, { type EntityTable } from "dexie";
import type {
  AuditLog,
  CarePlan,
  CarePlanItem,
  CashClose,
  DayState,
  DeviceRegistration,
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
  SyncReview,
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
  sync_review!: EntityTable<SyncReview, "id">;
  device!: EntityTable<DeviceRegistration, "id">;

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

    // Adds the review queue the sync engine writes to when the transport
    // rejects a pushed op (see db/mutate.ts's sibling module sync/engine.ts).
    // op_id is not unique here: op_id already identifies its own row in
    // sync_ops, but a rejected op can in principle be reviewed more than
    // once (e.g. retried and rejected again), each as its own row.
    this.version(6).stores({
      sync_review: "id, op_id, needs_review",
    });

    // Invoicing (see db/visitCompletion.ts, db/payments.ts, db/cashClose.ts):
    // - invoices: replaces v1's &[location_id+number] with
    //   &[location_id+issued_year+number], since invoice numbers reset per
    //   calendar year, not just per location (docs/schema.md's v1 Rules
    //   section said "per location" alone — corrected here, see the v7
    //   additions note). visit_id is now indexed (plain, not unique) so a
    //   screen can look up a visit's invoice; location_id is indexed
    //   (plain) for the cash-close and number-reservation queries.
    // - invoice_items: invoice_id is now indexed (plain) so a screen can
    //   list one invoice's items without scanning the whole table.
    // - payments: gains location_id (denormalised from its invoice) and
    //   after_close; invoice_id and location_id are now indexed, and
    //   &[location_id+receipt_number] enforces the per-location receipt
    //   sequence as a real constraint, not just a convention.
    // - cash_close: &[location_id+date] makes the natural key documented
    //   since v1 an actual constraint — it was declared but never enforced.
    this.version(7).stores({
      invoices: "id, location_id, visit_id, &[location_id+issued_year+number]",
      invoice_items: "id, invoice_id",
      payments: "id, invoice_id, location_id, &[location_id+receipt_number]",
      cash_close: "id, &[location_id+date]",
    });

    // Moves the device identity out of localStorage and into the database, so
    // it shares fate with the data it stamps (sync_ops.device_id) and is
    // covered by the persistent-storage grant. One row per browser, keyed by
    // the device_id itself; it also records the org+location this device serves
    // (see db/deviceRegistration.ts). The one-time migration of an existing
    // localStorage id happens in application code, not here, because it needs
    // the seeded org+location to bind to — an upgrade callback runs before the
    // seed. See docs/schema.md's v8 additions.
    this.version(8).stores({
      device: "id",
    });

    // Staff PIN (Layer 2 auth). pin_salt is a value field, not an index — the
    // hash and salt are only ever read by primary key alongside the rest of the
    // membership — so this version's real change is a plain `is_active` index on
    // memberships, used to list the pickable memberships on the lock screen
    // without scanning the table. The salt itself needs no index; it rides on
    // the row. Existing rows carry no salt until re-seeded or a real PIN is set
    // (there are no real PINs deployed yet — pin_hash was a placeholder), so no
    // data upgrade is required. See docs/schema.md's v9 additions.
    this.version(9).stores({
      memberships: "id, is_active",
    });

    // The general visit form (db/visitForm.ts): visit_form_data is looked up
    // both by visit_id alone (the day screen's per-row "has this visit been
    // written up" check) and by the visit_id+form_definition_id natural key
    // (the sheet's own read and the autosave's create-vs-update decision) —
    // so both are real indexes now, not just documented intent.
    this.version(10).stores({
      visit_form_data: "id, visit_id, &[visit_id+form_definition_id]",
    });

    // audit_log.seq: undoMostRecentMutation (db/mutate.ts) used to decide
    // "is this still the most recent mutation of this entity" by comparing
    // `at` timestamps — millisecond resolution, so two mutations of the same
    // entity written back to back (easy to trigger; observed as a genuine,
    // if rare, CI flake) could tie, and the tie broke on IndexedDB's
    // primary-key (UUID) iteration order, not anything meaningful. `seq` is
    // a strictly monotonic counter reserved inside the same transaction as
    // the row itself, the same way invoices.number is reserved — see
    // db/mutate.ts's applyEntityWrite. The upgrade callback backfills every
    // existing row once, ordered by `at` (falling back to `id` only to make
    // the one-time backfill order fully deterministic for rows that already
    // tied on `at` before this fix existed) — good enough for historic rows,
    // since ties among them were already unspecified behaviour; every row
    // written from this version on gets a real, collision-proof seq.
    this.version(11)
      .stores({
        audit_log: "id, &seq",
      })
      .upgrade(async (tx) => {
        const rows = await tx.table("audit_log").toArray();
        rows.sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1));
        await Promise.all(rows.map((row, index) => tx.table("audit_log").update(row.id, { seq: index + 1 })));
      });

    // Row versioning for the sync layer (docs/sync-plan.md's Q5/Q9;
    // api/docs/rls.md's "Sequence-backed audit ordering" sibling on the
    // server side, `enforce_row_rev()`). No index changes — rev is never
    // queried by value, only read and written by primary key alongside the
    // rest of each row — so every change here is upgrade-callback backfill,
    // not a stores() change.
    //
    // Every existing row across the 14 tables the real server tracks (this
    // list must be kept in sync with api/app/Support/Sync/SyncableTables.php's
    // NAMES — there is no way to derive one from the other across the
    // language boundary) gets rev backfilled to 1, not 0. 1 is what the
    // server's own INSERT trigger assigns a brand new row, and every one of
    // these rows predates any real sync ever happening (no server existed
    // before this session), so "as if this row's local state already is
    // that first accepted write" is the closest honest approximation
    // available, and it fails safely if it's ever wrong: a real edit to a
    // row whose true state is otherwise (a) still lands as a clean, single
    // "rejected: conflict_stale_rev" from PushSyncOpsRequest's ordinary
    // path, reviewable and non-destructive — never a whole-batch validation
    // 422, which is what backfilling 0 would risk instead
    // (PushSyncOpsRequest requires base_rev >= 1 for any update/delete).
    // Every row created locally from this version on starts at 1 too (see
    // each db/*.ts write site), for the identical reason: it optimistically
    // matches what the server will assign on its create op's acceptance.
    //
    // sync_ops rows gain base_rev/failure_count/next_retry_at
    // (sync/engine.ts, db/mutate.ts): existing create ops are unaffected
    // (base_rev stays null, exactly what "an insert carries no base_rev"
    // already requires); existing update/delete ops predate base_rev
    // entirely, so null here is the honest "unknown", not a guess — see
    // sync/engine.ts's own doc comment on why it never sends such an op
    // until a fresh edit gives it a real one.
    //
    // device gains pull_cursor, starting null ("never pulled yet") for any
    // already-registered device.
    const REV_BACKFILLED_TABLES = [
      "cash_close",
      "day_state",
      "invoice_items",
      "invoices",
      "membership_locations",
      "membership_practitioners",
      "memberships",
      "patients",
      "payments",
      "schedules",
      "service_price_overrides",
      "services",
      "visit_form_data",
      "visits",
    ] as const;

    this.version(12)
      .stores({})
      .upgrade(async (tx) => {
        await Promise.all(
          REV_BACKFILLED_TABLES.map(async (tableName) => {
            const rows = await tx.table(tableName).toArray();
            await Promise.all(rows.map((row) => tx.table(tableName).update(row.id, { rev: 1 })));
          }),
        );

        const ops = await tx.table("sync_ops").toArray();
        await Promise.all(
          ops.map((op) =>
            tx.table("sync_ops").update(op.op_id, {
              base_rev: op.action === "create" ? null : (op.base_rev ?? null),
              failure_count: 0,
              next_retry_at: null,
            }),
          ),
        );

        const devices = await tx.table("device").toArray();
        await Promise.all(devices.map((device) => tx.table("device").update(device.id, { pull_cursor: null })));
      });

    // Real device registration (docs/auth-plan.md's registration
    // credential resolution; db/registration.ts): every existing device
    // row predates this and was bound the old, seed-based way
    // (db/deviceRegistration.ts's ensureDeviceRegistration fallback), so
    // it has no membership_id and no token — exactly the state that
    // means "not really registered" going forward, which is honest: none
    // of them ever talked to a real server.
    this.version(13)
      .stores({})
      .upgrade(async (tx) => {
        const devices = await tx.table("device").toArray();
        await Promise.all(
          devices.map((device) => tx.table("device").update(device.id, { membership_id: null, token: null })),
        );
      });
  }
}

export const db = new ClintraDatabase();
