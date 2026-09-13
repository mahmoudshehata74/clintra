<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A lost or stolen device currently reads the clinic's data forever — no
 * column exists to represent "this device's credential must stop working,"
 * only "the device row is gone" (api/docs/rls.md's "device_exists()"
 * already named this as the anticipated next step). `revoked_at` records
 * *when*, not just a boolean, matching the schema's existing convention
 * (`activation_codes.used_at`) for a one-way state transition worth
 * remembering the moment of.
 *
 * Storage only — no enforcement here. `2026_09_12_000021_device_exists_checks_revoked_at.php`
 * teaches `device_exists()` to treat a revoked device the same as a
 * deleted one; this migration only adds the column. Revoking a device
 * (`php artisan clintra:revoke-device`) needs no new role or function —
 * see `App\Console\Commands\RevokeDevice`'s own doc comment for why this
 * is unlike provisioning/minting/registration's bootstrap doors.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE device ADD COLUMN revoked_at timestamptz NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE device DROP COLUMN IF EXISTS revoked_at');
    }
};
