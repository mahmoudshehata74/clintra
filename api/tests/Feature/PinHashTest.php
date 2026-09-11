<?php

use App\Support\PinHash;

// Pinned so the web's TypeScript implementation (@noble/hashes' argon2id,
// web/src/auth/pinHash.ts) can be proven byte-identical to this one — see
// contract/README.md and web/src/auth/pinHash.test.ts.
test('matches contract/pin-hash.json\'s shared test vector', function () {
    $config = json_decode(
        file_get_contents(base_path('../contract/pin-hash.json')),
        associative: true,
        flags: JSON_THROW_ON_ERROR,
    );
    $vector = $config['testVector'];

    expect(PinHash::hash($vector['pin'], $vector['saltHex']))->toBe($vector['hashHex']);
});

test('generateSalt produces a 16-byte (32 hex char) salt', function () {
    expect(PinHash::generateSalt())->toMatch('/^[0-9a-f]{32}$/');
});

test('different salts produce different hashes for the same PIN', function () {
    $hashA = PinHash::hash('1234', PinHash::generateSalt());
    $hashB = PinHash::hash('1234', PinHash::generateSalt());

    expect($hashA)->not->toBe($hashB);
});
