<?php

use Illuminate\Database\QueryException;

/**
 * 2026_09_12_000018_lock_closed_day_state.php: once day_state.is_closed
 * is true, the row can never be modified or deleted — enforced by a
 * trigger, not an RLS policy, so it holds regardless of role (see that
 * migration's own doc comment for why a trigger is the tighter
 * guarantee). The brief is silent on whether a closed day is immutable;
 * this is a standing decision, not a brief requirement.
 */
test('a closed day rejects UPDATE and DELETE through clintra_app', function () {
    $org = $this->makeOrganization();
    $user = $this->makeUser();
    $membership = $this->makeMembership($user, $org, ['role' => 'owner']);
    $location = $this->makeLocation($org);
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($org, $specialtyId);
    $dayStateId = $this->makeDayState($practitionerId, $location, now()->addDay()->toDateString(), ['is_closed' => true]);

    $updateCaught = null;
    $deleteCaught = null;

    $this->withMembership($this->asApp(), $membership, function ($db) use ($dayStateId, &$updateCaught) {
        try {
            $db->table('day_state')->where('id', $dayStateId)->update(['delay_minutes' => 10]);
        } catch (QueryException $e) {
            $updateCaught = $e;
        }
    });

    $this->withMembership($this->asApp(), $membership, function ($db) use ($dayStateId, &$deleteCaught) {
        try {
            $db->table('day_state')->where('id', $dayStateId)->delete();
        } catch (QueryException $e) {
            $deleteCaught = $e;
        }
    });

    expect($updateCaught)->not->toBeNull('a closed day must reject UPDATE, not silently no-op or succeed');
    expect($updateCaught->getCode())->toBe('55000');
    expect($deleteCaught)->not->toBeNull('a closed day must reject DELETE, not silently no-op or succeed');
    expect($deleteCaught->getCode())->toBe('55000');

    $row = $this->fx()->table('day_state')->where('id', $dayStateId)->first();
    expect($row)->not->toBeNull();
    expect($row->delay_minutes)->toBe(0);

    // The trigger blocks every role, including clintra_fixtures — Pest's
    // own automatic fixture cleanup would hit the exact same rejection
    // this test just proved, so this row has to be removed here, with the
    // trigger explicitly disabled, rather than left for that cleanup.
    $this->asOwner()->statement('ALTER TABLE day_state DISABLE TRIGGER day_state_immutable_when_closed');
    $this->fx()->table('day_state')->where('id', $dayStateId)->delete();
    $this->asOwner()->statement('ALTER TABLE day_state ENABLE TRIGGER day_state_immutable_when_closed');
});

test('an open day still accepts UPDATE and DELETE through clintra_app', function () {
    $org = $this->makeOrganization();
    $user = $this->makeUser();
    $membership = $this->makeMembership($user, $org, ['role' => 'owner']);
    $location = $this->makeLocation($org);
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($org, $specialtyId);
    $dayStateId = $this->makeDayState($practitionerId, $location, now()->addDay()->toDateString(), ['is_closed' => false]);

    $this->withMembership($this->asApp(), $membership, function ($db) use ($dayStateId) {
        $updated = $db->table('day_state')->where('id', $dayStateId)->update(['delay_minutes' => 10]);
        expect($updated)->toBe(1);
    });

    expect($this->fx()->table('day_state')->where('id', $dayStateId)->value('delay_minutes'))->toBe(10);

    $this->withMembership($this->asApp(), $membership, function ($db) use ($dayStateId) {
        $deleted = $db->table('day_state')->where('id', $dayStateId)->delete();
        expect($deleted)->toBe(1);
    });

    expect($this->fx()->table('day_state')->where('id', $dayStateId)->exists())->toBeFalse();
});

test('closing a day (is_closed false to true) is still allowed — only a row already closed is locked', function () {
    $org = $this->makeOrganization();
    $user = $this->makeUser();
    $membership = $this->makeMembership($user, $org, ['role' => 'owner']);
    $location = $this->makeLocation($org);
    $specialtyId = $this->makeSpecialtyTemplate(null);
    $practitionerId = $this->makePractitioner($org, $specialtyId);
    $dayStateId = $this->makeDayState($practitionerId, $location, now()->addDay()->toDateString(), ['is_closed' => false]);

    $this->withMembership($this->asApp(), $membership, function ($db) use ($dayStateId) {
        $updated = $db->table('day_state')->where('id', $dayStateId)->update(['is_closed' => true]);
        expect($updated)->toBe(1);
    });

    expect($this->fx()->table('day_state')->where('id', $dayStateId)->value('is_closed'))->toBeTrue();

    // The trigger blocks every role, including clintra_fixtures — the
    // whole point of choosing it over an RLS policy. Cleanup has to
    // disable it explicitly for this one row, the same way other fixture
    // cleanup here works around a real constraint rather than the test
    // relying on this table's own connection to bypass it.
    $this->asOwner()->statement('ALTER TABLE day_state DISABLE TRIGGER day_state_immutable_when_closed');
    $this->fx()->table('day_state')->where('id', $dayStateId)->delete();
    $this->asOwner()->statement('ALTER TABLE day_state ENABLE TRIGGER day_state_immutable_when_closed');
});
