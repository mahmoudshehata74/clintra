<?php

// specialty_templates' "visible to every org" behaviour (docs/schema.md) is
// deliberate for system-wide rows (org_id IS NULL) — this proves it still
// holds after closing the no-membership/cross-tenant-write hole (see
// api/docs/rls.md's "A worked failure" section): a real membership sees its
// own org's templates plus every system-wide one, and none of another org's.
test('a membership sees its own org\'s templates plus system-wide ones, and none of another org\'s', function () {
    $systemTemplateId = $this->makeSpecialtyTemplate(null, 'general');

    $orgA = $this->makeOrganization('org-a');
    $userA = $this->makeUser('user-a');
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);
    $orgATemplateId = $this->makeSpecialtyTemplate($orgA, 'org-a-only');

    $orgB = $this->makeOrganization('org-b');
    $orgBTemplateId = $this->makeSpecialtyTemplate($orgB, 'org-b-only');

    $this->withMembership($this->asApp(), $membershipA, function ($db) use ($systemTemplateId, $orgATemplateId, $orgBTemplateId) {
        $visibleIds = $db->table('specialty_templates')->pluck('id')->all();

        expect($visibleIds)->toContain($systemTemplateId);
        expect($visibleIds)->toContain($orgATemplateId);
        expect($visibleIds)->not->toContain($orgBTemplateId);
    });
});
