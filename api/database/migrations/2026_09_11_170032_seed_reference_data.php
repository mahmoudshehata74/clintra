<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Seeds contract/reference-data.json's system-wide reference rows — today
 * the single "general" specialty_templates row and its current
 * form_definitions row (see contract/README.md). Runs as clintra_owner,
 * like every migration (php artisan migrate --database=pgsql_owner sets
 * that as the default connection for the whole command, same as every
 * other migration in this schema) — through the owner-only policies added
 * in 2026_09_11_170031_add_owner_reference_data_policies.php. No
 * BYPASSRLS, no SET ROLE clintra_rls, no new grant to clintra_app.
 *
 * Upserts by id (ON CONFLICT ... DO UPDATE), so this is idempotent: safe
 * to run again after contract/reference-data.json changes (updates the
 * existing row in place), and safe across migrate:fresh.
 */
return new class extends Migration
{
    public function up(): void
    {
        $data = self::referenceData();

        foreach ($data['specialty_templates'] as $template) {
            DB::table('specialty_templates')->upsert(
                [[
                    'id' => $template['id'],
                    'org_id' => $template['org_id'],
                    'key' => $template['key'],
                    'name' => $template['name'],
                    'generation' => $template['generation'],
                    'default_count' => $template['default_count'],
                    'gap_days' => $template['gap_days'],
                    'resource_type' => $template['resource_type'],
                    'pricing_mode' => $template['pricing_mode'],
                    'stall_days' => $template['stall_days'],
                    'unit_label' => $template['unit_label'],
                    'provider_label' => $template['provider_label'],
                ]],
                uniqueBy: ['id'],
                update: [
                    'org_id', 'key', 'name', 'generation', 'default_count',
                    'gap_days', 'resource_type', 'pricing_mode', 'stall_days',
                    'unit_label', 'provider_label',
                ],
            );
        }

        foreach ($data['form_definitions'] as $definition) {
            DB::table('form_definitions')->upsert(
                [[
                    'id' => $definition['id'],
                    'template_id' => $definition['template_id'],
                    'version' => $definition['version'],
                    'is_current' => $definition['is_current'],
                    'schema' => json_encode($definition['schema']),
                ]],
                uniqueBy: ['id'],
                update: ['template_id', 'version', 'is_current', 'schema'],
            );
        }
    }

    public function down(): void
    {
        $data = self::referenceData();

        DB::table('form_definitions')->whereIn('id', array_column($data['form_definitions'], 'id'))->delete();
        DB::table('specialty_templates')->whereIn('id', array_column($data['specialty_templates'], 'id'))->delete();
    }

    /** @return array{specialty_templates: list<array<string, mixed>>, form_definitions: list<array<string, mixed>>} */
    private static function referenceData(): array
    {
        return json_decode(
            file_get_contents(base_path('../contract/reference-data.json')),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );
    }
};
