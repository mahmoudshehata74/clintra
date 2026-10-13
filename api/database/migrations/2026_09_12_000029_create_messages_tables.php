<?php

use App\Support\Migrations\EnablesRowLevelSecurity;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * messages and message_templates (docs/schema.md's v19 additions). Each
 * table gets every per-table object the prescriptions migration
 * (2026_09_12_000026_create_prescriptions_tables.php) gave its tables, so
 * nothing about them is new in kind: foreign keys that never cascade, a rev
 * column with the shared enforce_row_rev() trigger
 * (2026_09_12_000012_add_row_versioning.php), ENABLE + FORCE RLS and
 * clintra_app's standard grant (EnablesRowLevelSecurity), and one policy
 * with USING and WITH CHECK.
 *
 * - messages: one row per message the app opened WhatsApp or SMS for. The
 *   row is written at that moment (attempted_at) and only marked_sent_at
 *   ever changes afterwards; it is never deleted (SyncOpApplier's message
 *   rule). There is no provider, so there is no delivery status.
 * - message_templates: an organization's edited body for one of the five
 *   editable template keys — an override. The keys themselves, their names
 *   and their default bodies ship with the web app
 *   (web/src/domain/messageTemplates.ts), so a row exists only once the
 *   owner edits a template, and "reset to default" deletes it. "custom" has
 *   no override: it is written per message.
 *
 * phone carries no format CHECK: no existing phone column (patients.phone,
 * users.phone, locations.phone) has one, and the device writes the
 * patient's stored E.164 number; the push endpoint validates its shape.
 *
 * Policies. messages is isolated like invoices — org + allowed locations,
 * no practitioner restriction — because assistants send most messages, for
 * every practitioner at their location. message_templates is isolated like
 * practitioners: org only. Who may edit a template (the owner) is enforced
 * on the device only, the same known gap as every other settings write
 * (api/docs/rls.md's "Messages and message templates").
 *
 * Re-runnable under migrate:fresh: both tables (and so their policies,
 * triggers, checks and grants) are dropped with them, and enforce_row_rev()
 * is recreated by its own migration earlier in the history.
 */
return new class extends Migration
{
    use EnablesRowLevelSecurity;

    /** The invoices policy expression (2026_09_11_170029_enable_rls_policies.php), verbatim. */
    private const MESSAGES_SCOPE = 'org_id = current_org() AND location_id IN (SELECT * FROM allowed_locations())';

    /** The practitioners policy expression (2026_09_11_170029_enable_rls_policies.php), verbatim. */
    private const MESSAGE_TEMPLATES_SCOPE = 'org_id = current_org()';

    /** Every template key a message can be written from (web/src/domain/messageTemplates.ts). */
    private const TEMPLATE_KEYS = [
        'booking_confirmation', 'appointment_reminder', 'post_visit_followup',
        'care_plan_session_reminder', 'balance_reminder', 'custom',
    ];

    /** The keys an organization may override: every key but "custom". */
    private const EDITABLE_TEMPLATE_KEYS = [
        'booking_confirmation', 'appointment_reminder', 'post_visit_followup',
        'care_plan_session_reminder', 'balance_reminder',
    ];

    public function up(): void
    {
        Schema::create('message_templates', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->text('key');
            $table->text('body');
            // Membership id — the acting membership, not the device.
            $table->foreignUuid('updated_by')->constrained('memberships')->restrictOnDelete();
            $table->timestampTz('updated_at');

            $table->unique(['org_id', 'key']);
        });

        Schema::create('messages', function (Blueprint $table) {
            // uuid v4, generated on the client — never by Laravel or Postgres.
            $table->uuid('id')->primary();
            $table->foreignUuid('org_id')->constrained('organizations')->restrictOnDelete();
            $table->foreignUuid('location_id')->constrained('locations')->restrictOnDelete();
            $table->foreignUuid('patient_id')->constrained('patients')->restrictOnDelete();
            $table->foreignUuid('visit_id')->nullable()->constrained('visits')->restrictOnDelete();
            $table->text('template_key');
            $table->text('channel');
            // The patient's E.164 number, as it was when the message was opened.
            $table->text('phone');
            // The rendered text, as it was handed to WhatsApp or SMS.
            $table->text('body');
            // When the app opened WhatsApp or SMS for this message.
            $table->timestampTz('attempted_at');
            // Set by hand ("اتبعتت"); null when not marked.
            $table->timestampTz('marked_sent_at')->nullable();
            // Membership id — the acting membership, not the device.
            $table->foreignUuid('created_by')->constrained('memberships')->restrictOnDelete();
            $table->timestampTz('created_at');

            $table->index('org_id');
            $table->index('location_id');
            $table->index('patient_id');
            $table->index('attempted_at');
        });

        DB::statement('ALTER TABLE message_templates ADD CONSTRAINT message_templates_key_check CHECK (key IN ('.$this->quoted(self::EDITABLE_TEMPLATE_KEYS).'))');
        DB::statement('ALTER TABLE messages ADD CONSTRAINT messages_template_key_check CHECK (template_key IN ('.$this->quoted(self::TEMPLATE_KEYS).'))');
        DB::statement("ALTER TABLE messages ADD CONSTRAINT messages_channel_check CHECK (channel IN ('whatsapp', 'sms'))");

        foreach (['message_templates', 'messages'] as $table) {
            // The same column and trigger every syncable table got in
            // 2026_09_12_000012_add_row_versioning.php.
            DB::statement("ALTER TABLE {$table} ADD COLUMN rev integer NOT NULL DEFAULT 1");
            DB::statement(
                "CREATE TRIGGER {$table}_enforce_rev BEFORE INSERT OR UPDATE ON {$table} ".
                'FOR EACH ROW EXECUTE FUNCTION enforce_row_rev()'
            );

            $this->enableRowLevelSecurity($table);
        }

        $this->policy('message_templates', self::MESSAGE_TEMPLATES_SCOPE);
        $this->policy('messages', self::MESSAGES_SCOPE);
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
        Schema::dropIfExists('message_templates');
    }

    private function policy(string $table, string $expression): void
    {
        DB::statement("CREATE POLICY {$table}_scope ON {$table} USING ({$expression}) WITH CHECK ({$expression})");
    }

    /** @param  list<string>  $values */
    private function quoted(array $values): string
    {
        return implode(', ', array_map(fn (string $value) => "'{$value}'", $values));
    }
};
