<?php

// The owner-bypass trap (api/docs/rls.md): RLS does not apply to a table's
// owner by default. FORCE ROW LEVEL SECURITY is what makes clintra_owner —
// who creates and owns every table — just as blocked as clintra_app when no
// membership is declared, for every ordinary, tenant-scoped table.
test('clintra_owner with no membership set sees zero rows on tenant-scoped tables', function () {
    $orgId = $this->makeOrganization();
    $locationId = $this->makeLocation($orgId);
    $userId = $this->makeUser();
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($orgId, $specialtyId);
    $membershipId = $this->makeMembership($userId, $orgId, ['role' => 'owner']);
    $patientId = $this->makePatient($orgId);
    $this->makeVisit($orgId, $locationId, $practitionerId, $patientId, $membershipId);

    expect($this->asOwner()->table('organizations')->count())->toBe(0);
    expect($this->asOwner()->table('patients')->count())->toBe(0);
    expect($this->asOwner()->table('visits')->count())->toBe(0);

    // specialty_templates is NOT part of this "zero rows" claim — see the
    // next test. Its policy is deliberately different: the reference-data
    // fixture created above (org_id IS NULL) IS visible to clintra_owner
    // here, by design (api/docs/rls.md's "Owner-only policies for
    // system-wide reference data"), not a gap in this test.
});

// Deliberate exception to the blanket "owner sees zero rows without a
// membership" claim above: 2026_09_11_170031_add_owner_reference_data_policies.php
// gave clintra_owner its own SELECT policy on specialty_templates/
// form_definitions, scoped to org_id IS NULL (system-wide rows) only, and
// that policy does not depend on current_org()/a membership at all — it's
// keyed on the connecting role, not on any session-scoped state. So
// clintra_owner sees system-wide reference rows with or without a
// membership declared; it must still see zero for anything org-scoped.
// Documented here explicitly rather than silently narrowing the test above
// to exclude these two tables.
test('clintra_owner with no membership set sees system-wide reference rows, but never org-scoped ones', function () {
    $systemTemplateId = $this->makeSpecialtyTemplate(null, 'owner-visibility-system');
    $this->makeFormDefinition($systemTemplateId, ['version' => 1]);

    $orgId = $this->makeOrganization();
    $orgTemplateId = $this->makeSpecialtyTemplate($orgId, 'owner-visibility-org-scoped');

    $visibleTemplateIds = $this->asOwner()->table('specialty_templates')->pluck('id')->all();
    expect($visibleTemplateIds)->toContain($systemTemplateId);
    expect($visibleTemplateIds)->not->toContain($orgTemplateId);

    $visibleFormDefinitionIds = $this->asOwner()->table('form_definitions')
        ->where('template_id', $systemTemplateId)
        ->pluck('id')->all();
    expect($visibleFormDefinitionIds)->not->toBeEmpty();
});
