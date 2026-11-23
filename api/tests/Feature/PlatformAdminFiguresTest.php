<?php

use Illuminate\Support\Facades\DB;
use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () { $this->endPlatformFixtures(); });

function clinicRead(string $kind, ?string $session, mixed $arg = null, ?string $to = null, ?string $log = null): array
{
    if ($kind === 'figures') {
        return array_map(fn ($r) => (array) $r, test()->panel()->select('SELECT * FROM platform.admin_org_figures(?::uuid,?::date,?::date,?::uuid)', [$session, $arg, $to, $log]));
    }
    [$sql, $bindings] = match ($kind) {
        'detail' => ['SELECT platform.admin_org_detail(?::uuid,?::uuid) AS result', [$session, $arg]],
        'names' => ['SELECT platform.admin_org_names(?::uuid,?::uuid[]) AS result', [$session, $arg]],
        'list' => ['SELECT platform.admin_org_list(?::uuid) AS result', [$session]],
    };
    return json_decode(test()->panel()->selectOne($sql, $bindings)->result, true, flags: JSON_THROW_ON_ERROR);
}

function latestClinicLog(int $seq): object
{
    return test()->asOwner()->table('platform.admin_log')->where('seq', '>', $seq)->sole();
}

function clinicLogSequence(): int
{
    return (int) (test()->asOwner()->table('platform.admin_log')->max('seq') ?? 0);
}

test('all four readers resolve sessions before inputs and commit one refusal with session context', function (string $kind, string $state) {
    $admin = $this->platformAdmin(['must_change_password' => $state === 'password']);
    $session = $this->platformSession($admin, ['ip' => '192.0.2.60', 'user_agent' => 'B4 refusal tests']);
    if ($state === 'unknown') $session = $this->platformId();
    if ($state === 'null') $session = null;
    if ($state === 'idle') $this->asOwner()->statement("UPDATE platform.admin_sessions SET last_seen_at=now()-interval '30 minutes' WHERE id=?", [$session]);
    if ($state === 'expired') $this->asOwner()->statement('UPDATE platform.admin_sessions SET expires_at=now() WHERE id=?', [$session]);
    if ($state === 'ended') $this->asOwner()->statement('UPDATE platform.admin_sessions SET ended_at=now() WHERE id=?', [$session]);
    if ($state === 'inactive') $this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->update(['is_active' => false]);
    $before = clinicLogSequence();
    $result = clinicRead($kind, $session, $kind === 'figures' ? 'infinity' : null);
    $reason = $state === 'password' ? 'password_change_required' : 'session_invalid';
    expect($result)->toBe($kind === 'figures' ? [] : ['ok' => false, 'reason' => $reason]);
    $row = latestClinicLog($before);
    expect($row->action)->toBe('figures.view')->and($row->reason)->toBe($reason)->and($row->succeeded)->toBeFalse()
        ->and($row->org_id)->toBeNull()->and($row->admin_user_id)->toBe($state === 'password' ? $admin['id'] : null);
    $known = ! in_array($state, ['unknown', 'null'], true);
    expect($row->ip)->toBe($known ? '192.0.2.60' : null)->and($row->user_agent)->toBe($known ? 'B4 refusal tests' : null);
    $detail = json_decode($row->detail, true);
    if ($kind === 'figures') expect($detail)->toHaveKeys(['from', 'to']);
    else expect($detail['operation'])->toBe('org.'.$kind);
})->with(['figures', 'detail', 'names', 'list'])->with(['unknown', 'null', 'idle', 'expired', 'ended', 'inactive', 'password']);

