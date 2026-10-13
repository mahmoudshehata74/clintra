<?php

namespace App\Support\Sync;

/**
 * The syncable-table list is exactly the entity strings
 * web/src/db/mutate.ts callers pass to mutate()/applyEntityWrite() today
 * — not the full docs/schema.md v1 table list (see
 * 2026_09_12_000012_add_row_versioning.php's own report for how this was
 * derived and why `users` is deliberately excluded). Every table here
 * carries a server-assigned `rev` column — from that migration, or, for
 * prescriptions and prescription_items, from the migration that created
 * them (2026_09_12_000026_create_prescriptions_tables.php), and, for
 * practitioners, from 2026_09_12_000027_add_profile_and_rev_to_practitioners.php.
 */
class SyncableTables
{
    public const NAMES = [
        'cash_close', 'day_state', 'invoice_items', 'invoices',
        'membership_locations', 'membership_practitioners', 'memberships',
        'patients', 'payments', 'practitioners', 'prescription_items',
        'prescriptions', 'schedules', 'service_price_overrides', 'services',
        'visit_form_data', 'visits',
    ];

    /**
     * Tables whose payload carries a direct `org_id` column — checked
     * explicitly against current_org() before any write is attempted
     * (docs/sync-plan.md's Q12: "reject an op whose payload names a
     * different org rather than silently substituting"). Tables not
     * listed here have no direct org_id in their payload at all; a
     * cross-org attempt against one of those is instead caught by RLS's
     * own WITH CHECK policy (transitively, via location_id/practitioner_id/
     * etc.) and surfaces as a generic `failed` — see
     * SyncPushController::isRlsRefusal().
     */
    public const DIRECT_ORG_ID_TABLES = ['invoices', 'memberships', 'patients', 'practitioners', 'prescriptions', 'services', 'visits'];

    /**
     * table => the payload column naming the acting membership. Always
     * server-overridden with the token-resolved membership, never trusted
     * from the payload — the same principle audit_log.actor_membership_id
     * already enforces (docs/sync-plan.md's Q12/Q13), extended to every
     * other "who did this" column in the schema.
     */
    public const ACTOR_COLUMNS = [
        'cash_close' => 'closed_by',
        'payments' => 'created_by',
        'prescriptions' => 'created_by',
        'visits' => 'created_by',
    ];

    /**
     * table => one or more alternative column sets backing a slot-style
     * unique constraint — "two different rows compete for the same key"
     * (docs/sync-plan.md's Q4). `visits` has two, mirroring its two real
     * booking modes (slots vs. queue). Every other table's edits are
     * detected by `rev` alone; invoices', payments' and prescriptions' own
     * natural key (their number within a device's series) is not a slot two
     * devices compete for — see NUMBER_CONSTRAINTS below.
     *
     * @var array<string, list<list<string>>>
     */
    public const SLOT_CONSTRAINTS = [
        'day_state' => [
            ['practitioner_id', 'location_id', 'date'],
        ],
        'visits' => [
            ['practitioner_id', 'visit_date', 'position'],
            ['practitioner_id', 'visit_date', 'unique_scheduled_at'],
        ],
    ];

    /**
     * table => the columns that make up a row's printed number. These are
     * minted on the device inside its own number series (device.series —
     * docs/schema.md's v16 additions) and never change once written: an
     * update touching any of them is rejected as `number_immutable`.
     *
     * @var array<string, list<string>>
     */
    public const NUMBER_COLUMNS = [
        'invoices' => ['series', 'number', 'issued_year'],
        'payments' => ['series', 'receipt_number'],
        'prescriptions' => ['series', 'number', 'issued_year'],
    ];

    /**
     * table => the unique constraint backing that number
     * (2026_09_12_000024_add_device_number_series.php,
     * 2026_09_12_000026_create_prescriptions_tables.php). A violation of it
     * is `conflict_number_taken`, never `conflict_already_exists` — the
     * row it collided with is a different entity.
     *
     * @var array<string, string>
     */
    public const NUMBER_CONSTRAINTS = [
        'invoices' => 'invoices_location_id_issued_year_series_number_unique',
        'payments' => 'payments_location_id_series_receipt_number_unique',
        'prescriptions' => 'prescriptions_location_id_issued_year_series_number_unique',
    ];

    /**
     * table => [unique constraint => rejection reason] for a table's other
     * one-row-per-parent rules. A create that violates one collided with a
     * *different* entity holding the same parent, so it gets its own
     * reason, never conflict_already_exists (which means "this entity_id
     * already has a row").
     *
     * @var array<string, array<string, string>>
     */
    public const PARENT_UNIQUE_CONSTRAINTS = [
        'prescriptions' => ['prescriptions_visit_id_unique' => 'conflict_visit_has_prescription'],
    ];

    /**
     * child table => [its parent table, the child's column naming the
     * parent]: a child row may not be created, updated or deleted once its
     * parent is printed (SyncOpApplier's printed lock, docs/schema.md's
     * v17 additions).
     *
     * @var array<string, array{0: string, 1: string}>
     */
    public const PRINTED_LOCK_CHILDREN = [
        'prescription_items' => ['prescriptions', 'prescription_id'],
    ];

    /** Tables whose rows are locked once their own printed_at is set. */
    public const PRINTED_LOCK_TABLES = ['prescriptions'];

    /**
     * table => the only columns a pushed update may change. Rows of these
     * tables are created only by provisioning, never pushed: a create or a
     * delete is refused, and so is an update whose payload names any other
     * column with a value different from the stored one
     * (`practitioner_not_editable` — SyncOpApplier's profile rule,
     * docs/schema.md's v18 additions).
     *
     * @var array<string, list<string>>
     */
    public const PROFILE_ONLY_COLUMNS = [
        'practitioners' => ['full_name', 'title', 'syndicate_number'],
    ];

    public static function hasNumberSeries(string $table): bool
    {
        return array_key_exists($table, self::NUMBER_COLUMNS);
    }

    public static function isSlotTable(string $table): bool
    {
        return array_key_exists($table, self::SLOT_CONSTRAINTS);
    }

    public static function hasDirectOrgId(string $table): bool
    {
        return in_array($table, self::DIRECT_ORG_ID_TABLES, true);
    }

    public static function actorColumn(string $table): ?string
    {
        return self::ACTOR_COLUMNS[$table] ?? null;
    }
}
