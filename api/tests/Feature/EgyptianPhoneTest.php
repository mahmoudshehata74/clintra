<?php

use App\Support\EgyptianPhone;

// Same cases as web/src/domain/phone.test.ts's normalizeEgyptianPhone suite —
// this port must accept and reject the exact same inputs the web client does.
test('normalizes mobile numbers to E.164', function (string $input, string $expected) {
    expect(EgyptianPhone::normalize($input))->toBe($expected);
})->with([
    ['01001234567', '+201001234567'],
    ['+201001234567', '+201001234567'],
    ['00201001234567', '+201001234567'],
    ['201001234567', '+201001234567'],
    ['1001234567', '+201001234567'],
    ['010 0123 4567', '+201001234567'],
    ['+20 100 123 4567', '+201001234567'],
    ['(010) 0123-4567', '+201001234567'],
    ['٠١٠٠١٢٣٤٥٦٧', '+201001234567'],
    ['01512345678', '+201512345678'],
]);

test('normalizes landline numbers to E.164', function (string $input, string $expected) {
    expect(EgyptianPhone::normalize($input))->toBe($expected);
})->with([
    ['0225551234', '+20225551234'],
    ['+20225551234', '+20225551234'],
    ['0020225551234', '+20225551234'],
    ['20225551234', '+20225551234'],
    ['225551234', '+20225551234'],
    ['02 2555 1234', '+20225551234'],
    ['٠٢٢٥٥٥١٢٣٤', '+20225551234'],
    ['031234567', '+2031234567'],
    ['+2031234567', '+2031234567'],
    ['0501234567', '+20501234567'],
    ['+20501234567', '+20501234567'],
]);

test('rejects malformed phone input', function (string $input) {
    expect(fn () => EgyptianPhone::normalize($input))->toThrow(InvalidArgumentException::class);
})->with(['', 'notaphone', '123', '01334567890', '010012345', '020012345678']);
