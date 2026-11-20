<?php

use App\Support\Identity\Es256;
use App\Support\Identity\ProofMessage;
use App\Support\Sync\Jcs;
use Tests\Support\TestKey;

/**
 * RFC 8785 against contract/jcs-cases.json — the vectors the web client's
 * implementation will be held to as well (docs/design-identity-permissions.md,
 * 3.5) — and the exact bytes of the three proof messages.
 */
test('JCS produces every canonical form in contract/jcs-cases.json', function () {
    $cases = json_decode(file_get_contents(__DIR__.'/../../../contract/jcs-cases.json'), true, flags: JSON_THROW_ON_ERROR)['cases'];

    expect($cases)->not->toBeEmpty();
    foreach ($cases as $case) {
        $value = json_decode($case['input'], associative: false, flags: JSON_THROW_ON_ERROR);
        expect(Jcs::canonicalize($value))->toBe($case['canonical'], $case['name']);
    }
});

test('JCS keeps an empty object and an empty array apart, and reads an associative array as an object', function () {
    expect(Jcs::canonicalize(json_decode('{"a":{},"b":[]}')))->toBe('{"a":{},"b":[]}');
    expect(Jcs::canonicalize(['z' => 1, 'a' => [1, 2]]))->toBe('{"a":[1,2],"z":1}');
});

test('the op message is the design\'s eleven lines, byte for byte', function () {
    $op = json_decode('{"op_id":"op-1","entity":"patients","entity_id":"p-1","action":"update","base_rev":3,"group_id":null,'
        .'"created_at":"2026-11-19T08:00:00.000Z","payload":{"full_name":"منى","id":"p-1"}}');

    expect(ProofMessage::op($op, 'dev-1', 'cred-1'))->toBe(implode("\n", [
        'clintra-op-v1', 'op-1', 'dev-1', 'cred-1', 'patients', 'p-1', 'update', '3', '-',
        '2026-11-19T08:00:00.000Z', hash('sha256', '{"full_name":"منى","id":"p-1"}'),
    ]));

    $delete = json_decode('{"op_id":"op-2","entity":"patients","entity_id":"p-1","action":"delete","base_rev":4,"group_id":"g-1",'
        .'"created_at":"2026-11-19T08:00:00Z","payload":{"id":"p-1"}}');
    expect(explode("\n", ProofMessage::op($delete, 'dev-1', 'cred-1')))->toBe([
        'clintra-op-v1', 'op-2', 'dev-1', 'cred-1', 'patients', 'p-1', 'delete', '4', 'g-1', '2026-11-19T08:00:00Z', '-',
    ]);
});

test('the audit and request messages are the design\'s lines, byte for byte', function () {
    $row = json_decode('{"id":"a-1","entity":"visits","entity_id":"v-1","action":"update","at":"2026-11-19T08:00:00.000Z",'
        .'"before":{"status":"booked"},"after":{"status":"arrived"}}');

    expect(ProofMessage::audit($row, 'dev-1', 'cred-1'))->toBe(implode("\n", [
        'clintra-audit-v1', 'a-1', 'dev-1', 'cred-1', 'visits', 'v-1', 'update', '2026-11-19T08:00:00.000Z',
        hash('sha256', '{"after":{"status":"arrived"},"before":{"status":"booked"}}'),
    ]));

    expect(ProofMessage::request('get', '/api/sync/pull?cursor=5', 1763539200000, 'bm9uY2Vub25jZW5vbmNl', ''))->toBe(implode("\n", [
        'clintra-req-v1', 'GET', '/api/sync/pull?cursor=5', '1763539200000', 'bm9uY2Vub25jZW5vbmNl', hash('sha256', ''),
    ]));
});

test('an ES256 signature verifies only for its own key, message and bytes', function () {
    $key = TestKey::make();
    $other = TestKey::make();
    $signature = $key->sign('message');

    expect(Es256::verify($key->jwk, 'message', $signature))->toBeTrue();
    expect(Es256::verify($key->jwk, 'messagE', $signature))->toBeFalse();
    expect(Es256::verify($other->jwk, 'message', $signature))->toBeFalse();

    $raw = Es256::base64UrlDecode($signature);
    $raw[10] = chr(ord($raw[10]) ^ 1);
    expect(Es256::verify($key->jwk, 'message', Es256::base64UrlEncode($raw)))->toBeFalse();
    expect(Es256::verify($key->jwk, 'message', 'not-a-signature'))->toBeFalse();
});

test('only a P-256 public JWK whose point is on the curve is a key', function () {
    $key = TestKey::make();

    expect(Es256::isPublicJwk($key->jwk))->toBeTrue();
    expect(Es256::isPublicJwk([...$key->jwk, 'crv' => 'P-384']))->toBeFalse();
    expect(Es256::isPublicJwk([...$key->jwk, 'kty' => 'RSA']))->toBeFalse();
    expect(Es256::isPublicJwk([...$key->jwk, 'x' => Es256::base64UrlEncode(str_repeat("\x01", 32))]))->toBeFalse();
    expect(Es256::isPublicJwk([...$key->jwk, 'y' => 'short']))->toBeFalse();
    expect(Es256::isPublicJwk('not a key'))->toBeFalse();
});
