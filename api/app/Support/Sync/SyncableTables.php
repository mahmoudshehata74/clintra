<?php

namespace App\Support\Sync;

/**
 * The syncable-table list is exactly the entity strings
 * web/src/db/mutate.ts callers pass to mutate()/applyEntityWrite() today
 * — not the full docs/schema.md v1 table list (see
 * 2026_09_12_000012_add_row_versioning.php's own report for how this was
 * derived and why `users` is deliberately excluded). Every table here
 * already carries a server-assigned `rev` column from that migration.
 */
class SyncableTables
{
    public const NAMES = [
        'cash_close', 'day_state', 'invoice_items', 'invoices',
        'membership_locations', 'membership_practitioners', 'memberships',
        'patients', 'payments', 'schedules', 'service_price_overrides',
        'services', 'visit_form_data', 'visits',
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
    public const DIRECT_ORG_ID_TABLES = ['invoices', 'memberships', 'patients', 'services', 'visits'];

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
        'visits' => 'created_by',
    ];

    /**
     * table => one or more alternative column sets backing a slot-style
     * unique constraint — "two different rows compete for the same key"
     * (docs/sync-plan.md's Q4). `visits` has two, mirroring its two real
     * booking modes (slots vs. queue); everything else here is an edit
     * conflict, detected by `rev` alone, never a natural-key collision.
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
