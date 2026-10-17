<?php

use App\Support\Sync\SyncableTables;
use Illuminate\Support\Str;

/**
 * The actor columns (SyncableTables::ACTOR_COLUMNS) name the person who
 * acted on the device, not the token's membership: a same-org claim is kept,
 * a claim outside the organization is refused as `actor_not_in_org`, and an
 * absent claim falls back to the token's membership. The ledger and the
 * server's own audit_log keep the token's membership either way. See
 * api/docs/rls.md's "Actor attribution".
 */

/** @return array{credential: array, assistantId: string, practitionerId: string, patientId: string} */
function actorFixture(): array
{
    $test = test();
    $credential = makeAuthenticatedDevice();

    return [
        'credential' => $credential,
        'assistantId' => $test->makeMembership($test->makeUser('assistant'), $credential['orgId'], ['role' => 'assistant']),
        'practitionerId' => $test->makePractitioner($credential['orgId'], $test->makeSpecialtyTemplate(null)),
        'patientId' => $test->makePatient($credential['orgId']),
    ];
}

/** A visit create as the device pushes it; `created_by` is the claim, left out when null. */
function actorVisitOp(array $fixture, ?string $createdBy, int $position = 1): array
{
    $visitId = (string) Str::uuid();
    $payload = [
        'id' => $visitId,
        'org_id' => $fixture['credential']['orgId'],
        'location_id' => $fixture['credential']['locationId'],
        'practitioner_id' => $fixture['practitionerId'],
        'patient_id' => $fixture['patientId'],
        'visit_date' => now()->addDay()->toDateString(),
        'position' => $position,
        'status' => 'booked',
        'is_overbooked' => false,
        'source' => 'walkin',
        'created_by' => $createdBy,
        'created_at' => now()->toIso8601String(),
    ];

    if ($createdBy === null) {
        unset($payload['created_by']);
    }

    return [
        'op_id' => (string) Str::uuid(),
        'entity' => 'visits',
        'entity_id' => $visitId,
        'action' => 'create',
        'payload' => $payload,
        'created_at' => now()->toIso8601String(),
    ];
}

/** Removes every row a test pushed for this org, with its ledger and audit rows, children first. */
function forgetActorRows(string $orgId): void
{
    $fx = test()->fx();
    $locationIds = $fx->table('locations')->where('org_id', $orgId)->pluck('id')->all();
    $invoiceIds = $fx->table('invoices')->where('org_id', $orgId)->pluck('id')->all();

    $fx->table('audit_log')->where('org_id', $orgId)->delete();
    $fx->table('sync_ledger')->where('org_id', $orgId)->delete();
    $fx->table('payments')->whereIn('invoice_id', $invoiceIds)->delete();
    $fx->table('invoices')->whereIn('id', $invoiceIds)->delete();
    $fx->table('prescriptions')->where('org_id', $orgId)->delete();
    $fx->table('messages')->where('org_id', $orgId)->delete();
    $fx->table('message_templates')->where('org_id', $orgId)->delete();
    $fx->table('cash_close')->whereIn('location_id', $locationIds)->delete();
    $fx->table('visits')->where('org_id', $orgId)->delete();
}

/**
 * Runs `$body` with a fresh fixture and then removes what it pushed, even
 * when an assertion fails: the fixtures' own cleanup cannot delete a
 * patient a pushed visit still points at.
 */
function withActorFixture(Closure $body): void
{
    $fixture = actorFixture();

    try {
        $body($fixture);
    } finally {
        forgetActorRows($fixture['credential']['orgId']);
    }
}

/** The claim a test puts in the actor column; ACTOR_ABSENT leaves the column out of the payload. */
const ACTOR_ABSENT = '__absent__';

/** `$op` with its payload's `$column` set to `$claim`, or without it for ACTOR_ABSENT. */
function withClaim(array $op, string $column, ?string $claim): array
{
    if ($claim === ACTOR_ABSENT) {
        unset($op['payload'][$column]);
    } else {
        $op['payload'][$column] = $claim;
    }

    return $op;
}

