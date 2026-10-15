<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The name an organization uses for one of its staff (docs/schema.md's v21
 * additions). It lives on the membership, not on users: one users row can
 * sit behind memberships in several organizations, so no single one of them
 * may rename it. Renaming staff edits this column through the ordinary
 * memberships sync.
 *
 * Nullable, with no backfill: a null display_name reads as the user's
 * full_name everywhere a staff name is shown, so every existing membership
 * keeps the name it shows today. memberships' policy is unchanged — the
 * column is covered by the existing row-level rule (org_id = current_org()).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE memberships ADD COLUMN display_name varchar(120) NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE memberships DROP COLUMN IF EXISTS display_name');
    }
};
