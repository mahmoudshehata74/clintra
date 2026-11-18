<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Str;

/**
 * cash_close.opening_amount (docs/schema.md's v24 additions,
 * 2026_09_12_000036_add_opening_amount_to_cash_close.php): the drawer's
 * opening float, piastres, NOT NULL DEFAULT 0, CHECK >= 0, synced with the
 * rest of the row.
 */
function cashCloseOp(array $credential, array $payload = []): array
{
    $id = (string) Str::uuid();

    return [
        'op_id' => (string) Str::uuid(),
        'entity' => 'cash_close',
        'entity_id' => $id,
        'action' => 'create',
        'payload' => array_merge([
            'id' => $id,
            'location_id' => $credential['locationId'],
            'date' => now()->toDateString(),
            'opening_amount' => 50000,
            'total_expected' => 80000,
            'total_collected' => 80000,
            'difference' => 0,
            'difference_note' => null,
            'closed_by' => $credential['membershipId'],
            'closed_at' => now()->toIso8601String(),
        ], $payload),
        'created_at' => now()->toIso8601String(),
    ];
}

function forgetCashCloses(array $credential): void
{
    $fx = test()->fx();
    $ids = $fx->table('cash_close')->where('location_id', $credential['locationId'])->pluck('id')->all();
    $fx->table('audit_log')->whereIn('entity_id', $ids)->delete();
    $fx->table('sync_ledger')->whereIn('entity_id', $ids)->delete();
    $fx->table('cash_close')->whereIn('id', $ids)->delete();
}

test('opening_amount is an integer, NOT NULL, defaulting to 0', function () {
    $column = $this->asOwner()->selectOne(<<<'SQL'
        SELECT data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'cash_close' AND column_name = 'opening_amount'
    SQL);

    expect($column->data_type)->toBe('integer');
    expect($column->is_nullable)->toBe('NO');
    expect($column->column_default)->toBe('0');
});

test('a negative opening_amount is refused by the CHECK', function () {
    $credential = makeAuthenticatedDevice();
    $row = cashCloseOp($credential, ['opening_amount' => -1])['payload'];

    expect(fn () => $this->fx()->table('cash_close')->insert($row))
        ->toThrow(QueryException::class, 'cash_close_opening_amount_check');
    expect($this->fx()->table('cash_close')->where('id', $row['id'])->exists())->toBeFalse();
});

test('a pushed close carries its opening_amount to the server and back in a pull', function () {
    $credential = makeAuthenticatedDevice();
    $op = cashCloseOp($credential);

    pushOps($credential['token'], [$op])->assertOk()
        ->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'accepted', 'rev' => 1]]]);

    expect((int) $this->fx()->table('cash_close')->where('id', $op['entity_id'])->value('opening_amount'))->toBe(50000);
    $row = collect(pullOps($credential['token'])->assertOk()->json('rows'))->firstWhere('entity_id', $op['entity_id']);
    expect($row['payload']['opening_amount'])->toBe(50000);
    expect($row['payload']['total_expected'])->toBe(80000);

    forgetCashCloses($credential);
});

test('a close pushed without opening_amount (a device not yet updated) stores 0; a negative one is never accepted', function () {
    $credential = makeAuthenticatedDevice();
    $old = cashCloseOp($credential);
    unset($old['payload']['opening_amount']);

    pushOps($credential['token'], [$old])->assertOk()->assertJson(['results' => [['status' => 'accepted']]]);
    expect((int) $this->fx()->table('cash_close')->where('id', $old['entity_id'])->value('opening_amount'))->toBe(0);

    $negative = cashCloseOp($credential, ['date' => now()->subDay()->toDateString(), 'opening_amount' => -100]);
    $result = pushOps($credential['token'], [$negative])->assertOk()->json('results.0');
    expect($result['status'])->not->toBe('accepted');
    expect($this->fx()->table('cash_close')->where('id', $negative['entity_id'])->exists())->toBeFalse();

    forgetCashCloses($credential);
});