test('figures validates inclusive period bounds and records exactly one effective period', function (?string $from, ?string $to, bool $valid) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.61', 'user_agent' => 'B4 period']);
    $log = $this->platformId();
    $before = clinicLogSequence();
    $rows = clinicRead('figures', $session, $from, $to, $log);
    $row = latestClinicLog($before);
    expect($row->id)->toBe($log)->and($row->succeeded)->toBe($valid)->and($row->reason)->toBe($valid ? null : 'invalid_payload')
        ->and($row->ip)->toBe('192.0.2.61')->and($row->user_agent)->toBe('B4 period');
    if (! $valid) expect($rows)->toBe([]);
    $effectiveTo = $to ?? $this->asOwner()->selectOne("SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS day")->day;
    $detail = json_decode($row->detail, true);
    expect($detail['to'])->toBe($effectiveTo);
    if ($from !== null) expect($detail['from'])->toBe($from);
    elseif ($valid) expect($detail['from'])->toBe((new DateTimeImmutable($effectiveTo))->modify('-29 days')->format('Y-m-d'));
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('last_totp_step'))->toBeNull();
})->with([
    [null, null, true], [null, '2026-07-01', true], ['2026-07-01', '2026-07-01', true],
    ['2024-01-01', '2024-12-31', true], ['2026-01-01', '2027-01-01', true],
    ['2026-07-02', '2026-07-01', false], ['2024-01-01', '2025-01-01', false],
    ['infinity', null, false], ['-infinity', '2026-01-01', false], [null, 'infinity', false],
]);

test('two clinics retain isolated active counts visit outcomes piastres and disabled state at Cairo day edges', function (string $day, string $start, string $end, string $beforeDay, string $afterDay) {
    $session = $this->platformSession($this->platformAdmin());
    $organizations = [];
    foreach ([1, 2] as $factor) {
        $org = $this->makeOrganization('B4 counts '.$factor);
        $organizations[] = $org;
        $location = $this->makeLocation($org);
        $this->makeLocation($org, 'Inactive', false);
        if ($factor === 2) $this->makeLocation($org, 'Second');
        $specialty = $this->makeSpecialtyTemplate(null, 'b4-'.$this->platformId());
        $doctor = $this->makePractitioner($org, $specialty);
        $inactive = $this->makePractitioner($org, $specialty);
        $this->fx()->table('practitioners')->where('id', $inactive)->update(['is_active' => false]);
        if ($factor === 2) $this->makePractitioner($org, $specialty);
        $member = $this->makeMembership($this->makeUser(), $org);
        $this->makeMembership($this->makeUser(), $org, ['is_active' => false]);
        if ($factor === 2) $this->makeMembership($this->makeUser(), $org);
        $device = $this->makeDevice($org, $location, $member);
        $revoked = $this->makeDevice($org, $location, $member);
        $this->fx()->table('device')->where('id', $revoked)->update(['revoked_at' => $start]);
        if ($factor === 2) $this->makeDevice($org, $location, $member);
        $patient = $this->makePatient($org);
        $position = 0;
        foreach (['completed', 'cancelled', 'no_show', 'booked'] as $status) {
            for ($i = 0; $i < $factor; $i++) {
                $this->makeVisit($org, $location, $doctor, $patient, $member, ['visit_date' => $day, 'status' => $status, 'position' => ++$position]);
            }
        }
        foreach ([$beforeDay, $afterDay] as $date) {
            $this->makeVisit($org, $location, $doctor, $patient, $member, ['visit_date' => $date, 'status' => 'completed', 'position' => ++$position]);
        }
        $invoiceIds = [];
        $this->cleanupFirst(function () use ($org) {
            $ids = $this->fx()->table('invoices')->where('org_id', $org)->pluck('id');
            $this->fx()->table('payments')->whereIn('invoice_id', $ids)->delete();
            $this->fx()->table('invoices')->where('org_id', $org)->delete();
        });
        $before = (new DateTimeImmutable($start))->modify('-1 microsecond')->format('Y-m-d\TH:i:s.uP');
        $after = (new DateTimeImmutable($end))->modify('+1 microsecond')->format('Y-m-d\TH:i:s.uP');
        foreach ([$start, $end, $before, $after, $start] as $index => $at) {
            $invoice = $this->platformId();
            $invoiceIds[] = $invoice;
            $this->fx()->table('invoices')->insert(['id' => $invoice, 'org_id' => $org, 'location_id' => $location, 'number' => $index + 1, 'series' => 1,
                'issued_year' => (int) substr($day, 0, 4), 'patient_id' => $patient, 'practitioner_id' => $doctor,
                'total' => 12345 * $factor, 'paid' => 0, 'status' => $index === 4 ? 'void' : 'unpaid', 'issued_at' => $at]);
            $this->fx()->table('payments')->insert(['id' => $this->platformId(), 'invoice_id' => $invoice, 'location_id' => $location, 'series' => 1,
                'receipt_number' => 'B4-'.$index, 'amount' => 101 * $factor, 'method' => 'cash', 'after_close' => false, 'created_by' => $member, 'created_at' => $at]);
        }
        $this->fx()->table('payments')->insert(['id' => $this->platformId(), 'invoice_id' => $invoiceIds[2], 'location_id' => $location, 'series' => 1,
            'receipt_number' => 'B4-old', 'amount' => 3 * $factor, 'method' => 'cash', 'after_close' => false, 'created_by' => $member, 'created_at' => $start]);
        $this->makeSyncLedgerRow($org, $member, $device, ['applied_at' => $start]);
        $this->makeSyncLedgerRow($org, $member, $revoked, ['applied_at' => $after]);
    }
    $this->fx()->table('organizations')->where('id', $organizations[1])->update(['disabled_at' => $start, 'disabled_reason' => 'B4 disabled']);
    $beforeLog = clinicLogSequence();
    $rows = array_column(clinicRead('figures', $session, $day, $day), null, 'org_id');
    expect(latestClinicLog($beforeLog)->succeeded)->toBeTrue();
    foreach ($organizations as $index => $org) {
        $factor = $index + 1;
        $row = $rows[$org];
        expect(array_keys($row))->toBe(['org_id', 'org_name', 'disabled_at', 'active_locations', 'active_practitioners', 'active_members', 'active_devices', 'last_sync_at',
            'visits_completed', 'visits_cancelled', 'visits_no_show', 'invoices_issued', 'billed_piastres', 'collected_piastres']);
        foreach (['active_locations', 'active_practitioners', 'active_members', 'active_devices', 'visits_completed', 'visits_cancelled', 'visits_no_show'] as $column) expect($row[$column])->toBe($factor);
        expect($row['invoices_issued'])->toBe(2)->and($row['billed_piastres'])->toBe(24690 * $factor)->and($row['collected_piastres'])->toBe(306 * $factor);
        expect((new DateTimeImmutable($row['last_sync_at']))->format('U.u'))->toBe((new DateTimeImmutable($end))->modify('+1 microsecond')->format('U.u'));
        expect($row['disabled_at'] === null)->toBe($index === 0);
    }
})->with([
    ['2026-07-01', '2026-07-01T00:00:00+03:00', '2026-07-01T23:59:59.999999+03:00', '2026-06-30', '2026-07-02'],
    ['2026-01-01', '2026-01-01T00:00:00+02:00', '2026-01-01T23:59:59.999999+02:00', '2025-12-31', '2026-01-02'],
]);

