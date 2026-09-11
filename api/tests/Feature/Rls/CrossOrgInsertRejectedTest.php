<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

// WITH CHECK, not just USING: an INSERT that names another org's id must be
// rejected by Postgres itself, not merely hidden from a later SELECT. If the
// patients policy only had USING, this insert would silently succeed and
// then vanish from view — a worse bug than a visible failure.
test('an insert naming another org is rejected by the RLS policy, not silently dropped', function () {
    $orgA = $this->makeOrganization('org-a');
    $userA = $this->makeUser('user-a');
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);

    $orgB = $this->makeOrganization('org-b');

    $caught = null;

    try {
        $this->withMembership($this->asApp(), $membershipA, function ($db) use ($orgB) {
            $db->table('patients')->insert([
                'id' => (string) Str::uuid(),
                'org_id' => $orgB,
                'full_name' => 'cross-org patient',
                'created_at' => now()->toIso8601String(),
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('the insert should have been rejected, not silently accepted');
    expect($caught->getCode())->toBe('42501');
});
