<?php

use Illuminate\Database\QueryException;

/**
 * mint_activation_code(jsonb) had no direct test before the provisioning
 * role split (2026_09_12_000009_split_provisioning_roles.php moved it from
 * clintra_provision to a new clintra_mint) — only `provision_organization`'s
 * own first-code creation was exercised, via tests/Feature/Rls/ProvisioningTest.php.
 * This file exists so that split has real behavioral coverage, not just a
 * grants audit.
 */
test('minting a code for an existing org creates the code and an audit row, attributed to its owner', function () {
    $orgId = $this->makeOrganization('mint-org');
    $locationId = $this->makeLocation($orgId);
    $userId = $this->makeUser('mint-owner');
    $membershipId = $this->makeMembership($userId, $orgId, ['role' => 'owner', 'is_active' => true]);

    $this->artisan('clintra:mint-activation-code', ['org_id' => $orgId, 'location_id' => $locationId])
        ->assertExitCode(0);

    $codeRow = $this->fx()->table('activation_codes')->where('org_id', $orgId)->first();
    expect($codeRow)->not->toBeNull();
    expect($codeRow->location_id)->toBe($locationId);
    expect($codeRow->used_at)->toBeNull();

    $auditRow = $this->fx()->table('audit_log')->where('org_id', $orgId)->where('entity', 'activation_codes')->first();
    expect($auditRow)->not->toBeNull();
    expect($auditRow->actor_membership_id)->toBe($membershipId);
    expect($auditRow->action)->toBe('create');

    // The code's own hash must never appear in its audit snapshot.
    $after = json_decode($auditRow->after, associative: true);
    expect($after)->not->toHaveKey('code_hash');

    $this->fx()->table('audit_log')->where('org_id', $orgId)->delete();
    $this->fx()->table('activation_codes')->where('id', $codeRow->id)->delete();
});

test('clintra_app cannot execute mint_activation_code directly', function () {
    $caught = null;

    try {
        $this->asApp()->select("select mint_activation_code('{}'::jsonb)");
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('clintra_app should not be able to call mint_activation_code at all');
    expect($caught->getCode())->toBe('42501');
});