test('an empty clinic reports integer zero counts and no last sync', function () {
    $org = $this->makeOrganization('B4 empty');
    $row = array_column(clinicRead('figures', $this->platformSession($this->platformAdmin())), null, 'org_id')[$org];
    foreach (['active_locations', 'active_practitioners', 'active_members', 'active_devices', 'visits_completed', 'visits_cancelled', 'visits_no_show', 'invoices_issued', 'billed_piastres', 'collected_piastres'] as $key) expect($row[$key])->toBe(0);
    expect($row['last_sync_at'])->toBeNull();
});

test('detail projects only clinic state and its locations and logs success or target refusal once', function (string $case) {
    $org = $this->makeOrganization('B4 detail');
    $location = $this->makeLocation($org, 'فرع التجربة', false);
    $foreign = $this->makeOrganization('B4 other');
    $this->makeLocation($foreign, 'Never included');
    $this->fx()->table('organizations')->where('id', $org)->update(['disabled_at' => '2026-01-01T00:00:00Z', 'disabled_reason' => 'سبب التجربة']);
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.62', 'user_agent' => 'B4 detail']);
    $target = match ($case) { 'known' => $org, 'unknown' => $this->platformId(), default => null };
    $before = clinicLogSequence();
    $result = clinicRead('detail', $session, $target);
    $log = latestClinicLog($before);
    expect($log->org_id)->toBe($case === 'known' ? $org : null)->and($log->target_id)->toBe($target)
        ->and($log->ip)->toBe('192.0.2.62')->and($log->user_agent)->toBe('B4 detail');
    if ($case !== 'known') {
        expect($result)->toBe(['ok' => false, 'reason' => $case === 'unknown' ? 'not_found' : 'invalid_payload']);
        expect($log->reason)->toBe($result['reason'])->and($log->succeeded)->toBeFalse();
    } else {
        expect($result['ok'])->toBeTrue()->and($result['org'])->toHaveCount(5)->and($result['org']['id'])->toBe($org)
            ->and($result['org']['name'])->toBe('B4 detail')->and($result['org']['disabled_reason'])->toBe('سبب التجربة')
            ->and($result['org']['locations'])->toBe([['id' => $location, 'name' => 'فرع التجربة']]);
        expect($log->succeeded)->toBeTrue()->and($log->action)->toBe('figures.view');
    }
})->with(['known', 'unknown', 'null']);

