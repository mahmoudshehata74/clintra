<?php

namespace Tests\Support;

use Closure;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fixture helpers for tests/Feature/Rls. Fixtures are inserted through the
 * clintra_fixtures connection (BYPASSRLS) — neither clintra_app (RLS via
 * ENABLE) nor clintra_owner (RLS via FORCE) can insert an organization
 * before any membership exists to grant RLS scope. Every assertion in the
 * tests that use this trait must still go through asApp()/asOwner(), never
 * fx() — see api/docs/rls.md.
 */
trait RlsFixtures
{
    /** @var array<string, list<string>> */
    private array $fixtureIds = [];

    private const CLEANUP_ORDER = [
        'audit_log',
        'visits',
        'membership_locations',
        'membership_practitioners',
        'activation_codes',
        'device',
        'memberships',
        'practitioners',
        'patients',
        'locations',
        'form_definitions',
        'specialty_templates',
        'users',
        'organizations',
    ];

    protected function fx(): Connection
    {
        return DB::connection('pgsql_fixtures');
    }

    protected function asApp(): Connection
    {
        return DB::connection('pgsql');
    }

    protected function asOwner(): Connection
    {
        return DB::connection('pgsql_owner');
    }

    /**
     * Runs $callback inside a transaction on $connection with
     * app.membership_id declared via set_config(..., true) — the same
     * mechanism App\Support\DatabaseSession uses, scoped to whichever
     * connection is passed so tests can target pgsql or pgsql_owner
     * independently of the app's own default connection.
     */
    protected function withMembership(Connection $connection, ?string $membershipId, Closure $callback): mixed
    {
        return $connection->transaction(function () use ($connection, $membershipId, $callback) {
            if ($membershipId !== null) {
                $connection->select("select set_config('app.membership_id', ?, true)", [$membershipId]);
            }

            return $callback($connection);
        });
    }

    protected function cleanupFixtures(): void
    {
        foreach (self::CLEANUP_ORDER as $table) {
            $ids = $this->fixtureIds[$table] ?? [];

            if ($ids !== []) {
                $this->fx()->table($table)->whereIn('id', $ids)->delete();
            }
        }

        $this->fixtureIds = [];
    }

    private function track(string $table, string $id): string
    {
        $this->fixtureIds[$table][] = $id;

        return $id;
    }

    /**
     * A bare DateTimeInterface passed to insert()/update() gets formatted
     * by Laravel's query grammar as a naive "Y-m-d H:i:s" string with no
     * offset — fine when the app's timezone (config('app.timezone'),
     * Africa/Cairo) happens to match Postgres's session timezone, wrong
     * whenever it doesn't (confirmed in CI: a fresh postgres:16 container
     * defaults to UTC, so an "expired 1 minute ago" fixture landed hours
     * in the future and the expiry test passed locally but failed in CI —
     * see api/docs/rls.md). Every make*() below that writes a
     * timestamptz column runs its attributes through this first.
     * `visit_date` (a plain date, not a timestamp) is deliberately exempt
     * — see makeVisit()'s own comment.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function normalizeTimestamps(array $attributes): array
    {
        foreach ($attributes as $key => $value) {
            if ($value instanceof \DateTimeInterface) {
                $attributes[$key] = $value->toIso8601String();
            }
        }

        return $attributes;
    }

    protected function makeOrganization(string $name = 'org', string $planTier = 'small'): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('organizations')->insert($this->normalizeTimestamps([
            'id' => $id,
            'name' => $name,
            'plan_tier' => $planTier,
            'created_at' => now(),
        ]));

        return $this->track('organizations', $id);
    }

    protected function makeLocation(string $orgId, string $name = 'loc', bool $isActive = true): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('locations')->insert([
            'id' => $id,
            'org_id' => $orgId,
            'name' => $name,
            'address' => 'addr',
            'phone' => '01'.random_int(100000000, 999999999),
            'is_active' => $isActive,
        ]);

        return $this->track('locations', $id);
    }

    protected function makeUser(string $fullName = 'user'): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('users')->insert([
            'id' => $id,
            'full_name' => $fullName,
            'phone' => '02'.Str::lower(Str::random(9)),
            'is_active' => true,
        ]);

        return $this->track('users', $id);
    }

    /**
     * Null $orgId mirrors real v1 usage (docs/schema.md: every practitioner
     * points at the single system-wide "general" row) — deliberately NOT
     * scoped to a fixture org, since that is the actual production shape.
     */
    protected function makeSpecialtyTemplate(?string $orgId, string $key = 'general'): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('specialty_templates')->insert([
            'id' => $id,
            'org_id' => $orgId,
            'key' => $key,
            'name' => 'General',
            'generation' => 'none',
            'pricing_mode' => 'per_item',
            'unit_label' => 'unit',
            'provider_label' => 'provider',
        ]);

        return $this->track('specialty_templates', $id);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    protected function makeFormDefinition(string $templateId, array $overrides = []): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('form_definitions')->insert(array_merge([
            'id' => $id,
            'template_id' => $templateId,
            'version' => 1,
            'schema' => json_encode(['fields' => []]),
            'is_current' => true,
        ], $overrides));

