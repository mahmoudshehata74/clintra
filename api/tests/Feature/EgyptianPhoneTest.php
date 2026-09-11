<?php

use App\Support\EgyptianPhone;

/**
 * Read via __DIR__, not base_path(): this feeds a Pest ->with() dataset,
 * evaluated while Pest collects tests — before the Laravel app container a
 * test's setUp() would normally boot, so base_path() isn't reliably
 * available here yet.
 *
 * @return array{valid: list<array{input: string, expected: string, kind: string}>, invalid: list<string>}
 */
function phoneCases(): array
{
    return json_decode(
        file_get_contents(__DIR__.'/../../../contract/phone-cases.json'),
        associative: true,
        flags: JSON_THROW_ON_ERROR,
    );
}

// Shared with the web's normalizeEgyptianPhone (web/src/domain/phone.test.ts) —
// see contract/README.md. Both implementations must accept and reject the
// exact same inputs.
test('normalizes to E.164', function (string $input, string $expected) {
    expect(EgyptianPhone::normalize($input))->toBe($expected);
})->with(array_map(fn (array $case) => [$case['input'], $case['expected']], phoneCases()['valid']));

test('rejects malformed phone input', function (string $input) {
    expect(fn () => EgyptianPhone::normalize($input))->toThrow(InvalidArgumentException::class);
})->with(phoneCases()['invalid']);
