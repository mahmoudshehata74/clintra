<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * device_audit_log (docs/audit-sync.md, docs/schema.md's v22 additions):
 * 2026_09_12_000034_create_device_audit_log_table.php — the table, its
 * policies and its grants, read and written directly. The push and pull
 * endpoints are covered by DeviceAuditSyncTest.php.
 */

/** A row for a direct insert through clintra_app, in the shape the push endpoint writes. */
function deviceAuditInsert(array $credential, array $overrides = []): array
{
    return array_merge([
        'id' => (string) Str::uuid(),
        'org_id' => $credential['orgId'],
        'location_id' => null,
        'practitioner_id' => null,
        'actor_membership_id' => $credential['membershipId'],
        'pushed_by_membership_id' => $credential['membershipId'],
        'device_id' => $credential['deviceId'],
        'entity' => 'patients',
        'entity_id' => (string) Str::uuid(),
        'action' => 'create',
        'before' => null,
        'after' => json_encode(['full_name' => 'مريض']),
        'at' => now()->toIso8601String(),
    ], $overrides);
}

/** Inserts as clintra_app under the credential's membership; returns the SQLSTATE of a refusal, or null. */
function insertDeviceAuditAsApp(array $credential, array $row): ?string
{
    try {
        test()->withMembership(test()->asApp(), $credential['membershipId'], fn ($db) => $db->table('device_audit_log')->insert($row));
    } catch (QueryException $e) {
        return $e->getCode();
    }
    test()->fx()->table('device_audit_log')->where('id', $row['id'])->exists() && trackDeviceAudit($row['id']);

    return null;
}

/** Tracks a row a test inserted through clintra_app, so cleanup removes it. */
function trackDeviceAudit(string $id): bool
{
    (fn () => $this->track('device_audit_log', $id))->call(test());

    return true;
}

/** @return list<string> the ids clintra_app sees under the membership */
function deviceAuditIdsSeenBy(string $membershipId): array
{
    return test()->withMembership(test()->asApp(), $membershipId, fn ($db) => $db->table('device_audit_log')->pluck('id')->all());
}

// --- Structure ---------------------------------------------------------------

test('the table is forced under RLS and clintra_app holds SELECT and INSERT only', function () {
    $flags = $this->fx()->selectOne("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'device_audit_log'");
    expect([$flags->relrowsecurity, $flags->relforcerowsecurity])->toBe([true, true]);

    $grants = fn (string $role) => collect($this->asOwner()->select(
        "SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name = 'device_audit_log' AND grantee = ? ORDER BY privilege_type",
        [$role]
    ))->pluck('privilege_type')->all();

    expect($grants('clintra_app'))->toBe(['INSERT', 'SELECT']);
    foreach (['clintra_rls', 'clintra_provision', 'clintra_mint', 'clintra_register', 'clintra_staff'] as $role) {
        expect($grants($role))->toBe([], "{$role} must hold nothing on device_audit_log");
    }
});

test('the policies are one SELECT and one INSERT, with no UPDATE or DELETE policy', function () {
    $scope = '(org_id = current_org()) AND ((location_id IS NULL) OR (location_id IN ( SELECT allowed_locations.allowed_locations'
        ."\n   FROM allowed_locations() allowed_locations(allowed_locations)))) AND ((practitioner_id IS NULL) OR (practitioner_id IN ( SELECT allowed_practitioners.allowed_practitioners"
        ."\n   FROM allowed_practitioners() allowed_practitioners(allowed_practitioners))))";

    $policies = collect($this->fx()->select(
        "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'device_audit_log' ORDER BY policyname"
    ))->map(fn ($p) => [$p->policyname, $p->cmd, $p->qual, $p->with_check])->all();

    expect($policies)->toBe([
        ['device_audit_log_insert', 'INSERT', null, "({$scope} AND (pushed_by_membership_id = current_membership()) AND (actor_membership_id IN ( SELECT memberships.id"
            ."\n   FROM memberships\n  WHERE (memberships.org_id = current_org()))) AND (device_id IN ( SELECT device.id"
            ."\n   FROM device\n  WHERE (device.org_id = current_org()))))"],
        ['device_audit_log_select', 'SELECT', "({$scope})", null],
    ]);
});

test('seq is an identity the writers never supply, and every key and index is in place', function () {
    $seq = $this->asOwner()->selectOne(
        "SELECT is_identity, identity_generation, data_type FROM information_schema.columns
         WHERE table_name = 'device_audit_log' AND column_name = 'seq'"
    );
    expect([$seq->is_identity, $seq->identity_generation, $seq->data_type])->toBe(['YES', 'ALWAYS', 'bigint']);

    $indexes = collect($this->fx()->select(
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'device_audit_log' ORDER BY indexname"
    ))->mapWithKeys(fn ($i) => [$i->indexname => $i->indexdef])->all();

    expect($indexes)->toBe([
        'device_audit_log_entity_entity_id_index' => 'CREATE INDEX device_audit_log_entity_entity_id_index ON public.device_audit_log USING btree (entity, entity_id)',
        'device_audit_log_org_id_at_index' => 'CREATE INDEX device_audit_log_org_id_at_index ON public.device_audit_log USING btree (org_id, at)',
        'device_audit_log_org_id_seq_index' => 'CREATE INDEX device_audit_log_org_id_seq_index ON public.device_audit_log USING btree (org_id, seq)',
        'device_audit_log_pkey' => 'CREATE UNIQUE INDEX device_audit_log_pkey ON public.device_audit_log USING btree (id)',
        'device_audit_log_seq_unique' => 'CREATE UNIQUE INDEX device_audit_log_seq_unique ON public.device_audit_log USING btree (seq)',
    ]);

    $foreignKeys = collect($this->fx()->select(<<<'SQL'
        SELECT a.attname AS col, cf.relname AS parent, c.confdeltype AS on_delete
        FROM pg_constraint c
        JOIN pg_class cf ON cf.oid = c.confrelid
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.conrelid = 'device_audit_log'::regclass AND c.contype = 'f'
        ORDER BY a.attname
    SQL))->map(fn ($fk) => [$fk->col, $fk->parent, $fk->on_delete])->all();

    expect($foreignKeys)->toBe([
        ['actor_membership_id', 'memberships', 'r'],
        ['device_id', 'device', 'r'],
        ['location_id', 'locations', 'r'],
        ['org_id', 'organizations', 'r'],
        ['practitioner_id', 'practitioners', 'r'],
        ['pushed_by_membership_id', 'memberships', 'r'],
    ]);

    $check = $this->fx()->selectOne("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'device_audit_log_action_check'");
    expect($check->def)->toBe("CHECK (((action)::text = ANY ((ARRAY['create'::character varying, 'update'::character varying, 'delete'::character varying])::text[])))");
});

// --- Isolation ---------------------------------------------------------------

test('one organization never reads or writes another organization\'s rows', function () {
    $orgA = makeAuthenticatedDevice();
    $orgB = makeAuthenticatedDevice();
    $rowA = $this->makeDeviceAuditLog($orgA['orgId'], $orgA['membershipId'], $orgA['deviceId']);

    expect(deviceAuditIdsSeenBy($orgA['membershipId']))->toBe([$rowA]);
    expect(deviceAuditIdsSeenBy($orgB['membershipId']))->toBe([]);

    // Org B naming org A, or org A's member, device or location, is refused.
    expect(insertDeviceAuditAsApp($orgB, deviceAuditInsert($orgB, ['org_id' => $orgA['orgId']])))->toBe('42501');
    expect(insertDeviceAuditAsApp($orgB, deviceAuditInsert($orgB, ['actor_membership_id' => $orgA['membershipId']])))->toBe('42501');
    expect(insertDeviceAuditAsApp($orgB, deviceAuditInsert($orgB, ['device_id' => $orgA['deviceId']])))->toBe('42501');
    expect(insertDeviceAuditAsApp($orgB, deviceAuditInsert($orgB, ['location_id' => $orgA['locationId']])))->toBe('42501');

    // No membership at all sees nothing.
    expect($this->withMembership($this->asApp(), null, fn ($db) => $db->table('device_audit_log')->count()))->toBe(0);
});

test('a membership limited to listed locations sees those locations\' rows and the organization-wide ones', function () {
    $credential = makeAuthenticatedDevice();
    $otherLocation = $this->makeLocation($credential['orgId'], 'other');
    $limited = $this->makeMembership($this->makeUser('limited'), $credential['orgId'], ['role' => 'assistant', 'location_scope' => 'listed']);
    $this->makeMembershipLocation($limited, $credential['locationId']);

    $own = $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $credential['deviceId'], ['location_id' => $credential['locationId']]);
    $orgWide = $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $credential['deviceId']);
    $other = $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $credential['deviceId'], ['location_id' => $otherLocation]);

    $seen = deviceAuditIdsSeenBy($limited);
    expect($seen)->toContain($own, $orgWide);
    expect($seen)->not->toContain($other);
    expect(deviceAuditIdsSeenBy($credential['membershipId']))->toContain($own, $orgWide, $other);
});