test('names is silent on success accepts empty through 100 IDs and omits unknown IDs', function (int $size) {
    $org = $this->makeOrganization('B4 name');
    $ids = $size ? array_fill(0, $size, $org) : [];
    if ($size > 1) $ids[1] = $this->platformId();
    $before = clinicLogSequence();
    expect(clinicRead('names', $this->platformSession($this->platformAdmin()), '{'.implode(',', $ids).'}'))->toBe(['ok' => true, 'names' => $size ? [$org => 'B4 name'] : []]);
    expect(clinicLogSequence())->toBe($before);
})->with([0, 1, 100]);

test('names refuses null elements null arrays dimensions and 101 IDs with exactly one contextual row', function (string $case) {
    $id = $this->platformId();
    $argument = match ($case) { 'null' => null, 'element' => '{NULL}', 'matrix' => '{{'.$id.'},{'.$id.'}}', default => '{'.implode(',', array_fill(0, 101, $id)).'}' };
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.63', 'user_agent' => 'B4 names']);
    $before = clinicLogSequence();
    expect(clinicRead('names', $session, $argument))->toBe(['ok' => false, 'reason' => 'invalid_payload']);
    $log = latestClinicLog($before);
    expect($log->reason)->toBe('invalid_payload')->and($log->admin_user_id)->toBe($admin['id'])->and($log->ip)->toBe('192.0.2.63')->and($log->user_agent)->toBe('B4 names');
})->with(['null', 'element', 'matrix', 'over-limit']);

test('clinic list is sorted by name then ID contains only ID and name and never logs success', function () {
    $a = $this->makeOrganization('B4 same');
    $b = $this->makeOrganization('B4 same');
    $this->fx()->table('organizations')->where('id', $b)->update(['disabled_at' => now()->toIso8601String(), 'disabled_reason' => 'Disabled list fixture']);
    $session = $this->platformSession($this->platformAdmin());
    $expected = array_map(fn ($row) => (array) $row, $this->fx()->select('SELECT id,name FROM organizations ORDER BY name,id'));
    $before = clinicLogSequence();
    expect(clinicRead('list', $session))->toBe(['ok' => true, 'clinics' => $expected]);
    expect(clinicLogSequence())->toBe($before);
    expect(array_column($expected, 'id'))->toContain($a, $b);
});

