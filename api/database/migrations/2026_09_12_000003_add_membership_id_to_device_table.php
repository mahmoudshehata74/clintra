<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's v10 additions: device.membership_id. Not nullable —
// device is empty in every environment this runs against (no registration
// flow existed before this), and every device from here on is created only
// through register_device(jsonb), which always sets it.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('device', function (Blueprint $table) {
            $table->foreignUuid('membership_id')->after('location_id')->constrained('memberships')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('device', function (Blueprint $table) {
            $table->dropConstrainedForeignId('membership_id');
        });
    }
};
