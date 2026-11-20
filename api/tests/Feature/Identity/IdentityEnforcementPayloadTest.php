<?php

use Tests\Support\IdentityHarness;

test('pull and bootstrap report the enforcement timestamp for the requesting organization', function () {
    $org = IdentityHarness::org(enforced: true);
    $this->fx()->table('organizations')->where('id', $org['orgId'])->update([
        'identity_enforced_at' => '2026-11-20T12:34:56.123456+02:00',
    ]);

    foreach (['/api/sync/pull', '/api/sync/bootstrap'] as $route) {
        IdentityHarness::send($org, 'GET', $route)->assertOk()
            ->assertJsonPath('identity_enforced_at', '2026-11-20T10:34:56.123456Z');
    }
});

test('pull and bootstrap omit the enforcement timestamp for an unenforced organization', function () {
    IdentityHarness::org(enforced: true);
    $org = IdentityHarness::org();

    foreach (['/api/sync/pull', '/api/sync/bootstrap'] as $route) {
        IdentityHarness::send($org, 'GET', $route)->assertOk()->assertJsonMissingPath('identity_enforced_at');
    }
});
