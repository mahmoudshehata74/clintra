<?php

use Illuminate\Support\Str;

/**
 * Invoice item editing (docs/schema.md's "Invoice item editing"): an
 * invoice's items and total change only while it has no payment; once one
 * exists, an edit is `invoice_has_payment`. App\Support\Sync\SyncOpApplier.
 */

/**
 * An unpaid invoice of 400.00 with one item, pushed by this device.
 *
 * @return array{credential: array, invoice: array, item: array, serviceId: string}
 */
function unpaidInvoiceFixture(?array $credential = null): array
{
    $credential ??= makeAuthenticatedDevice();
    $refs = invoiceReferences($credential['orgId']);
    $serviceId = (string) Str::uuid();
    test()->fx()->table('services')->insert([
        'id' => $serviceId,
        'org_id' => $credential['orgId'],
        'name' => 'كشف',
        'duration_minutes' => 20,
        'default_price' => 40000,
        'is_active' => true,
    ]);
    $invoice = invoiceOp($credential, $refs, deviceSeriesOf($credential['deviceId']), 1);
    $item = invoiceItemOp($invoice['entity_id'], $serviceId);
    pushOps($credential['token'], [$invoice, $item])->assertOk()->assertJson(['results' => [
        ['op_id' => $invoice['op_id'], 'status' => 'accepted'],
        ['op_id' => $item['op_id'], 'status' => 'accepted'],
    ]]);

    return ['credential' => $credential, 'invoice' => $invoice, 'item' => $item, 'serviceId' => $serviceId];
}

function invoiceItemOp(string $invoiceId, string $serviceId, array $overrides = []): array
{
    $entityId = $overrides['entity_id'] ?? (string) Str::uuid();

    return withBaseRev([
        'op_id' => (string) Str::uuid(),
        'entity' => 'invoice_items',
        'entity_id' => $entityId,
        'action' => $overrides['action'] ?? 'create',
        'payload' => array_merge([
            'id' => $entityId,
            'invoice_id' => $invoiceId,
            'service_id' => $serviceId,
            'description' => 'كشف',
            'qty' => 1,
            'unit_price' => 40000,
            'total' => 40000,
        ], $overrides['payload'] ?? []),
        'created_at' => now()->toIso8601String(),
    ], $overrides);
}

/** The invoice update an item edit pushes with it: the new total. */
function invoiceTotalOp(array $fixture, int $total, int $baseRev): array
{
    return [
        ...$fixture['invoice'],
        'op_id' => (string) Str::uuid(),
        'action' => 'update',
        'base_rev' => $baseRev,
        'payload' => [...$fixture['invoice']['payload'], 'total' => $total],
    ];
}

function forgetInvoiceItemFixture(string $orgId): void
{
    $fx = test()->fx();
    $invoiceIds = $fx->table('invoices')->where('org_id', $orgId)->pluck('id')->all();
    $itemIds = $fx->table('invoice_items')->whereIn('invoice_id', $invoiceIds)->pluck('id')->all();
    $fx->table('audit_log')->where('org_id', $orgId)->where('entity', 'invoice_items')->delete();
    $fx->table('sync_ledger')->where('org_id', $orgId)->where('entity', 'invoice_items')->delete();
    $fx->table('invoice_items')->whereIn('id', $itemIds)->delete();
    forgetNumberedRows($orgId);
    $fx->table('services')->where('org_id', $orgId)->delete();
}

test('an unpaid invoice accepts an item added, changed and removed, and its new total', function () {
    $fixture = unpaidInvoiceFixture();
    $credential = $fixture['credential'];
    $invoiceId = $fixture['invoice']['entity_id'];
    $changed = invoiceItemOp($invoiceId, $fixture['serviceId'], [
        'entity_id' => $fixture['item']['entity_id'],
        'action' => 'update',
        'payload' => ['qty' => 2, 'total' => 80000],
    ]);
    $added = invoiceItemOp($invoiceId, $fixture['serviceId'], ['payload' => ['unit_price' => 15000, 'total' => 15000]]);
    $total = invoiceTotalOp($fixture, 95000, 1);

    pushOps($credential['token'], [$changed, $added, $total])->assertOk()->assertJson(['results' => [
        ['op_id' => $changed['op_id'], 'status' => 'accepted', 'rev' => 2],
        ['op_id' => $added['op_id'], 'status' => 'accepted'],
        ['op_id' => $total['op_id'], 'status' => 'accepted', 'rev' => 2],
    ]]);

    $removed = invoiceItemOp($invoiceId, $fixture['serviceId'], ['entity_id' => $added['entity_id'], 'action' => 'delete', 'payload' => []]);
    $removed['payload'] = null;
    pushOps($credential['token'], [$removed, invoiceTotalOp($fixture, 80000, 2)])->assertOk()->assertJson(['results' => [
        ['status' => 'accepted'],
        ['status' => 'accepted', 'rev' => 3],
    ]]);

    expect((int) $this->fx()->table('invoices')->where('id', $invoiceId)->value('total'))->toBe(80000);
    expect($this->fx()->table('invoice_items')->where('invoice_id', $invoiceId)->pluck('qty')->all())->toBe([2]);

    forgetInvoiceItemFixture($credential['orgId']);
});

