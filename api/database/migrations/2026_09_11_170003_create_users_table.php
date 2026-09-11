<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// See docs/schema.md's users table and its v4 additions note: users has no
// org_id of its own (a user's organizations are its memberships), and phone
// is globally unique — not per organization, unlike patients.phone.
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->string('full_name');
            $table->string('phone')->unique();
            $table->string('email')->nullable();
            $table->boolean('is_active');
        });

        $this->enableRowLevelSecurity('users');
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