/**
 * The ops that create one `$table` row whose actor column carries `$claim`:
 * whatever the row needs first, with the token's own membership as actor,
 * and the row's own op last.
 *
 * @return list<array>
 */
function actorCreateOps(string $table, array $fixture, ?string $claim): array
{
    $credential = $fixture['credential'];
    $column = SyncableTables::actorColumn($table);
    $refs = ['practitionerId' => $fixture['practitionerId'], 'patientId' => $fixture['patientId']];

    if ($table === 'visits') {
        return [withClaim(actorVisitOp($fixture, $credential['membershipId']), $column, $claim)];
    }

    if ($table === 'payments') {
        $invoice = invoiceOp($credential, $refs, 1, 1);

        return [$invoice, withClaim(paymentOp($credential, $invoice['entity_id'], 1, '1'), $column, $claim)];
    }

    if ($table === 'prescriptions') {
        $visit = actorVisitOp($fixture, $credential['membershipId']);

        return [$visit, withClaim(prescriptionOp($credential, $refs + ['visitId' => $visit['entity_id']], 1, 1), $column, $claim)];
    }

    if ($table === 'messages') {
        return [withClaim(messageOp(messageRow($credential, $fixture['patientId'])), $column, $claim)];
    }

    if ($table === 'message_templates') {
        return [withClaim(templateOp(templateRow($credential)), $column, $claim)];
    }

    $id = (string) Str::uuid();

    return [withClaim([
        'op_id' => (string) Str::uuid(),
        'entity' => 'cash_close',
        'entity_id' => $id,
        'action' => 'create',
        'payload' => [
            'id' => $id,
            'location_id' => $credential['locationId'],
            'date' => now()->toDateString(),
            'total_expected' => 30000,
            'total_collected' => 30000,
            'difference' => 0,
            'difference_note' => null,
            'closed_by' => $credential['membershipId'],
            'closed_at' => now()->toIso8601String(),
        ],
        'created_at' => now()->toIso8601String(),
    ], $column, $claim)];
}

/** Pushes `$ops` and returns the last op's result, every earlier one having been accepted. */
function pushActorOps(array $fixture, array $ops): array
{
    $results = pushOps($fixture['credential']['token'], $ops)->assertOk()->json('results');

    foreach (array_slice($results, 0, -1) as $result) {
        expect($result['status'])->toBe('accepted');
    }

    return end($results);
}

test('an owner-token push of a visit booked by the assistant is stored with the assistant', function () {
    withActorFixture(function (array $fixture) {
        $op = actorVisitOp($fixture, $fixture['assistantId']);

        pushOps($fixture['credential']['token'], [$op])
            ->assertOk()
            ->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'accepted']]]);

        expect(test()->fx()->table('visits')->where('id', $op['entity_id'])->value('created_by'))->toBe($fixture['assistantId']);
    });
});

dataset('actor columns', array_keys(SyncableTables::ACTOR_COLUMNS));

test('a same-org claim is kept in the actor column; the ledger and audit_log keep the token\'s membership', function (string $table) {
    withActorFixture(function (array $fixture) use ($table) {
        $ops = actorCreateOps($table, $fixture, $fixture['assistantId']);
        $op = end($ops);

        expect(pushActorOps($fixture, $ops))->toMatchArray(['op_id' => $op['op_id'], 'status' => 'accepted']);

        $fx = test()->fx();
        $tokenMembership = $fixture['credential']['membershipId'];
        expect($fx->table($table)->where('id', $op['entity_id'])->value(SyncableTables::actorColumn($table)))->toBe($fixture['assistantId']);
        expect($fx->table('sync_ledger')->where('op_id', $op['op_id'])->value('actor_membership_id'))->toBe($tokenMembership);
        expect($fx->table('audit_log')->where('entity_id', $op['entity_id'])->pluck('actor_membership_id')->all())->toBe([$tokenMembership]);
    });
})->with('actor columns');

