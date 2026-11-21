<?php

use Tests\Support\PlatformAdminHarness;

uses(PlatformAdminHarness::class);
afterEach(function () {
    $this->endPlatformFixtures();
});

function b3Read(string $function, ?string $session, mixed $payload = null): array
{
    $sql = $function === 'admin_whoami' ? 'SELECT platform.admin_whoami(?::uuid) AS result' : 'SELECT platform.admin_log_page(?::uuid,?::jsonb) AS result';
    $args = $function === 'admin_whoami' ? [$session] : [$session, json_encode($payload, JSON_THROW_ON_ERROR)];

    return json_decode(test()->panel()->selectOne($sql, $args)->result, true, flags: JSON_THROW_ON_ERROR);
}

test('whoami returns only identity and the initial password flag and silently bumps activity', function (bool $mustChange) {
    $admin = $this->platformAdmin(['must_change_password' => $mustChange]);
    $session = $this->platformSession($admin, ['last_seen_at' => now()->subMinutes(29)->toIso8601String()]);
    $before = $this->asOwner()->table('platform.admin_log')->count();
    expect(b3Read('admin_whoami', $session))->toBe(['ok' => true, 'name' => 'Test admin', 'email' => $admin['email'], 'must_change_password' => $mustChange]);
    expect($this->asOwner()->selectOne("SELECT last_seen_at>now()-interval '1 minute' AS bumped FROM platform.admin_sessions WHERE id=?", [$session])->bumped)->toBeTrue();
    expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before);
})->with([true, false]);

test('reader session refusals preserve their exact shapes and audit policy', function (string $function, string $case) {
    $admin = $this->platformAdmin(['must_change_password' => $case === 'password']);
    $session = $this->platformSession($admin, ['ip' => '192.0.2.123', 'user_agent' => 'B3 read tests']);
    if ($case === 'unknown') {
        $session = $this->platformId();
    }
    if ($case === 'null') {
        $session = null;
    }
    if ($case === 'idle') {
        $this->asOwner()->statement("UPDATE platform.admin_sessions SET last_seen_at=now()-interval '30 minutes' WHERE id=?", [$session]);
    }
    if ($case === 'absolute') {
        $this->asOwner()->statement('UPDATE platform.admin_sessions SET expires_at=now() WHERE id=?', [$session]);
    }
    if ($case === 'ended') {
        $this->asOwner()->statement('UPDATE platform.admin_sessions SET ended_at=now() WHERE id=?', [$session]);
    }
    if ($case === 'inactive') {
        $this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->update(['is_active' => false]);
    }
    $before = $this->asOwner()->table('platform.admin_log')->max('seq') ?? 0;
    $result = b3Read($function, $session, (object) []);
    if ($case === 'password' && $function === 'admin_whoami') {
        expect($result['ok'])->toBeTrue();
    } else {
        expect($result)->toBe(['ok' => false, 'reason' => $case === 'password' ? 'password_change_required' : 'session_invalid']);
    }
    $logs = $this->asOwner()->table('platform.admin_log')->where('seq', '>', $before)->get();
    if ($function === 'admin_whoami') {
        expect($logs)->toHaveCount(0);
    } else {
        expect($logs)->toHaveCount(1);
        expect($logs[0]->action)->toBe('admin.log_view')->and($logs[0]->succeeded)->toBeFalse()->and($logs[0]->reason)->toBe($result['reason']);
        expect($logs[0]->admin_user_id)->toBe($case === 'password' ? $admin['id'] : null)
            ->and($logs[0]->ip)->toBe($case === 'password' ? '192.0.2.123' : null)
            ->and($logs[0]->user_agent)->toBe($case === 'password' ? 'B3 read tests' : null);
    }
})->with(['admin_whoami', 'admin_log_page'])->with(['unknown', 'null', 'idle', 'absolute', 'ended', 'inactive', 'password']);

dataset('invalid B3 log filters', [
    [null], [[]], ['text'], [7], [['unknown' => 1]], [['page_size' => 0]], [['page_size' => 101]], [['page_size' => -1]],
    [['page_size' => 1.5]], [['page_size' => '1']], [['page_size' => null]], [['page_size' => true]],
    [['before_seq' => '0']], [['before_seq' => -1]], [['before_seq' => '9223372036854775808']], [['before_seq' => '1;SELECT 1']], [['before_seq' => []]],
    [['admin_user_id' => 'bad']], [['admin_user_id' => 1]], [['org_id' => 'bad']], [['org_id' => true]],
    [['action' => []]], [['action' => '']], [['action' => str_repeat('x', 101)]],
    [['from' => '2026-02-30']], [['to' => 'bad']], [['from' => 1]], [['to' => []]],
    [['from' => '2026-11-02', 'to' => '2026-11-01']], [['from' => '2025-01-01', 'to' => '2026-01-02']],
]);
test('invalid log payloads return and commit one refusal without raising', function (mixed $payload) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['ip' => '192.0.2.8', 'user_agent' => 'B3 invalid filters']);
    $before = $this->asOwner()->table('platform.admin_log')->max('seq') ?? 0;
    expect(b3Read('admin_log_page', $session, $payload))->toBe(['ok' => false, 'reason' => 'invalid_payload']);
    $row = $this->asOwner()->table('platform.admin_log')->where('seq', '>', $before)->sole();
    expect($row->reason)->toBe('invalid_payload')->and($row->admin_user_id)->toBe($admin['id'])->and($row->ip)->toBe('192.0.2.8')->and($row->user_agent)->toBe('B3 invalid filters');
})->with('invalid B3 log filters');

