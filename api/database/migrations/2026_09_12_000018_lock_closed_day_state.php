<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The brief never says whether a closed day is immutable — checked
 * directly (`grep -n -i "clos"` across the whole document; it only ever
 * mentions "day close" as a screen/feature, never a state's durability).
 * This is therefore a standing decision this migration makes, not a
 * brief requirement: once `day_state.is_closed` is true, that row can
 * never be modified or deleted, by anyone, through any connection.
 *
 * Enforced with a trigger, not an RLS policy — chosen over a policy whose
 * `USING` excludes closed rows because a trigger is the strictly tighter
 * guarantee. An RLS policy only ever binds `clintra_app` (RLS via
 * `ENABLE`) and `clintra_owner` (RLS via `FORCE`); `clintra_fixtures` and
 * any future `BYPASSRLS` role would sail straight through it, the same
 * gap `enforce_row_rev()` (2026_09_12_000012_add_row_versioning.php) was
 * built to close for `rev` itself. A trigger fires for every role
 * unconditionally, RLS-bound or not.
 *
 * Only blocks `UPDATE`/`DELETE` where the row's *current* (`OLD`) state is
 * already closed — the transition that actually closes a day (`OLD.is_closed
 * = false` -> `NEW.is_closed = true`) is untouched. Confirmed before this
 * landed: no screen in `web/src/` ever sets `day_state.is_closed` to
 * `true` at all today (day-close, screen 13, writes a separate
 * `cash_close` row entirely) — this constraint introduces no product
 * conflict with anything currently shipped, since nothing closes a day
 * through this field yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE FUNCTION prevent_closed_day_state_mutation() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD.is_closed THEN
                    RAISE EXCEPTION 'day_state: a closed day cannot be modified or deleted' USING ERRCODE = '55000';
                END IF;
                RETURN COALESCE(NEW, OLD);
            END;
            $$
        SQL);

        DB::statement(
            'CREATE TRIGGER day_state_immutable_when_closed BEFORE UPDATE OR DELETE ON day_state '.
            'FOR EACH ROW EXECUTE FUNCTION prevent_closed_day_state_mutation()'
        );
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS day_state_immutable_when_closed ON day_state');
        DB::statement('DROP FUNCTION IF EXISTS prevent_closed_day_state_mutation()');
    }
};
