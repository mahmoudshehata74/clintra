<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

// The write half of the hole described in api/docs/rls.md's "A worked
// failure" section: specialty_templates/form_definitions originally shared
// one policy expression between USING and WITH CHECK, so any org's
// membership could create or corrupt system-wide (org_id IS NULL) rows, not
// just read them. Fixed in
// 2026_09_11_170030_split_specialty_template_write_policies.php — these
// tests pin that fix down.
test('a membership cannot insert a system-wide (org_id null) specialty template', function () {
    $orgA = $this->makeOrganization('org-a');
    $userA = $this->makeUser('user-a');
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);

    $caught = null;

    try {
        $this->withMembership($this->asApp(), $membershipA, function ($db) {
            $db->table('specialty_templates')->insert([
                'id' => (string) Str::uuid(),
                'org_id' => null,
                'key' => 'rogue',
                'name' => 'Rogue',
                'generation' => 'none',
                'pricing_mode' => 'per_item',
                'unit_label' => 'unit',
                'provider_label' => 'provider',
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('inserting an org_id-null template should be rejected');
    expect($caught->getCode())->toBe('42501');
});

test('a membership cannot update or delete a system-wide specialty template', function () {
    $systemTemplateId = $this->makeSpecialtyTemplate(null, 'general');

    $orgA = $this->makeOrganization('org-a');
    $userA = $this->makeUser('user-a');
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);

    $this->withMembership($this->asApp(), $membershipA, function ($db) use ($systemTemplateId) {
        $updated = $db->table('specialty_templates')->where('id', $systemTemplateId)->update(['name' => 'HACKED']);
        expect($updated)->toBe(0);

        $deleted = $db->table('specialty_templates')->where('id', $systemTemplateId)->delete();
        expect($deleted)->toBe(0);
    });

    expect($this->fx()->table('specialty_templates')->where('id', $systemTemplateId)->where('name', 'General')->exists())->toBeTrue();
});

test('a membership cannot insert a form_definition under a system-wide template', function () {
    $systemTemplateId = $this->makeSpecialtyTemplate(null, 'general');

    $orgA = $this->makeOrganization('org-a');
    $userA = $this->makeUser('user-a');
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);

    $caught = null;

    try {
        $this->withMembership($this->asApp(), $membershipA, function ($db) use ($systemTemplateId) {
            $db->table('form_definitions')->insert([
                'id' => (string) Str::uuid(),
                'template_id' => $systemTemplateId,
                'version' => 1,
                'schema' => json_encode(['fields' => []]),
                'is_current' => true,
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('inserting a form_definition under a system template should be rejected');
    expect($caught->getCode())->toBe('42501');
});

test('a membership cannot update, delete, or attach a form_definition to another org\'s specialty template', function () {
    $orgA = $this->makeOrganization('org-a');
    $userA = $this->makeUser('user-a');
    $membershipA = $this->makeMembership($userA, $orgA, ['role' => 'owner']);

    $orgB = $this->makeOrganization('org-b');
    $orgBTemplateId = $this->makeSpecialtyTemplate($orgB, 'org-b-only');

    $this->withMembership($this->asApp(), $membershipA, function ($db) use ($orgBTemplateId) {
        $updated = $db->table('specialty_templates')->where('id', $orgBTemplateId)->update(['name' => 'HACKED']);
        expect($updated)->toBe(0);

        $deleted = $db->table('specialty_templates')->where('id', $orgBTemplateId)->delete();
        expect($deleted)->toBe(0);
    });

    expect($this->fx()->table('specialty_templates')->where('id', $orgBTemplateId)->where('name', 'General')->exists())->toBeTrue();

    $caught = null;

    try {
        $this->withMembership($this->asApp(), $membershipA, function ($db) use ($orgBTemplateId) {
            $db->table('form_definitions')->insert([
                'id' => (string) Str::uuid(),
                'template_id' => $orgBTemplateId,
                'version' => 1,
                'schema' => json_encode(['fields' => []]),
                'is_current' => true,
            ]);
        });
    } catch (QueryException $e) {
        $caught = $e;
    }

    expect($caught)->not->toBeNull('attaching a form_definition to another org\'s template should be rejected');
    expect($caught->getCode())->toBe('42501');
});