test('once the invoice has a payment, every item write and a new total are invoice_has_payment; the payment itself goes through', function () {
    $fixture = unpaidInvoiceFixture();
    $credential = $fixture['credential'];
    $invoiceId = $fixture['invoice']['entity_id'];
    $series = deviceSeriesOf($credential['deviceId']);
    $payment = paymentOp($credential, $invoiceId, $series, '1');
    $paid = [
        ...invoiceTotalOp($fixture, 40000, 1),
        'payload' => [...$fixture['invoice']['payload'], 'paid' => 10000, 'status' => 'partial'],
    ];
    pushOps($credential['token'], [$payment, $paid])->assertOk()->assertJson(['results' => [
        ['op_id' => $payment['op_id'], 'status' => 'accepted'],
        ['op_id' => $paid['op_id'], 'status' => 'accepted', 'rev' => 2],
    ]]);

    $ops = [
        invoiceItemOp($invoiceId, $fixture['serviceId'], ['entity_id' => $fixture['item']['entity_id'], 'action' => 'update', 'payload' => ['qty' => 3, 'total' => 120000]]),
        invoiceItemOp($invoiceId, $fixture['serviceId']),
        [...invoiceItemOp($invoiceId, $fixture['serviceId'], ['entity_id' => $fixture['item']['entity_id'], 'action' => 'delete']), 'payload' => null],
        [...invoiceTotalOp($fixture, 120000, 2), 'payload' => [...$paid['payload'], 'total' => 120000]],
    ];

    foreach ($ops as $op) {
        pushOps($credential['token'], [$op])->assertOk()
            ->assertJson(['results' => [['op_id' => $op['op_id'], 'status' => 'rejected', 'reason' => 'invoice_has_payment']]]);
    }

    expect((int) $this->fx()->table('invoices')->where('id', $invoiceId)->value('total'))->toBe(40000);
    expect($this->fx()->table('invoice_items')->where('invoice_id', $invoiceId)->count())->toBe(1);
    expect((int) $this->fx()->table('invoice_items')->where('id', $fixture['item']['entity_id'])->value('qty'))->toBe(1);

    forgetInvoiceItemFixture($credential['orgId']);
});

test('an item write against another org\'s invoice is refused, and never says whether it is paid', function () {
    $other = unpaidInvoiceFixture();
    $otherInvoiceId = $other['invoice']['entity_id'];
    pushOps($other['credential']['token'], [paymentOp($other['credential'], $otherInvoiceId, deviceSeriesOf($other['credential']['deviceId']), '1')])->assertOk();
    $mine = unpaidInvoiceFixture();
    $credential = $mine['credential'];

    $ops = [
        invoiceItemOp($otherInvoiceId, $mine['serviceId']),
        invoiceItemOp($otherInvoiceId, $mine['serviceId'], ['entity_id' => $other['item']['entity_id'], 'action' => 'update', 'payload' => ['qty' => 5, 'total' => 200000]]),
    ];

    foreach ($ops as $op) {
        $result = pushOps($credential['token'], [$op])->assertOk()->json('results.0');
        expect($result['status'])->not->toBe('accepted');
        expect($result['reason'] ?? null)->not->toBe('invoice_has_payment');
    }

    expect($this->fx()->table('invoice_items')->where('invoice_id', $otherInvoiceId)->count())->toBe(1);
    expect((int) $this->fx()->table('invoice_items')->where('id', $other['item']['entity_id'])->value('qty'))->toBe(1);

    forgetInvoiceItemFixture($credential['orgId']);
    forgetInvoiceItemFixture($other['credential']['orgId']);
});
