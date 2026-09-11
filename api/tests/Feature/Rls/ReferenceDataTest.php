<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * @return array{specialty_templates: list<array<string, mixed>>, form_definitions: list<array<string, mixed>>}
 */
function referenceData(): array
{
    return json_decode(
        file_get_contents(base_path('../contract/reference-data.json')),
        associative: true,
        flags: JSON_THROW_ON_ERROR,
    );
}

// contract/reference-data.json's rows must exist with exactly the ids the
// contract declares — every client and the server reference the same id for
// the same reference row (contract/README.md).
test('the contract reference-data rows exist with exactly the contract ids', function () {
    $data = referenceData();

    foreach ($data['specialty_templates'] as $template) {
        $row = $this->asOwner()->table('specialty_templates')->where('id', $template['id'])->first();

        expect($row)->not->toBeNull("specialty_templates row {$template['id']} is missing");
        expect($row->key)->toBe($template['key']);
    }

    foreach ($data['form_definitions'] as $definition) {
        $row = $this->asOwner()->table('form_definitions')->where('id', $definition['id'])->first();

        expect($row)->not->toBeNull("form_definitions row {$definition['id']} is missing");
        expect($row->template_id)->toBe($definition['template_id']);
    }
});

test('a membership sees the contract reference-data rows; no membership sees none', function () {
    $data = referenceData();
    $templateIds = array_column($data['specialty_templates'], 'id');

    // No membership: covered generally by NoMembershipSeesNothingTest, but
    // confirmed here directly against the real seeded ids.
    $visibleWithNone = $this->asApp()->table('specialty_templates')->whereIn('id', $templateIds)->count();
    expect($visibleWithNone)->toBe(0);

    $orgId = $this->makeOrganization();
    $userId = $this->makeUser();
    $membershipId = $this->makeMembership($userId, $orgId, ['role' => 'owner']);

    $this->withMembership($this->asApp(), $membershipId, function ($db) use ($templateIds) {
        $visibleIds = $db->table('specialty_templates')->whereIn('id', $templateIds)->pluck('id')->all();

        expect($visibleIds)->toEqualCanonicalizing($templateIds);
    });
});

test('clintra_owner cannot insert or update an org-scoped specialty template through the owner-only policies', function () {
    $orgId = $this->makeOrganization();

    $caught = null;

    try {
        $this->asOwner()->transaction(function ($db) use ($orgId) {
            $db->table('specialty_templates')->insert([
                'id' => (string) Str::uuid(),
                'org_id' => $orgId,
                'key' => 'owner-org-scoped',
                'name' => 'Should be rejected',
                'generation' => 'none',
                'pricing_mode' => 'per_item',
                'unit_label' => 'unit',
                'provider_label' => 'provider',
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('clintra_owner inserting an org-scoped template should be rejected');
    expect($caught->getCode())->toBe('42501');

    $systemTemplateId = $this->makeSpecialtyTemplate(null, 'owner-update-probe');

    $caught = null;

    try {
        $this->asOwner()->table('specialty_templates')
            ->where('id', $systemTemplateId)
            ->update(['org_id' => $orgId]);
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('clintra_owner turning a system-wide template into an org-scoped one should be rejected');
    expect($caught->getCode())->toBe('42501');
});
