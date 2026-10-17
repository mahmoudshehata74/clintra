import Dexie, { type EntityTable } from "dexie";
import { numberMarkKey } from "./deviceRegistration";
import type {
  AuditLog,
  RemoteAuditLog,
  CarePlan,
  CarePlanItem,
  CashClose,
  DayState,
  DevicePreference,
  DeviceRegistration,
  FormDefinition,
  Invoice,
  InvoiceItem,
  Location,
  Membership,
  MembershipLocation,
  Message,
  MessageTemplate,
  MembershipPractitioner,
  Organization,
  Patient,
  Payment,
  Practitioner,
  PractitionerLocation,
  Prescription,
  PrescriptionItem,
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
import { dropStrandedStaffOps } from "./staffOpsRecovery";

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
  remote_audit_log!: EntityTable<RemoteAuditLog, "id">;
  specialty_templates!: EntityTable<SpecialtyTemplate, "id">;
  form_definitions!: EntityTable<FormDefinition, "id">;
  visit_form_data!: EntityTable<VisitFormData, "id">;
  care_plans!: EntityTable<CarePlan, "id">;
  care_plan_items!: EntityTable<CarePlanItem, "id">;
  prescriptions!: EntityTable<Prescription, "id">;
  prescription_items!: EntityTable<PrescriptionItem, "id">;
  messages!: EntityTable<Message, "id">;
  message_templates!: EntityTable<MessageTemplate, "id">;
  sync_ops!: EntityTable<SyncOp, "op_id">;
  sync_review!: EntityTable<SyncReview, "id">;
  device!: EntityTable<DeviceRegistration, "id">;
  preferences!: EntityTable<DevicePreference, "key">;

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

    // visits.note (db/visitNote.ts; the server's
    // 2026_09_12_000023_add_note_to_visits_table.php): the doctor's quick
    // note on one visit. No index — a note is only ever read and written by
    // primary key alongside the rest of its visit, never queried by value —
    // so this is backfill only, not a stores() change: every existing visit
    // without a note field gets note: null, so a row's shape matches Visit
    // regardless of when it was written. A row that already carries one is
    // left alone: pulled rows are stored whole (sync/engine.ts), so a device
    // that synced against an already-migrated server before upgrading can
    // hold a real note this must not wipe.
    this.version(14)
      .stores({})
      .upgrade(async (tx) => {
        const visits = await tx.table("visits").toArray();
        await Promise.all(
          visits
            .filter((visit) => visit.note === undefined)
            .map((visit) => tx.table("visits").update(visit.id, { note: null })),
        );
      });

    // Per-device number series (docs/schema.md's v16 additions; the server's
    // 2026_09_12_000024_add_device_number_series.php): every device mints
    // invoice and receipt numbers only inside its own series, so the unique
    // indexes gain `series` — [location_id+issued_year+series+number] and
    // [location_id+series+receipt_number]. Existing data stays unique under
    // them: every row written before this version gets series 1 below, and
    // rows that were unique on the old key are still unique once the same
    // value, 1, is added to every one of them.
    //
    // - invoices, payments: series = 1 on every existing row — the same
    //   value the server's own migration gives every row it already holds.
    //   An unsent invoice/payment op's payload is the row as it was written,
    //   so it gets the same series = 1, keeping the op and its row in step.
    // - device: series stays null — the server has not said what this
    //   device's series is yet, and minting refuses until it does
    //   (sync/engine.ts records it from the next pull or bootstrap). The one
    //   exception is the seed/demo device (no token: bound by
    //   db/deviceRegistration.ts's fallback, never talks to a server), which
    //   is series 1, as that fallback writes it from now on.
    this.version(15)
      .stores({
        invoices: "id, location_id, visit_id, &[location_id+issued_year+series+number]",
        payments: "id, invoice_id, location_id, &[location_id+series+receipt_number]",
      })
      .upgrade(async (tx) => {
        for (const tableName of ["invoices", "payments"] as const) {
          const rows = await tx.table(tableName).toArray();
          await Promise.all(rows.map((row) => tx.table(tableName).update(row.id, { series: 1 })));
        }

        const ops = await tx.table("sync_ops").toArray();
        await Promise.all(
          ops
            .filter(
              (op) =>
                (op.entity === "invoices" || op.entity === "payments") &&
                op.synced_at === null &&
                op.payload !== null &&
                op.payload.series === undefined,
            )
            .map((op) => tx.table("sync_ops").update(op.op_id, { payload: { ...op.payload, series: 1 } })),
        );

        const devices = await tx.table("device").toArray();
        await Promise.all(
          devices.map((device) => tx.table("device").update(device.id, { series: device.token === null ? 1 : null })),
        );
      });

    // Prescriptions (db/prescriptions.ts; the server's
    // 2026_09_12_000026_create_prescriptions_tables.php; docs/schema.md's v17
    // additions). Two new stores, so nothing to backfill:
    // - prescriptions:
    //   - &visit_id: at most one prescription per visit, enforced by the
    //     database itself, and the lookup the writer uses to find a visit's
    //     prescription before deciding whether to create one.
    //   - location_id: the number-minting read (the current max number for
    //     this location, year and series), as invoices' location_id index.
    //   - patient_id: a patient's prescriptions across visits (the patient
    //     profile) without a table scan.
    //   - &[location_id+issued_year+series+number]: the printed number,
    //     unique within its device series — the same key invoices carry.
    // - prescription_items:
    //   - prescription_id: one prescription's items, as invoice_items'
    //     invoice_id index.
    this.version(16).stores({
      prescriptions: "id, &visit_id, location_id, patient_id, &[location_id+issued_year+series+number]",
      prescription_items: "id, prescription_id",
    });

    // Practitioners sync, with name, title and syndicate number editable
    // (db/practitioners.ts; the server's
    // 2026_09_12_000027_add_profile_and_rev_to_practitioners.php;
    // docs/schema.md's v18 additions). No index — both new fields are only
    // ever read and written by primary key with the rest of the row — so
    // this is backfill only:
    // - syndicate_number: null ("none on record") on every row without one.
    // - rev: 1, by version 12's convention — 1 is what the server's trigger
    //   gives a new row and what its own migration gave every existing
    //   practitioner (DEFAULT 1), so a practitioner never edited on the
    //   server matches exactly; one that was fails safely, as a single
    //   reviewable conflict_stale_rev, never a 422 (base_rev must be >= 1).
    // A row that already carries either field (pulled whole from an
    // already-migrated server, sync/engine.ts) is left as it is.
    this.version(17)
      .stores({})
      .upgrade(async (tx) => {
        const practitioners = await tx.table("practitioners").toArray();
        await Promise.all(
          practitioners.map((practitioner) =>
            tx.table("practitioners").update(practitioner.id, {
              syndicate_number: practitioner.syndicate_number === undefined ? null : practitioner.syndicate_number,
              rev: practitioner.rev === undefined ? 1 : practitioner.rev,
            }),
          ),
        );
      });

    // Messages and template overrides (db/messages.ts; the server's
    // 2026_09_12_000029_create_messages_tables.php; docs/schema.md's v19
    // additions). Two new stores, so nothing to backfill:
    // - messages:
    //   - patient_id: one patient's messages (the patient profile, and the
    //     messages screen's per-patient history) without a table scan.
    //   - location_id: the messages sent from this location, as invoices'
    //     location_id index.
    //   - attempted_at: the newest messages first ("آخر الرسائل المرسلة").
    // - message_templates:
    //   - &key: at most one override per template key, enforced by the
    //     database itself, and the lookup effectiveBody needs. Unique on the
    //     key alone, not [org_id+key] as on the server, because a device
    //     serves exactly one organization (DeviceRegistration.org_id), so
    //     within one local database the key already identifies the row.
    this.version(18).stores({
      messages: "id, patient_id, location_id, attempted_at",
      message_templates: "id, &key",
    });

    // Number high-water marks (DeviceRegistration.number_marks;
    // db/deviceRegistration.ts's reserveNextNumber): a number minted on this
    // device stays reserved after its row is displaced by a pulled row
    // (sync/pullCollisions.ts). No index — the marks live on the one device
    // row. Initialised from the numbers already in the local store, per
    // numberMarkKey, so the first mint after the upgrade continues exactly
    // where the local max would have.
    this.version(19)
      .stores({})
      .upgrade(async (tx) => {
        const marks: Record<string, number> = {};
        const raise = (key: string, value: number) => {
          marks[key] = Math.max(marks[key] ?? 0, value);
        };
        for (const invoice of await tx.table("invoices").toArray()) {
          raise(numberMarkKey("invoice", invoice.location_id, invoice.series, invoice.issued_year), invoice.number);
        }
        for (const prescription of await tx.table("prescriptions").toArray()) {
          raise(
            numberMarkKey("prescription", prescription.location_id, prescription.series, prescription.issued_year),
            prescription.number,
          );
        }
        for (const payment of await tx.table("payments").toArray()) {
          raise(numberMarkKey("receipt", payment.location_id, payment.series, null), Number(payment.receipt_number));
        }
        const devices = await tx.table("device").toArray();
        await Promise.all(devices.map((device) => tx.table("device").update(device.id, { number_marks: marks })));
      });

    // Care plans (db/carePlans.ts; the server's
    // 2026_09_12_000030_make_care_plans_syncable.php; docs/schema.md's v20
    // additions). Both stores existed since version 1 with no index and no
    // writer, so they are empty: nothing to backfill.
    // - care_plans:
    //   - patient_id: a patient's plans (the visit workspace's plan badge and
    //     the patient profile) without a table scan.
    //   - practitioner_id: a practitioner's plans, e.g. the stalled ones.
    // - care_plan_items:
    //   - care_plan_id: one plan's sessions, as prescription_items'
    //     prescription_id index.
    //   - visit_id: the session a visit books — what booking, moving,
    //     cancelling and completing a visit look up. Plain, not unique: the
    //     server has no unique key on it either, so a pulled row can never
    //     collide with a local one (docs/sync-plan.md's "Local unique
    //     collisions on pull"), and most sessions carry null.
    this.version(20).stores({
      care_plans: "id, patient_id, practitioner_id",
      care_plan_items: "id, care_plan_id, visit_id",
    });

    // Staff identity (docs/schema.md's v21 additions): memberships gain
    // display_name, not indexed, so no store changes — a row stored before
    // it reads as the user's full_name (domain/staffName.ts), with no
    // backfill. Adding staff now happens on the server, and the device no
    // longer writes users rows; this upgrade unsticks a device whose queue
    // still holds such a write (db/staffOpsRecovery.ts).
    this.version(21)
      .stores({})
      .upgrade(async (tx) => {
        await dropStrandedStaffOps(tx.table("sync_ops"));
      });

    // This device's own settings (db/preferences.ts): the appearance
    // (auto/light/dark) today. A store of its own rather than a field on the
    // device row: it is needed whether or not the device is registered, and
    // registration replaces that row whole (db/registration.ts). Local-only
    // — not in SYNCABLE_TABLES, written without mutate(), so no sync op and
    // no audit row.
    this.version(22).stores({
      preferences: "key",
    });

    // Audit rows from the organization's other devices (docs/audit-sync.md):
    // a store of their own, so audit_log keeps only this device's rows and
    // its dense seq. `at` serves the audit sheet's today range and the
    // 60-day retention; [entity+entity_id] the invoice's creator line. The
    // device row's two new fields (audit_pushed_seq, audit_pull_cursor) read
    // as 0 and null while absent, so no backfill runs: every existing local
    // row is pushed from seq 0.
    this.version(23).stores({
      remote_audit_log: "id, at, [entity+entity_id]",
    });
  }
}

export const db = new ClintraDatabase();
