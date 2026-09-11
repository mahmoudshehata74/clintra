<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Laravel's default scaffold also created `users` and `password_reset_tokens`
// here. Clintra's own `users` table (uuid pk, full_name/phone/email/is_active
// — see docs/schema.md) is a different shape and lives in its own migration
// in normal domain order. Clintra has no password-based login (device + PIN
// per membership, see the CLI brief), so password_reset_tokens never applies
// and is dropped rather than carried forward unused. `sessions` is kept:
// the default 'web' middleware group still starts a session on every
// web-group request.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });

        $this->grantAppAccessWithoutRls('sessions');
    }

    public function down(): void
    {
        Schema::dropIfExists('sessions');
    }
};