test('stats has only the declared columns on every public table and no write or table grants', function () {
    $allow = [
        'organizations' => ['id', 'name', 'disabled_at', 'disabled_reason'], 'locations' => ['id', 'org_id', 'name', 'is_active'],
        'practitioners' => ['org_id', 'is_active'], 'memberships' => ['org_id', 'is_active'], 'device' => ['org_id', 'revoked_at'],
        'sync_ledger' => ['org_id', 'applied_at'], 'visits' => ['org_id', 'visit_date', 'status'],
        'invoices' => ['id', 'org_id', 'total', 'status', 'issued_at'], 'payments' => ['invoice_id', 'amount', 'created_at'],
    ];
    $rows = $this->asOwner()->select(<<<'SQL'
        SELECT c.relname,a.attname,privilege,has_column_privilege('clintra_admin_stats',c.oid,a.attnum,privilege) AS allowed
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) privilege
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
    SQL);
    expect($rows)->not->toBeEmpty();
    foreach ($rows as $r) expect($r->allowed, $r->relname.'.'.$r->attname.':'.$r->privilege)->toBe($r->privilege === 'SELECT' && in_array($r->attname, $allow[$r->relname] ?? [], true));
    expect($this->asOwner()->select("SELECT 1 FROM information_schema.role_table_grants WHERE grantee='clintra_admin_stats'"))->toBe([]);
    $platform = $this->asOwner()->select("SELECT table_name,column_name,privilege_type FROM information_schema.role_column_grants WHERE grantee='clintra_admin_stats' AND table_schema='platform' ORDER BY 1,2,3");
    expect(array_map(fn ($r) => $r->table_name.':'.$r->column_name.':'.$r->privilege_type, $platform))->toBe(['admin_sessions:id:SELECT', 'admin_sessions:ip:SELECT', 'admin_sessions:user_agent:SELECT']);
    foreach (['admin_org_figures(uuid,date,date,uuid)', 'admin_org_detail(uuid,uuid)', 'admin_org_names(uuid,uuid[])', 'admin_org_list(uuid)'] as $signature) {
        $function = $this->asOwner()->selectOne('SELECT p.oid,p.prosecdef,p.proconfig::text AS config,r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=?::regprocedure', ['platform.'.$signature]);
        expect($function->rolname)->toBe('clintra_admin_stats')->and($function->prosecdef)->toBeTrue()->and($function->config)->toBe('{"search_path=public, platform, pg_temp"}');
        $acl = $this->asOwner()->select("SELECT a.grantee::regrole::text AS role FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid=? AND a.privilege_type='EXECUTE' ORDER BY role", [$function->oid]);
        expect(array_column($acl, 'role'))->toBe(['clintra_admin_app', 'clintra_admin_stats']);
    }
});

test('migration 000060 rolls back all four readers and grants and reapplies without losing logs', function () {
    $db = $this->asOwner();
    expect($db->selectOne('SELECT current_database() AS name')->name)->toBe('clintra_test');
    $previous = DB::getDefaultConnection();
    DB::setDefaultConnection('pgsql_owner');
    $db->beginTransaction();
    try {
        $migration = require database_path('migrations/2026_09_12_000060_add_platform_clinic_figures.php');
        $logs = $db->table('platform.admin_log')->count();
        $migration->down();
        expect($db->select("SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform' AND p.proname IN ('admin_org_figures','admin_org_detail','admin_org_names','admin_org_list')"))->toBe([]);
        expect($db->select("SELECT 1 FROM information_schema.role_column_grants WHERE grantee='clintra_admin_stats'"))->toBe([]);
        $migration->up();
        expect($db->table('platform.admin_log')->count())->toBe($logs);
    } finally {
        $db->rollBack();
        DB::setDefaultConnection($previous);
    }
});

test('the fixture process refuses non fixture accounts and non test database configuration before mutation', function (string $case) {
    $admin = $this->platformAdmin();
    $count = $this->asOwner()->table('platform.admin_users')->count();
    $process = new Symfony\Component\Process\Process(
        [PHP_BINARY, base_path('scripts/panel-test-fixtures.php'), $case === 'account' ? 'inactive' : 'create', $case === 'account' ? $admin['id'] : ''],
        base_path(), ['APP_ENV' => 'testing', 'DB_DATABASE' => $case === 'account' ? 'clintra_test' : 'clintra'],
    );
    $process->run();
    expect($process->isSuccessful())->toBeFalse();
    expect($process->getErrorOutput())->toContain($case === 'account' ? 'Only b3-/b4- fixture accounts are allowed.' : 'Panel fixtures require clintra_test.');
    expect($this->asOwner()->table('platform.admin_users')->count())->toBe($count);
    expect($this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->value('is_active'))->toBeTrue();
})->with(['account', 'database']);