// --- Append-only -------------------------------------------------------------

test('clintra_app can neither update nor delete a row, and clintra_owner changes nothing', function () {
    $credential = makeAuthenticatedDevice();
    $id = $this->makeDeviceAuditLog($credential['orgId'], $credential['membershipId'], $credential['deviceId']);

    foreach (['update', 'delete'] as $command) {
        $code = null;
        try {
            $this->withMembership($this->asApp(), $credential['membershipId'], fn ($db) => $command === 'update'
                ? $db->table('device_audit_log')->where('id', $id)->update(['action' => 'delete'])
                : $db->table('device_audit_log')->where('id', $id)->delete());
        } catch (QueryException $e) {
            $code = $e->getCode();
        }
        expect($code)->toBe('42501', "clintra_app's {$command} must be refused by the grant");
    }

    $updated = $this->withMembership($this->asOwner(), $credential['membershipId'], fn ($db) => $db->table('device_audit_log')->where('id', $id)->update(['action' => 'delete']));
    $deleted = $this->withMembership($this->asOwner(), $credential['membershipId'], fn ($db) => $db->table('device_audit_log')->where('id', $id)->delete());
    expect([$updated, $deleted])->toBe([0, 0]);

    expect($this->fx()->table('device_audit_log')->where('id', $id)->value('action'))->toBe('create');
});

// --- Attribution -------------------------------------------------------------

test('the pusher must be the session\'s membership; the actor may be any member of the organization', function () {
    $credential = makeAuthenticatedDevice();
    $assistant = $this->makeMembership($this->makeUser('assistant'), $credential['orgId'], ['role' => 'assistant']);

    // The pusher is the token's membership, never another one.
    expect(insertDeviceAuditAsApp($credential, deviceAuditInsert($credential, ['pushed_by_membership_id' => $assistant])))->toBe('42501');

    // The actor is the device's claim: the assistant signed in on it.
    $row = deviceAuditInsert($credential, ['actor_membership_id' => $assistant]);
    expect(insertDeviceAuditAsApp($credential, $row))->toBeNull();
    expect($this->fx()->table('device_audit_log')->where('id', $row['id'])->value('actor_membership_id'))->toBe($assistant);
});

test('no writer supplies seq', function () {
    $credential = makeAuthenticatedDevice();

    expect(insertDeviceAuditAsApp($credential, deviceAuditInsert($credential, ['seq' => 1])))->toBe('428C9');
});
