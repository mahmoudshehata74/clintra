<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * 2026_09_12_000011_enforce_audit_attribution.php: audit_log_insert's
 * WITH CHECK now requires actor_membership_id = current_membership(), not
 * just org_id = current_org(). Before this, any membership could insert an
 * audit row naming a different membership in the same org as the actor —
 * the audit trail is the only record of who did what, so a forgeable actor
 * column made it worthless as evidence (docs/sync-plan.md's Q13).
 */
test('a membership can insert an audit row attributed to itself', function () {
    $org = $this->makeOrganization('audit-attrib-org');
    $user = $this->makeUser('audit-attrib-user');
    $membership = $this->makeMembership($user, $org, ['role' => 'owner']);

    $caught = null;

    try {
        $this->withMembership($this->asApp(), $membership, function ($db) use ($org, $membership) {
            $db->table('audit_log')->insert([
                'id' => (string) Str::uuid(),
                'org_id' => $org,
                'actor_membership_id' => $membership,
                'entity' => 'patients',
                'entity_id' => (string) Str::uuid(),
                'action' => 'create',
                'before' => null,
                'after' => json_encode(['id' => 'x']),
                'at' => now()->toIso8601String(),
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->toBeNull('a membership must be able to write an audit row attributed to itself');

    $row = $this->fx()->table('audit_log')->where('org_id', $org)->first();
    expect($row)->not->toBeNull();
    expect($row->actor_membership_id)->toBe($membership);

    $this->fx()->table('audit_log')->where('org_id', $org)->delete();
});

test('a membership cannot insert an audit row attributed to a different membership in the same org', function () {
    $org = $this->makeOrganization('audit-attrib-org-2');
    $userA = $this->makeUser('audit-attrib-user-a');
    $userB = $this->makeUser('audit-attrib-user-b');
    $membershipA = $this->makeMembership($userA, $org, ['role' => 'owner']);
    $membershipB = $this->makeMembership($userB, $org, ['role' => 'assistant']);

    $caught = null;

    try {
        // Acting as membershipA, but naming membershipB as the actor.
        $this->withMembership($this->asApp(), $membershipA, function ($db) use ($org, $membershipB) {
            $db->table('audit_log')->insert([
                'id' => (string) Str::uuid(),
                'org_id' => $org,
                'actor_membership_id' => $membershipB,
                'entity' => 'patients',
                'entity_id' => (string) Str::uuid(),
                'action' => 'create',
                'before' => null,
                'after' => json_encode(['id' => 'x']),
                'at' => now()->toIso8601String(),
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('the RLS policy must reject misattribution, not silently accept it');
    expect($caught->getCode())->toBe('42501');

    // Nothing was written — the row must not exist under any actor.
    $rows = $this->fx()->table('audit_log')->where('org_id', $org)->get();
    expect($rows)->toHaveCount(0);
});

test('a cross-org audit insert is still rejected (org scoping unchanged by the new check)', function () {
    $orgA = $this->makeOrganization('audit-attrib-org-cross-a');
    $orgB = $this->makeOrganization('audit-attrib-org-cross-b');
    $userA = $this->makeUser('audit-attrib-cross-user');
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);

    $caught = null;

    try {
        // membershipA acting, naming itself as actor (correct), but org_id
        // points at orgB — the pre-existing check this migration must not
        // have weakened.
        $this->withMembership($this->asApp(), $membershipA, function ($db) use ($orgB, $membershipA) {
            $db->table('audit_log')->insert([
                'id' => (string) Str::uuid(),
                'org_id' => $orgB,
                'actor_membership_id' => $membershipA,
                'entity' => 'patients',
                'entity_id' => (string) Str::uuid(),
                'action' => 'create',
                'before' => null,
                'after' => json_encode(['id' => 'x']),
                'at' => now()->toIso8601String(),
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('cross-org insert must still be rejected');
    expect($caught->getCode())->toBe('42501');
});