        return $this->track('form_definitions', $id);
    }

    protected function makePractitioner(string $orgId, string $specialtyId, string $fullName = 'practitioner'): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('practitioners')->insert([
            'id' => $id,
            'org_id' => $orgId,
            'user_id' => null,
            'full_name' => $fullName,
            'specialty_id' => $specialtyId,
            'title' => 'Dr.',
            'is_active' => true,
        ]);

        return $this->track('practitioners', $id);
    }

    /**
     * @param  array{role?:string,location_scope?:string,practitioner_scope?:string,practitioner_id?:?string,is_active?:bool}  $overrides
     */
    protected function makeMembership(string $userId, string $orgId, array $overrides = []): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('memberships')->insert(array_merge([
            'id' => $id,
            'user_id' => $userId,
            'org_id' => $orgId,
            'role' => 'assistant',
            'location_scope' => 'all',
            'practitioner_scope' => 'all',
            'practitioner_id' => null,
            'pin_hash' => 'test-hash',
            'pin_salt' => 'test-salt',
            'is_active' => true,
        ], $overrides));

        return $this->track('memberships', $id);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    protected function makeActivationCode(string $orgId, string $locationId, string $plainCode, array $overrides = []): string
    {
        $id = (string) Str::uuid();

        $attributes = $this->normalizeTimestamps(array_merge([
            'id' => $id,
            'org_id' => $orgId,
            'location_id' => $locationId,
            'code_hash' => hash('sha256', $plainCode),
            'expires_at' => now()->addHours(72),
            'used_at' => null,
            'used_by_device_id' => null,
            'created_at' => now(),
        ], $overrides));

        $this->fx()->table('activation_codes')->insert($attributes);

        return $this->track('activation_codes', $id);
    }

    protected function makeDevice(string $orgId, string $locationId, string $membershipId, ?string $id = null): string
    {
        $id ??= (string) Str::uuid();

        $this->fx()->table('device')->insert($this->normalizeTimestamps([
            'id' => $id,
            'org_id' => $orgId,
            'location_id' => $locationId,
            'membership_id' => $membershipId,
            'registered_at' => now(),
        ]));

        return $this->track('device', $id);
    }

    protected function makeMembershipLocation(string $membershipId, string $locationId): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('membership_locations')->insert([
            'id' => $id,
            'membership_id' => $membershipId,
            'location_id' => $locationId,
        ]);

        return $this->track('membership_locations', $id);
    }

    protected function makePatient(string $orgId, string $fullName = 'patient'): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('patients')->insert($this->normalizeTimestamps([
            'id' => $id,
            'org_id' => $orgId,
            'full_name' => $fullName,
            'created_at' => now(),
        ]));

        return $this->track('patients', $id);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    protected function makeVisit(string $orgId, string $locationId, string $practitionerId, string $patientId, string $createdBy, array $overrides = []): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('visits')->insert($this->normalizeTimestamps(array_merge([
            'id' => $id,
            'org_id' => $orgId,
            'location_id' => $locationId,
            'practitioner_id' => $practitionerId,
            'patient_id' => $patientId,
            // A plain date string already, not a DateTimeInterface — exempt
            // from normalizeTimestamps() by construction, and correctly so:
            // "today" here means the Cairo calendar date (docs/schema.md's
            // "day is a YYYY-MM-DD string in Africa/Cairo" convention), which
            // is exactly what the app-timezone-based now() already gives.
            'visit_date' => now()->toDateString(),
            'position' => 1,
            'status' => 'booked',
            'is_overbooked' => false,
            'source' => 'walkin',
            'created_by' => $createdBy,
            'created_at' => now(),
        ], $overrides)));

        return $this->track('visits', $id);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    protected function makeAuditLog(string $orgId, string $actorMembershipId, array $overrides = []): string
    {
        $id = (string) Str::uuid();

        $this->fx()->table('audit_log')->insert($this->normalizeTimestamps(array_merge([
            'id' => $id,
            'org_id' => $orgId,
            'actor_membership_id' => $actorMembershipId,
            'entity' => 'patients',
            'entity_id' => (string) Str::uuid(),
            'action' => 'create',
            'at' => now(),
            'seq' => random_int(1, PHP_INT_MAX),
        ], $overrides)));

        return $this->track('audit_log', $id);
    }

    /**
     * Every table in the public schema that carries an RLS policy — i.e.
     * every table except Laravel's own infrastructure tables. Shared by the
     * structural test and the no-membership test so both walk the same list.
     *
     * @return list<string>
     */
    protected function rlsTableNames(): array
    {
        $allowlist = self::laravelInfrastructureTables();

        $rows = $this->asApp()->select(<<<'SQL'
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            ORDER BY c.relname
        SQL);

        return collect($rows)
            ->pluck('relname')
            ->reject(fn (string $name) => in_array($name, $allowlist, true))
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    protected static function laravelInfrastructureTables(): array
    {
        return [
            'migrations', 'sessions', 'cache', 'cache_locks', 'jobs',
            'job_batches', 'failed_jobs', 'personal_access_tokens',
        ];
    }
}