test('log paging is stable at both size limits and exposes precisely the log columns and the joined name', function (int $size) {
    $admin = $this->platformAdmin();
    $session = $this->platformSession($admin, ['last_seen_at' => now()->subMinute()->toIso8601String()]);
    $ids = [];
    $lastSeen = $this->asOwner()->table('platform.admin_sessions')->where('id', $session)->value('last_seen_at');
    for ($i = 0; $i < 102; $i++) {
        $id = $this->platformId();
        $ids[] = $id;
        $this->asOwner()->insert("INSERT INTO platform.admin_log(id,admin_user_id,action,succeeded,detail) VALUES (?::uuid,?::uuid,'admin.logout',true,'{}')", [$id, $admin['id']]);
    }
    $filters = ['admin_user_id' => $admin['id'], 'page_size' => $size];
    $seen = [];
    $before = $this->asOwner()->table('platform.admin_log')->count();
    do {
        $page = b3Read('admin_log_page', $session, $filters);
        expect($page['ok'])->toBeTrue()->and(count($page['rows']))->toBeLessThanOrEqual($size);
        foreach ($page['rows'] as $row) {
            $keys = array_keys($row);
            sort($keys);
            expect($keys)->toBe(['action', 'admin_name', 'admin_user_id', 'at', 'detail', 'id', 'ip', 'org_id', 'reason', 'seq', 'succeeded', 'target_id', 'user_agent']);
            expect($row['admin_name'])->toBe('Test admin');
            $seen[] = $row['id'];
        }
        $filters['before_seq'] = $page['next_before_seq'];
    } while ($page['next_before_seq'] !== null);
    expect($seen)->toBe(array_reverse($ids))->and(array_unique($seen))->toHaveCount(102);
    expect($this->asOwner()->table('platform.admin_sessions')->where('id', $session)->value('last_seen_at'))->toBe($lastSeen);
    expect($this->asOwner()->table('platform.admin_log')->count())->toBe($before);
    $empty = b3Read('admin_log_page', $session, ['before_seq' => '1']);
    expect($empty)->toBe(['ok' => true, 'rows' => [], 'next_before_seq' => null]);
    $body = $this->asOwner()->selectOne("SELECT pg_get_functiondef('platform.admin_log_page(uuid,jsonb)'::regprocedure) AS body")->body;
    foreach (['password_hash', 'totp_secret', 'admin_recovery_codes', 'code_hash', 'u.*', 'row_to_json'] as $secret) {
        expect($body)->not->toContain($secret);
    }
})->with([1, 100]);

test('log filters combine exactly and dates include both Cairo day boundaries across a 366 day window', function () {
    $admin = $this->platformAdmin();
    $other = $this->platformAdmin();
    $session = $this->platformSession($admin);
    $org = $this->makeOrganization('B3 log A');
    $otherOrg = $this->makeOrganization('B3 log B');
    $ids = [];
    foreach ([[$admin['id'], $org, 'org.disable', '2026-01-01 00:00:00+02'], [$admin['id'], $org, 'org.enable', '2026-12-31 23:59:59+02'],
        [$other['id'], $org, 'org.disable', '2026-01-01 12:00:00+02'], [$admin['id'], $otherOrg, 'org.disable', '2026-01-01 12:00:00+02'],
        [$admin['id'], $org, 'org.disable', '2025-12-31 23:59:59+02'], [$admin['id'], $org, 'org.disable', '2027-01-01 00:00:00+02']] as [$actor,$clinic,$action,$at]) {
        $id = $this->platformId();
        $ids[] = $id;
        $this->asOwner()->insert('INSERT INTO platform.admin_log(id,admin_user_id,org_id,action,at,succeeded) VALUES (?::uuid,?::uuid,?::uuid,?,?::timestamptz,true)', [$id, $actor, $clinic, $action, $at]);
    }
    $filters = ['from' => '2026-01-01', 'to' => '2026-12-31', 'org_id' => $org, 'admin_user_id' => $admin['id']];
    expect(array_column(b3Read('admin_log_page', $session, $filters)['rows'], 'id'))->toBe([$ids[1], $ids[0]]);
    expect(array_column(b3Read('admin_log_page', $session, $filters + ['action' => 'org.disable'])['rows'], 'id'))->toBe([$ids[0]]);
    expect(b3Read('admin_log_page', $session, $filters + ['action' => 'no.such.action'])['rows'])->toBe([]);
    expect(b3Read('admin_log_page', $session, ['from' => '2024-01-01', 'to' => '2024-12-31'])['ok'])->toBeTrue();
    expect(b3Read('admin_log_page', $session, ['from' => '2024-01-01', 'to' => '2025-01-01']))->toBe(['ok' => false, 'reason' => 'invalid_payload']);
});