test('a claim naming another organization\'s membership is rejected as actor_not_in_org and writes nothing', function (string $table) {
    $outsider = makeAuthenticatedDevice()['membershipId'];

    withActorFixture(function (array $fixture) use ($table, $outsider) {
        $ops = actorCreateOps($table, $fixture, $outsider);
        $op = end($ops);

        expect(pushActorOps($fixture, $ops))->toBe(['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'actor_not_in_org']);

        $fx = test()->fx();
        expect($fx->table($table)->where('id', $op['entity_id'])->exists())->toBeFalse();
        expect($fx->table('sync_ledger')->where('op_id', $op['op_id'])->exists())->toBeFalse();
        expect($fx->table('audit_log')->where('entity_id', $op['entity_id'])->exists())->toBeFalse();
    });
})->with('actor columns');

test('an absent claim falls back to the token\'s membership', function (string $table, ?string $claim) {
    withActorFixture(function (array $fixture) use ($table, $claim) {
        $ops = actorCreateOps($table, $fixture, $claim);
        $op = end($ops);

        expect(pushActorOps($fixture, $ops))->toMatchArray(['op_id' => $op['op_id'], 'status' => 'accepted']);
        expect(test()->fx()->table($table)->where('id', $op['entity_id'])->value(SyncableTables::actorColumn($table)))
            ->toBe($fixture['credential']['membershipId']);
    });
})->with('actor columns')->with(['left out' => ACTOR_ABSENT, 'null' => null]);

test('a claim that is no membership at all, or no uuid, is rejected as actor_not_in_org', function (string $claim) {
    withActorFixture(function (array $fixture) use ($claim) {
        $op = actorVisitOp($fixture, $claim);

        expect(pushActorOps($fixture, [$op]))->toBe(['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'actor_not_in_org']);
        expect(test()->fx()->table('visits')->where('id', $op['entity_id'])->exists())->toBeFalse();
    });
})->with(['an unknown uuid' => fn () => (string) Str::uuid(), 'not a uuid' => 'assistant']);

test('a deactivated member of the organization is still a valid claim (a row written offline before the deactivation)', function () {
    withActorFixture(function (array $fixture) {
        test()->fx()->table('memberships')->where('id', $fixture['assistantId'])->update(['is_active' => false]);
        $op = actorVisitOp($fixture, $fixture['assistantId']);

        expect(pushActorOps($fixture, [$op]))->toMatchArray(['op_id' => $op['op_id'], 'status' => 'accepted']);
        expect(test()->fx()->table('visits')->where('id', $op['entity_id'])->value('created_by'))->toBe($fixture['assistantId']);
    });
});

test('the owner editing the assistant\'s booking keeps the assistant as its creator', function () {
    withActorFixture(function (array $fixture) {
        $create = actorVisitOp($fixture, $fixture['assistantId']);
        pushActorOps($fixture, [$create]);

        // The device sends the whole row, its created_by unchanged.
        $update = [
            'op_id' => (string) Str::uuid(),
            'entity' => 'visits',
            'entity_id' => $create['entity_id'],
            'action' => 'update',
            'payload' => array_merge($create['payload'], ['status' => 'arrived']),
            'created_at' => now()->toIso8601String(),
            'base_rev' => 1,
        ];

        expect(pushActorOps($fixture, [$update]))->toMatchArray(['op_id' => $update['op_id'], 'status' => 'accepted', 'rev' => 2]);
        $row = test()->fx()->table('visits')->where('id', $create['entity_id'])->first();
        expect([$row->status, $row->created_by])->toBe(['arrived', $fixture['assistantId']]);
    });
});

test('a message marked sent keeps its creator; the update\'s claim is not checked, since it is not written', function () {
    $outsider = makeAuthenticatedDevice()['membershipId'];

    withActorFixture(function (array $fixture) use ($outsider) {
        $row = messageRow($fixture['credential'], $fixture['patientId'], ['created_by' => $fixture['assistantId']]);
        pushActorOps($fixture, [messageOp($row)]);

        $mark = messageOp(array_merge($row, ['created_by' => $outsider, 'marked_sent_at' => now()->toIso8601String()]), 'update', 1);

        expect(pushActorOps($fixture, [$mark]))->toMatchArray(['op_id' => $mark['op_id'], 'status' => 'accepted', 'rev' => 2]);
        expect(test()->fx()->table('messages')->where('id', $row['id'])->value('created_by'))->toBe($fixture['assistantId']);
    });
});
